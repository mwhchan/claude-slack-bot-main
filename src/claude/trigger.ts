import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";
import { isMcpQuery } from "../utils/detection.js";
import { loadChannelConfig } from "../config/loader.js";
import { ROOT_DIR } from "../config/paths.js";
import { threadSessions } from "../state/index.js";
import { buildDMPrompt, buildChannelThreadPrompt } from "./prompt-builder.js";
import { createStreamState, processStreamBuffer } from "./stream-parser.js";
import {
	handleSuccessResponse,
	handleErrorResponse,
	handleSpawnError,
	handleTimeout,
	handleMcpResult,
	spawnSummarization,
	type ResponseContext,
} from "./response-handler.js";
import type { UnfurlContent } from "../slack/unfurl.js";
import { generateProjectStatus } from "../project-status/index.js";

// Detect if message is a project status report request
const STATUS_TRIGGER_PATTERNS = [
	/\bproject\s+status\b/i,
	/\bstatus\s+report\b/i,
	/\bstatus\s+update\b/i,
	/\bweekly\s+status\b/i,
	/\bproject\s+health\b/i,
	/\bgenerate\s+status\b/i,
];

function isStatusReportRequest(text: string): boolean {
	return STATUS_TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

// Default models
const DEFAULT_MODEL_THINKING = "sonnet";
const DEFAULT_MODEL_QUICK = "sonnet";

// Set the native Slack thread typing status (shows "Claudy is typing..." animation)
// Uses assistant.threads.setStatus API - requires assistant:write scope
async function setThreadStatus(client: any, channelId: string, threadTs: string, status: string): Promise<void> {
	try {
		const payload = { channel_id: channelId, thread_ts: threadTs, status };
		if (client.assistant?.threads?.setStatus) {
			await client.assistant.threads.setStatus(payload);
		} else if (typeof client.apiCall === "function") {
			await client.apiCall("assistant.threads.setStatus", payload);
		}
	} catch (e: any) {
		log.debug(`[Slack API] assistant.threads.setStatus failed: ${e?.message}`);
	}
}

// Trigger Claude Code CLI to generate a response
export async function triggerClaudeCode(
	channelId: string,
	threadTs: string,
	userId: string,
	text: string,
	say: (message: any) => Promise<any>,
	client: any,
	messageFiles?: any[],
	isDM: boolean = false,
	isThreadReply: boolean = false,  // True if user replied in an existing thread
	unfurls: UnfurlContent[] = [],  // URL preview content from Slack unfurls
	originalMessageTs?: string  // Original user message timestamp (for reactions)
): Promise<void> {
	// Check if this is a project status report request
	if (!isDM && isStatusReportRequest(text)) {
		const channelConfig = loadChannelConfig(channelId);
		if (channelConfig?.projectStatus?.enabled !== false && (channelConfig?.jira?.length || channelConfig?.confluence?.length)) {
			log.info(`[StatusPipeline] Detected status report request for channel ${channelId}`);

			// Set typing status while pipeline runs, refresh every 6s to keep it alive
			await setThreadStatus(client, channelId, threadTs, "Generating project status report...");
			const statusInterval = setInterval(() => {
				setThreadStatus(client, channelId, threadTs, "Generating project status report...").catch(() => {});
			}, 6000);

			const postContext = { channelId, threadTs, say, client, originalMessageTs };
			try {
				const posted = await generateProjectStatus(channelId, postContext);
				clearInterval(statusInterval);
				if (posted) {
					await setThreadStatus(client, channelId, threadTs, "");
					return;
				}
				log.warn(`[StatusPipeline] Pipeline did not produce a report, falling through to normal flow`);
			} catch (error: any) {
				clearInterval(statusInterval);
				log.error(`[StatusPipeline] Pipeline failed: ${error.message}`);
			}
			await setThreadStatus(client, channelId, threadTs, "");
			// Fall through to normal Claude flow on failure
		}
	}

	let currentActivity = "Thinking";
	let statusInterval: NodeJS.Timeout | undefined;
	const startTime = Date.now();

	// For new DM messages, don't thread so they appear in conversations.history
	// For DM thread replies and all channel messages, use thread_ts
	const shouldThread = !isDM || isThreadReply;

	// Use native Slack thread status for all feedback (no placeholder messages)
	if (shouldThread) {
		await setThreadStatus(client, channelId, threadTs, "Thinking...");
		// Refresh every 6s to keep status alive
		statusInterval = setInterval(() => {
			setThreadStatus(client, channelId, threadTs, `${currentActivity}...`).catch(() => {});
		}, 6000);
	}

	// Helper to stop status and get elapsed time
	const stopAnimation = (): number => {
		if (statusInterval) {
			clearInterval(statusInterval);
			statusInterval = undefined;
		}
		// Clear native Slack thread typing status
		if (shouldThread) {
			setThreadStatus(client, channelId, threadTs, "").catch(() => {});
		}
		return Math.round((Date.now() - startTime) / 1000);
	};

	// Helper to update the thread status with current activity
	const updateStatus = async (activity: string) => {
		currentActivity = activity;
		if (shouldThread) {
			await setThreadStatus(client, channelId, threadTs, `${activity}...`);
		}
	};

	// For DMs, use user-based session key; for threads, use thread_ts
	// This allows DM conversations to have session continuity across messages
	const sessionKey = isDM ? `dm-${userId}` : threadTs;

	// Check if we have an existing session
	const existingSession = threadSessions.get(sessionKey);
	const existingSessionId = existingSession?.sessionId;
	const isResuming = !!existingSessionId;

	// Update last used time if resuming
	if (existingSession) {
		existingSession.lastUsed = Date.now();
	}

	// Build prompt based on DM vs channel thread
	let promptResult;
	if (isDM) {
		promptResult = await buildDMPrompt(
			client,
			channelId,
			userId,
			text,
			messageFiles,
			isThreadReply,
			threadTs,
			isResuming,
			isResuming ? existingSession!.seenUserIds : [],
			unfurls
		);
	} else {
		promptResult = await buildChannelThreadPrompt(
			client,
			channelId,
			threadTs,
			userId,
			text,
			messageFiles,
			isResuming,
			isResuming ? existingSession!.seenUserIds : [],
			unfurls
		);
	}
	if (isResuming) {
		log.debug(`Resuming session ${existingSessionId!.slice(0, 8)}...`);
	}

	const { prompt, hasHistory, hasChannelHistory, uniqueGoogleUrls, slackFilesCount, canvasCount, unfurlCount, initialSeenUserIds } = promptResult;

	// Load channel config for model selection
	const channelConfigForModel = loadChannelConfig(channelId);
	const modelThinking = channelConfigForModel?.claudeModelThinking || DEFAULT_MODEL_THINKING;
	const modelQuick = channelConfigForModel?.claudeModelQuick || DEFAULT_MODEL_QUICK;

	// Use thinking model for resumed sessions (longer context, better quality)
	// Use quick model for new conversations (including MCP queries which are just searches)
	const model = isResuming ? modelThinking : modelQuick;
	const contextInfo = [];
	if (isResuming) contextInfo.push("resuming session");
	if (hasChannelHistory) contextInfo.push("channel context");
	if (hasHistory) contextInfo.push("thread history");
	if (uniqueGoogleUrls.length > 0) contextInfo.push(`${uniqueGoogleUrls.length} Google URL(s)`);
	if (slackFilesCount > 0) contextInfo.push(`${slackFilesCount} Slack file(s)`);
	if (canvasCount > 0) contextInfo.push(`${canvasCount} canvas(es)`);
	if (unfurlCount > 0) contextInfo.push(`${unfurlCount} URL preview(s)`);
	const contextStr = contextInfo.length > 0 ? ` (${contextInfo.join(" + ")})` : "";
	log.info(`Triggering Claude Code CLI (${model})...${contextStr}`);
	log.debug(`Channel: ${channelId}, Thread: ${threadTs}, User: ${userId}`);
	log.verbose(`Prompt length: ${prompt.length} chars`);

	return new Promise((done) => {
		// Prompt mode with MCP tools enabled, using stream-json for tool visibility
		const args = [
			"-p",
			prompt,
			"--model",
			model,
			"--verbose",
			"--output-format",
			"stream-json",
			"--mcp-config",
			pathResolve(ROOT_DIR, ".mcp.json"),
			"--dangerously-skip-permissions",
			pathResolve(ROOT_DIR, ".env"),
		];

		// Add --resume if we have an existing session for this thread
		if (existingSessionId) {
			args.push("--resume", existingSessionId);
		}

		const childProcess = spawn("claude", args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			cwd: ROOT_DIR,
		});

		let stderr = "";
		let buffer = "";
		let timeoutHandle: NodeJS.Timeout | undefined;
		let isCompleted = false;

		// Create stream state
		const streamState = createStreamState();

		// Response context for handlers
		const responseContext: ResponseContext = {
			channelId,
			threadTs,
			userId,
			say,
			client,
			shouldThread,
			originalMessageTs,
		};

		// Stream callbacks
		const streamCallbacks = {
			onSessionInit: (_sessionId: string) => {
				// Session captured in stream parser
			},
			onToolUse: async (displayName: string) => {
				currentActivity = displayName;
				await updateStatus(displayName);
			},
			onMcpResult: async (result: string) => {
				// Check if the MCP result is an error - if so, don't overwrite streamed content
				const isError = result.includes('"error":true') || result.includes('"error": true');
				if (isError) {
					log.warn(`MCP tool returned error, not overwriting streamed content: ${result.substring(0, 200)}`);
					streamState.mcpResultPosted = false;
					return;
				}

				const totalSeconds = stopAnimation();
				if (timeoutHandle) clearTimeout(timeoutHandle);

				await handleMcpResult(result, responseContext, totalSeconds);

				// Kill the process since we don't need AI to process further
				childProcess.kill();
			},
			onStreamUpdate: (_content: string) => {
				// No-op: content accumulates in streamState automatically.
				// Final response is posted as new message(s) after Claude finishes.
			},
		};

		if (childProcess.stdout) {
			childProcess.stdout.on("data", (data) => {
				buffer += data.toString();
				buffer = processStreamBuffer(
					buffer,
					streamState,
					sessionKey,
					initialSeenUserIds,
					isDM,
					streamCallbacks
				);
			});
		}

		if (childProcess.stderr) {
			childProcess.stderr.on("data", (data) => {
				stderr += data.toString();
			});
		}

		childProcess.on("close", async (code) => {
			log.debug(`[close handler] code=${code}, isCompleted=${isCompleted}`);

			if (timeoutHandle) clearTimeout(timeoutHandle);

			if (isCompleted) {
				log.debug(`[close handler] Already completed, skipping`);
				return;
			}

			if (streamState.mcpResultPosted) {
				isCompleted = true;
				done();
				return;
			}

			// Process any remaining buffer
			if (buffer.trim()) {
				try {
					const event = JSON.parse(buffer);
					if (event.type === "result") {
						streamState.finalResponse = event.result || "";
					}
				} catch (e) {
					// Ignore parse errors
				}
			}

			const totalSeconds = stopAnimation();

			if (code === 0 || code === null) {
				log.debug(`Claude Code CLI completed successfully`);
				const result = await handleSuccessResponse(streamState, responseContext, totalSeconds, buffer, stderr);

				// If response was too long, spawn summarization
				if (result.needsSummarization) {
					const session = threadSessions.get(sessionKey);
					if (session?.sessionId) {
						await spawnSummarization(session.sessionId, responseContext);
					} else {
						log.error(`No session ID available for summarization`);
						// Fallback: truncate and post
						const { truncateForSlack } = await import("../utils/format.js");
						const truncated = truncateForSlack(result.originalResponse || "");
						await say(shouldThread ? { text: truncated, thread_ts: threadTs } : { text: truncated });
					}
				}
			} else {
				await handleErrorResponse(streamState, responseContext, code, totalSeconds, stderr, buffer);
			}

			isCompleted = true;
			done();
		});

		childProcess.on("error", async (error: any) => {
			log.debug(`[error handler] error=${error.code}: ${error.message}`);

			if (isCompleted) return;
			isCompleted = true;
			log.debug(`[error handler] Set isCompleted=true`);

			if (timeoutHandle) clearTimeout(timeoutHandle);
			stopAnimation();

			await handleSpawnError(error, responseContext);

			done();
		});

		// Dynamic timeout: longer for MCP queries (720s), shorter for regular queries (600s)
		const timeoutDuration = isMcpQuery(text) ? 720000 : 600000;
		const timeoutSeconds = timeoutDuration / 1000;

		timeoutHandle = setTimeout(async () => {
			if (!childProcess.killed && !isCompleted) {
				stopAnimation();
				if (streamState.finalResponse) {
					log.verbose(`Partial response: ${streamState.finalResponse.substring(0, 500)}`);
				}

				await handleTimeout(responseContext, timeoutSeconds, streamState.currentMcpTool, streamState.streamedContent || streamState.finalResponse);

				isCompleted = true;
				childProcess.kill();
				done();
			}
		}, timeoutDuration);
	});
}
