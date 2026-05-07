import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { log } from "../utils/log.js";
import { containsSystemReminder } from "../utils/detection.js";
import { formatToolName, truncateForSlack, buildSectionBlocks } from "../utils/format.js";
import { broadcastMonitorEvent } from "../monitor/websocket.js";
import { parseErrorType } from "./stream-parser.js";
import { ROOT_DIR } from "../config/paths.js";
import { CHANNEL_CONTEXT_DIR, USER_CONTEXT_DIR } from "../config/paths.js";
import { extractReaction, addReaction } from "../slack/reactions.js";

import { retryAsync } from "../utils/retry.js";
import { commitContextChange } from "../utils/git-memory.js";
import { processFileUploadTags } from "../slack/file-upload.js";
import { fetchNewsNow } from "../news/index.js";
import type { StreamState } from "./stream-parser.js";

// Pattern for memory tags
// MEMORY_SAVE: appends new content to existing memory
const MEMORY_SAVE_PATTERN = /\[MEMORY_SAVE:(channel|user)\]([\s\S]*?)\[\/MEMORY_SAVE\]/g;
// MEMORY_UPDATE: replaces entire memory file with new content (for reorganizing/deduplicating)
const MEMORY_UPDATE_PATTERN = /\[MEMORY_UPDATE:(channel|user)\]([\s\S]*?)\[\/MEMORY_UPDATE\]/g;
// Pattern for news tags — triggers RSS pipeline instead of WebSearch
const NEWS_TAG_PATTERN = /\[NEWS:([^\]]+)\]/g;
// Pattern for status section tags — each section becomes a separate Slack message
const STATUS_SECTION_PATTERN = /\[STATUS_SECTION:(\w+)\]([\s\S]*?)\[\/STATUS_SECTION\]/g;

// Helper to resolve memory file path
function resolveMemoryPath(target: string, channelId: string, userId: string): { contextDir: string; contextFile: string; contextId: string } {
	let contextDir: string;
	let contextId: string;
	if (target === "user") {
		contextDir = pathResolve(USER_CONTEXT_DIR, userId);
		contextId = userId;
	} else {
		contextDir = pathResolve(CHANNEL_CONTEXT_DIR, channelId);
		contextId = channelId;
	}
	return { contextDir, contextFile: pathResolve(contextDir, "memory.md"), contextId };
}

// Process memory tags in response and return cleaned response
function processMemoryTags(response: string, channelId: string, userId: string): string {
	let cleanedResponse = response;

	// Process MEMORY_UPDATE tags first (replaces memory.md entirely)
	MEMORY_UPDATE_PATTERN.lastIndex = 0;
	let match;
	while ((match = MEMORY_UPDATE_PATTERN.exec(response)) !== null) {
		const [fullMatch, target, content] = match;
		const trimmedContent = content.trim();

		if (!trimmedContent) {
			log.warn(`[Memory] Empty MEMORY_UPDATE tag, skipping`);
			cleanedResponse = cleanedResponse.replace(fullMatch, "");
			continue;
		}

		const { contextDir, contextFile, contextId } = resolveMemoryPath(target, channelId, userId);

		try {
			if (!existsSync(contextDir)) {
				mkdirSync(contextDir, { recursive: true });
			}
			writeFileSync(contextFile, trimmedContent + "\n");
			log.info(`[Memory] Updated ${target} memory for ${contextId} (${trimmedContent.length} chars, replaced)`);
			commitContextChange(contextDir, contextId, "Memory updated");
		} catch (error) {
			log.error(`[Memory] Failed to update ${target} memory for ${contextId}:`, error);
		}

		cleanedResponse = cleanedResponse.replace(fullMatch, "");
	}

	// Process MEMORY_SAVE tags (append)
	MEMORY_SAVE_PATTERN.lastIndex = 0;
	while ((match = MEMORY_SAVE_PATTERN.exec(response)) !== null) {
		const [fullMatch, target, content] = match;
		const trimmedContent = content.trim();

		if (!trimmedContent) {
			log.warn(`[Memory] Empty MEMORY_SAVE tag, skipping`);
			cleanedResponse = cleanedResponse.replace(fullMatch, "");
			continue;
		}

		const { contextDir, contextFile, contextId } = resolveMemoryPath(target, channelId, userId);

		try {
			if (!existsSync(contextDir)) {
				mkdirSync(contextDir, { recursive: true });
			}

			const timestamp = new Date().toISOString();
			const entry = `\n## Manual Memory - ${timestamp}\n\n${trimmedContent}\n\n---\n\n`;
			appendFileSync(contextFile, entry);

			log.info(`[Memory] Saved ${target} memory for ${contextId} (${trimmedContent.length} chars, append)`);
			commitContextChange(contextDir, contextId, "Memory saved");
		} catch (error) {
			log.error(`[Memory] Failed to save ${target} memory for ${contextId}:`, error);
		}

		cleanedResponse = cleanedResponse.replace(fullMatch, "");
	}

	// Clean up extra newlines left by tag removal
	if (cleanedResponse !== response) {
		cleanedResponse = cleanedResponse.replace(/\n{3,}/g, "\n\n").trim();
	}

	return cleanedResponse;
}

// Process news tags — strip tag and trigger RSS pipeline
// Returns { response, newsTriggered } so caller can handle empty response correctly
async function processNewsTags(response: string, channelId: string, threadTs: string): Promise<{ response: string; newsTriggered: boolean }> {
	let cleanedResponse = response;
	let newsTriggered = false;
	NEWS_TAG_PATTERN.lastIndex = 0;
	let match;
	while ((match = NEWS_TAG_PATTERN.exec(response)) !== null) {
		const [fullMatch, topic] = match;
		const trimmedTopic = topic.trim();

		if (trimmedTopic) {
			log.info(`[News] Tag detected, fetching RSS news for "${trimmedTopic}"`);
			newsTriggered = true;
			fetchNewsNow(channelId, trimmedTopic, threadTs).catch((error) => {
				log.error(`[News] Failed to fetch news for "${trimmedTopic}":`, error);
			});
		}

		cleanedResponse = cleanedResponse.replace(fullMatch, "");
	}

	if (cleanedResponse !== response) {
		cleanedResponse = cleanedResponse.replace(/\n{3,}/g, "\n\n").trim();
	}

	return { response: cleanedResponse, newsTriggered };
}

// Section header emojis for status report sections
const STATUS_SECTION_HEADERS: Record<string, { emoji: string; title: string }> = {
	executive_summary: { emoji: ":bar_chart:", title: "Project Status" },
	platform_summary: { emoji: ":mag:", title: "Source Health Signals" },
	low_level_updates: { emoji: ":clipboard:", title: "Detailed Updates" },
	sprint_report: { emoji: ":dart:", title: "Sprint Report" },
	risk_blockers: { emoji: ":warning:", title: "Risks & Blockers" },
};

// Process status section tags — post each section as a separate Slack message
async function processStatusSectionTags(response: string, context: ResponseContext): Promise<string> {
	let cleanedResponse = response;
	STATUS_SECTION_PATTERN.lastIndex = 0;

	const sections: { name: string; content: string; fullMatch: string }[] = [];
	let match;
	while ((match = STATUS_SECTION_PATTERN.exec(response)) !== null) {
		const [fullMatch, name, content] = match;
		const trimmedContent = content.trim();
		if (trimmedContent) {
			sections.push({ name, content: trimmedContent, fullMatch });
		}
		cleanedResponse = cleanedResponse.replace(fullMatch, "");
	}

	if (sections.length === 0) {
		return cleanedResponse;
	}

	log.info(`[Status] Found ${sections.length} status sections, posting as separate messages`);

	// Post each section as a separate message in the thread
	for (const section of sections) {
		const header = STATUS_SECTION_HEADERS[section.name];
		// Don't prepend header if content already starts with similar title
		const alreadyHasHeader = header && section.content.includes(header.title);
		const sectionText = header && !alreadyHasHeader
			? `${header.emoji} *${header.title}*\n\n${section.content}`
			: section.content;

		try {
			await postResponseMessage(sectionText, context);
			log.debug(`[Status] Posted section: ${section.name}`);
		} catch (error) {
			log.error(`[Status] Failed to post section ${section.name}:`, error);
		}
	}

	cleanedResponse = cleanedResponse.replace(/\n{3,}/g, "\n\n").trim();
	return cleanedResponse;
}

// Context for response handling
export interface ResponseContext {
	channelId: string;
	threadTs: string;
	userId: string;
	say: (message: any) => Promise<any>;
	client: any;
	shouldThread?: boolean; // If false, don't thread replies (for new DM messages)
	originalMessageTs?: string; // Original user message timestamp (for reactions)
}

// Helper to post response text as a new message with Block Kit blocks for long content
async function postResponseMessage(
	text: string,
	context: ResponseContext
): Promise<string | undefined> {
	const { say, threadTs, shouldThread } = context;
	const blocks = buildSectionBlocks(text);
	const msgPayload = shouldThread
		? { text, blocks, thread_ts: threadTs }
		: { text, blocks };
	const result = await retryAsync(() => say(msgPayload));
	return result?.ts;
}

// Threshold for requesting summarization (chars) - Slack limit is ~40k, leave buffer
const SUMMARIZATION_THRESHOLD = 35000;

// Result from handleSuccessResponse
export interface SuccessResult {
	handled: boolean;
	needsSummarization?: boolean;
	originalResponse?: string;
}

// Handle successful response (exit code 0)
export async function handleSuccessResponse(
	state: StreamState,
	context: ResponseContext,
	totalSeconds: number,
	buffer: string,
	stderr: string
): Promise<SuccessResult> {
	const { channelId, client, shouldThread, originalMessageTs } = context;
	// Use finalResponse, fallback to streamedContent if empty (for streaming that didn't get a result event)
	let response = state.finalResponse.trim() || state.streamedContent.trim();

	// Discard response if it contains leaked system-reminder tags
	if (containsSystemReminder(response)) {
		log.warn(`Response contained system-reminder tags, discarding`);
		log.info(`[FILTERED] Response discarded due to leaked system tags`);
		return { handled: true };
	}

	// Extract reaction tag (if present) before processing response
	let reactionEmoji: string | null = null;
	const reactionResult = extractReaction(response);
	if (reactionResult) {
		reactionEmoji = reactionResult.emoji;
		response = reactionResult.cleanedResponse;
		log.debug(`Extracted reaction :${reactionEmoji}: from response`);
	}

	// Strip any leftover vacation tags (Claude should edit vacations.md directly, but strip if it outputs tags)
	response = response.replace(/\[VACATION_(?:ADD|REMOVE):[^\]]*\]/g, "").replace(/\n{3,}/g, "\n\n").trim();

	// Process memory save tags (write to channel/user context files and strip tags)
	response = processMemoryTags(response, channelId, context.userId);

	// Process status section tags (post each section as separate Slack message and strip tags)
	response = await processStatusSectionTags(response, context);

	// Process file upload tags (upload files to Slack thread and strip tags)
	response = await processFileUploadTags(response, channelId, context.threadTs, client);

	// Process news tags (trigger RSS pipeline and strip tags)
	const newsResult = await processNewsTags(response, channelId, context.threadTs);
	response = newsResult.response;

	// Handle reaction-only response (no text after extracting reaction)
	if (reactionEmoji && !response) {
		log.debug(`Response was reaction-only, adding reaction`);
		if (originalMessageTs) {
			await addReaction(client, channelId, originalMessageTs, reactionEmoji);
		}
		return { handled: true };
	}

	if (response) {
		// Check if response is too long - request summarization instead of truncating
		if (response.length > SUMMARIZATION_THRESHOLD) {
			log.info(`Response too long (${response.length} chars), requesting summarization`);
			return { handled: false, needsSummarization: true, originalResponse: response };
		}

		// Post response as new message(s)
		const postedMessageTs = await postResponseMessage(response, context);

		// Display AI response in console (after posting so we have the correct message ts)
		const tokenInfo = state.inputTokens || state.outputTokens
			? ` [${state.inputTokens}→${state.outputTokens} tokens, $${state.costUsd.toFixed(4)}]`
			: "";
		const msgRef = postedMessageTs ? ` {${channelId}:${postedMessageTs}}` : "";
		log.info(`[RESPONSE] (${totalSeconds}s)${tokenInfo}${msgRef}: "${response.substring(0, 200)}${response.length > 200 ? "..." : ""}"`);
		log.debug(`Posted reply to Slack ${shouldThread ? "thread" : "DM"}`);

		// Broadcast AI reply event to monitor clients (triggers notification indicator + delete button)
		log.debug(`Broadcasting aiReply event: channel=${channelId}, messageTs=${postedMessageTs}`);
		broadcastMonitorEvent("aiReply", { channel: channelId, messageTs: postedMessageTs });

		// Add reaction to original user message if requested
		if (reactionEmoji && originalMessageTs) {
			await addReaction(client, channelId, originalMessageTs, reactionEmoji);
		}

		return { handled: true };
	}

	// News tag was processed — RSS pipeline will post results, no text response needed
	if (newsResult.newsTriggered) {
		log.info(`[News] Response was news-only, RSS pipeline will post results`);
		return { handled: true };
	}

	// Exit code 0 but empty response - unexpected
	log.warn(`Claude CLI exited with code 0 but no response`);
	log.info(`[CLI WARN] Empty response with exit code 0 - stderr: "${stderr.substring(0, 200)}"`);
	if (buffer) {
		log.info(`[CLI WARN] Buffer content: "${buffer.substring(0, 200)}"`);
	}

	const errorMessage = `Sorry, I encountered an error processing your request. Please try asking something else.`;
	await postResponseMessage(errorMessage, context);
	return { handled: true };
}

// Handle error response (non-zero exit code)
export async function handleErrorResponse(
	state: StreamState,
	context: ResponseContext,
	exitCode: number,
	totalSeconds: number,
	stderr: string,
	buffer: string
): Promise<void> {
	log.error(`[CLI ERROR] Exit code: ${exitCode}`);

	// Log all available error info
	if (stderr) {
		log.error(`[CLI ERROR] Stderr: ${stderr.substring(0, 500)}`);
	}
	if (state.lastErrorEvent) {
		log.error(`[CLI ERROR] JSON event: ${JSON.stringify(state.lastErrorEvent)}`);
	}
	if (!stderr && !state.lastErrorEvent) {
		log.error(`[CLI ERROR] No error details available (stderr empty, no JSON error event)`);
	}
	if (buffer) {
		log.error(`[CLI ERROR] Remaining buffer: ${buffer.substring(0, 200)}`);
	}

	const { errorType, errorDetails } = parseErrorType(stderr, state.lastErrorEvent);

	const errorMessage = `Sorry, I encountered an error processing your request. Please try asking something else.`;
	log.info(`Error response (${totalSeconds}s): "${errorMessage}" [${errorType}${errorDetails ? ": " + errorDetails : ""}]`);

	await postResponseMessage(errorMessage, context);
}

// Handle spawn error
export async function handleSpawnError(
	error: any,
	context: ResponseContext
): Promise<void> {
	log.error(`[SPAWN ERROR] ${error.code || error.name}: ${error.message}`);
	if (error.code === "ENOENT") {
		log.error(`[SPAWN ERROR] The 'claude' command was not found in PATH`);
		log.error(`[SPAWN ERROR] Make sure Claude Code CLI is installed and in PATH`);
	}

	const errorMessage = `Sorry, I encountered an error starting the request:\n\`\`\`\n${error.message}\n\`\`\`\nPlease try asking something else.`;

	await postResponseMessage(errorMessage, context);
}

// Handle timeout
export async function handleTimeout(
	context: ResponseContext,
	timeoutSeconds: number,
	currentMcpTool: string | null,
	partialContent?: string
): Promise<void> {
	log.warn(`Claude Code CLI timed out (> ${timeoutSeconds}s), killing process`);

	// If there's substantial partial content, post it with a timeout notice
	const trimmedPartial = partialContent?.trim() || "";
	if (trimmedPartial.length > 100) {
		log.info(`Posting partial response (${trimmedPartial.length} chars) from timed-out process`);
		const timeoutNotice = currentMcpTool
			? `\n\n_Response incomplete — timed out after ${timeoutSeconds}s waiting for ${formatToolName(currentMcpTool)}. Please try again._`
			: `\n\n_Response incomplete — timed out after ${timeoutSeconds}s. Please try again._`;
		await postResponseMessage(trimmedPartial + timeoutNotice, context);
		return;
	}

	const timeoutMessage = currentMcpTool
		? `The request timed out after ${timeoutSeconds} seconds while waiting for ${formatToolName(currentMcpTool)}.\n\nThis usually means the external service is slow or unresponsive. Please try again.`
		: `The request timed out after ${timeoutSeconds} seconds.\n\nPlease try again with a simpler query.`;

	await postResponseMessage(timeoutMessage, context);
}

// Handle MCP result (direct posting)
export async function handleMcpResult(
	result: string,
	context: ResponseContext,
	totalSeconds: number
): Promise<void> {
	const { channelId, shouldThread } = context;

	// Truncate if too long for Slack
	const truncatedResult = truncateForSlack(result);
	if (truncatedResult.length < result.length) {
		log.warn(`MCP result truncated from ${result.length} to ${truncatedResult.length} characters`);
	}

	log.info(`MCP result (${totalSeconds}s): "${truncatedResult.substring(0, 200)}${truncatedResult.length > 200 ? "..." : ""}"`);

	const postedMessageTs = await postResponseMessage(truncatedResult, context);

	log.debug(`Posted MCP result directly to Slack ${shouldThread ? "thread" : "DM"}`);

	// Broadcast AI reply event to monitor clients
	broadcastMonitorEvent("aiReply", { channel: channelId, messageTs: postedMessageTs });
}

// Spawn a follow-up Claude call to summarize a long response
export async function spawnSummarization(
	sessionId: string,
	context: ResponseContext
): Promise<void> {
	const { channelId } = context;

	const summarizePrompt = `Your previous response was too long for Slack (max ~40,000 characters). Please summarize the key information concisely. Include the source link if applicable. Keep it under 35,000 characters.`;

	log.info(`Spawning summarization request with session ${sessionId.slice(0, 8)}...`);

	return new Promise((resolve) => {
		const args = [
			"-p",
			summarizePrompt,
			"--model",
			"sonnet",  // Use thinking model for better summarization quality
			"--output-format",
			"stream-json",
			"--mcp-config",
			pathResolve(ROOT_DIR, ".mcp.json"),
			"--resume",
			sessionId,
			"--dangerously-skip-permissions",
			pathResolve(ROOT_DIR, ".env"),
		];

		const childProcess = spawn("claude", args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			cwd: ROOT_DIR,
		});

		let buffer = "";
		let stderr = "";
		let finalResponse = "";
		let timeoutHandle: NodeJS.Timeout | undefined;

		if (childProcess.stdout) {
			childProcess.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						// Capture result
						if (event.type === "result" && event.result) {
							finalResponse = event.result;
						}
						// Also capture from message content
						if (event.type === "message" && event.message?.content) {
							const textBlocks = event.message.content.filter((b: any) => b.type === "text");
							if (textBlocks.length > 0) {
								finalResponse = textBlocks.map((b: any) => b.text).join("\n");
							}
						}
					} catch (e) {
						// Ignore parse errors
					}
				}
			});
		}

		if (childProcess.stderr) {
			childProcess.stderr.on("data", (data) => {
				stderr += data.toString();
			});
		}

		childProcess.on("error", async (error: any) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			log.error(`Summarization spawn error: ${error.code || error.name} - ${error.message}`);
			const errorMsg = "Sorry, the response was too long and I couldn't summarize it. Please try a more specific question.";
			await postResponseMessage(errorMsg, context);
			resolve();
		});

		childProcess.on("close", async (code) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);

			// Process remaining buffer
			if (buffer.trim()) {
				try {
					const event = JSON.parse(buffer);
					if (event.type === "result" && event.result) {
						finalResponse = event.result;
					}
				} catch (e) {
					// Ignore
				}
			}

			if (code === 0 && finalResponse.trim()) {
				// Truncate as final safety net
				const response = truncateForSlack(finalResponse.trim());
				log.info(`Summarized response (${response.length} chars): "${response.substring(0, 200)}..."`);

				const postedMessageTs = await postResponseMessage(response, context);
				broadcastMonitorEvent("aiReply", { channel: channelId, messageTs: postedMessageTs });
			} else {
				log.error(`Summarization failed with code ${code}`);
				if (stderr) {
					log.error(`Summarization stderr: ${stderr.substring(0, 500)}`);
				}
				const errorMsg = "Sorry, the response was too long and I couldn't summarize it. Please try a more specific question.";
				await postResponseMessage(errorMsg, context);
			}

			resolve();
		});

		// Timeout for summarization (30s should be plenty)
		timeoutHandle = setTimeout(() => {
			if (!childProcess.killed) {
				log.warn(`Summarization timed out, killing process`);
				childProcess.kill();
			}
		}, 30000);
	});
}
