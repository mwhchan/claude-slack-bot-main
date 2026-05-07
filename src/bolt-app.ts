import { App, LogLevel } from "@slack/bolt";
import { spawn } from "child_process";
import { appendFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { resolve as pathResolve } from "path";
import { config } from "dotenv";
import { isConfigCommand, processConfigCommand } from "./utils/config-commands.js";
import { commitContextChange } from "./utils/git-memory.js";

// Extracted modules - Utils
import { log } from "./utils/log.js";
import { isMcpQuery, isDMChannel, containsSystemReminder } from "./utils/detection.js";

// Extracted modules - Config
import { loadChannelConfig, getChannelContextPath, getChannelConfigPath, getUserContextPath } from "./config/loader.js";
import { ROOT_DIR, DATA_DIR, LOG_DIR, MESSAGES_DIR, CONTEXT_DIR, CHANNEL_CONTEXT_DIR, USER_CONTEXT_DIR, SLACK_FILES_DIR } from "./config/paths.js";

// Extracted modules - Slack
import { startFileCleanupInterval } from "./slack/files.js";
import { fetchDMHistory } from "./slack/history.js";
import { fetchCanvases } from "./slack/canvas.js";
import { setSlackClient, getChannelName, getUserName, ensureChannelContextFolder, ensureUserContextFolder } from "./slack/context.js";
import { extractUnfurlContent } from "./slack/unfurl.js";

// Extracted modules - State
import {
	threadSessions,
	processedMessages,
	monitoredChannels,
	setQueueSlackClient,
	startSessionCleanup,
} from "./state/index.js";

// Extracted modules - Queue
import { queueClaudeRequest } from "./queue/claude-request.js";
import { debounceKey, debounceMessage } from "./queue/debounce.js";

// Extracted modules - Monitor
import { startMonitorWebSocket, broadcastMonitorEvent, setMonitorSlackClient } from "./monitor/websocket.js";

// Extracted modules - Claude
import { triggerClaudeCode } from "./claude/trigger.js";

// Extracted modules - News
import { initializeNewsScheduler, stopAllNewsJobs } from "./news/index.js";

// Extracted modules - Vacation
import { initializeVacationScheduler, stopAllVacationJobs } from "./vacation/index.js";

// Extracted modules - Project Status
import { initializeStatusScheduler, stopAllStatusJobs } from "./project-status/index.js";

// Load .env from root directory
config({ path: pathResolve(ROOT_DIR, ".env") });

// Validate required environment variables
const requiredEnvVars = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"];
for (const envVar of requiredEnvVars) {
	if (!process.env[envVar]) {
		console.error(`Missing required environment variable: ${envVar}`);
		process.exit(1);
	}
}

// Configuration from environment
const BOT_USER_ID = process.env.BOT_USER_ID;
const DEFAULT_MODEL_THINKING = "sonnet";
const DEFAULT_MODEL_QUICK = "sonnet";
const MONITOR_WS_PORT = parseInt(process.env.MONITOR_WS_PORT || "3847");

// Bot mode: "dev" restricts to DEV_CHANNEL only, "prod" (default) excludes DEV_CHANNEL
const BOT_MODE = (process.env.BOT_MODE || "prod").toLowerCase();
const DEV_CHANNEL = process.env.DEV_CHANNEL || "";

// Check if a channel should be handled by this instance
function shouldHandleChannel(channel: string): boolean {
	if (!DEV_CHANNEL) return true; // No dev channel configured, handle everything
	if (BOT_MODE === "dev") return channel === DEV_CHANNEL;
	return channel !== DEV_CHANNEL; // prod: handle everything except dev channel
}

// DM restriction toggle - set to "true" to enable DM allowlist
const DM_RESTRICTION_ENABLED = process.env.DM_RESTRICTION_ENABLED === "true";

// DM allowlist - comma-separated list of user IDs that can DM the bot
const ALLOWED_DM_USERS = process.env.ALLOWED_DM_USERS
	? process.env.ALLOWED_DM_USERS.split(",").map((id) => id.trim()).filter(Boolean)
	: [];

// Check if a user is allowed to DM the bot
function isUserAllowedToDM(userId: string): boolean {
	// If DM restriction is not enabled, all users can DM
	if (!DM_RESTRICTION_ENABLED) {
		return true;
	}
	// If restriction enabled but no allowlist, block everyone
	if (ALLOWED_DM_USERS.length === 0) {
		return false;
	}
	return ALLOWED_DM_USERS.includes(userId);
}

// Strip noisy fields from Slack API responses (images, scopes, metadata, file details)
function stripNoiseFromLog(msg: any): any {
	if (typeof msg !== "string") return msg;
	try {
		// Handle "http request result: {...}" format
		const jsonMatch = msg.match(/^(.*?:\s*)(\{.*\})$/s);
		if (jsonMatch) {
			const [, prefix, jsonStr] = jsonMatch;
			// Check for noisy patterns
			if (jsonStr.includes('"image_') || jsonStr.includes('"response_metadata"') ||
				jsonStr.includes('"bot_profile"') || jsonStr.includes('"blocks"') ||
				jsonStr.includes('"shares"') || jsonStr.includes('"url_private"')) {
				const obj = JSON.parse(jsonStr);
				// Strip image URLs from user profile
				if (obj.user?.profile) {
					const { image_24, image_32, image_48, image_72, image_192, image_512, image_1024, image_original, ...rest } = obj.user.profile;
					obj.user.profile = rest;
				}
				// Strip noisy message fields
				if (obj.message) {
					delete obj.message.bot_profile;
					delete obj.message.blocks;
				}
				// Strip noisy file fields (canvas, attachments)
				if (obj.file) {
					delete obj.file.shares;
					delete obj.file.url_private;
					delete obj.file.url_private_download;
					delete obj.file.url_static_preview;
					delete obj.file.title_blocks;
					delete obj.file.favorites;
					delete obj.file.comments;
					delete obj.file.dm_mpdm_users_with_file_access;
				}
				// Strip response_metadata (scopes, etc)
				delete obj.response_metadata;
				return prefix + JSON.stringify(obj);
			}
		}
	} catch {
		// Not JSON, return as-is
	}
	return msg;
}

// Skip verbose debug messages
function shouldSkipLog(msgs: any[]): boolean {
	const msg = msgs.join(" ");
	// Skip HTTP noise
	if (msg.includes("http request body:")) return true;
	if (msg.includes("http request headers:")) return true;
	if (msg.includes("http response received")) return true;
	if (msg.includes("apiCall(") && msg.includes(") start")) return true;
	if (msg.includes("apiCall(") && msg.includes(") end")) return true;
	// Skip ack() spam (6 lines per event)
	if (msg.includes("ack()")) return true;
	if (msg.includes("Calling ack()")) return true;
	if (msg.includes("WebSocket state:")) return true;
	if (msg.includes("isActive():")) return true;
	if (msg.includes("Sending a WebSocket message:")) return true;
	// Skip WebSocket event payloads (huge JSON)
	if (msg.includes("Received a message on the WebSocket:")) return true;
	return false;
}

// Custom logger that downgrades socket-mode errors to debug level
// This prevents transient WebSocket errors from cluttering the log output
const customLogger = {
	debug: (...msgs: any[]) => {
		if (shouldSkipLog(msgs)) return;  // Skip noisy logs
		const msg = msgs.join(" ");
		// HTTP results go to verbose (too noisy for debug)
		if (msg.includes("http request result:") || msg.includes("http request url:")) {
			log.verbose("[Slack]", ...msgs.map(stripNoiseFromLog));
			return;
		}
		log.debug("[Slack]", ...msgs.map(stripNoiseFromLog));
	},
	info: (...msgs: any[]) => log.info("[Slack]", ...msgs),
	warn: (...msgs: any[]) => log.warn("[Slack]", ...msgs),
	error: (...msgs: any[]) => {
		const message = msgs.join(" ");
		// Downgrade socket-mode errors to debug (they're usually transient)
		if (message.includes("socket-mode") || message.includes("WebSocket")) {
			log.debug("[Slack]", ...msgs);
		} else {
			log.error("[Slack]", ...msgs);
		}
	},
	setLevel: () => {},
	getLevel: () => LogLevel.DEBUG,
	setName: () => {},
};

// Initialize Bolt app with Socket Mode
const app = new App({
	token: process.env.SLACK_BOT_TOKEN,
	signingSecret: process.env.SLACK_SIGNING_SECRET,
	socketMode: true,
	appToken: process.env.SLACK_APP_TOKEN,
	logLevel: LogLevel.DEBUG,
	logger: customLogger as any,
	// Socket Mode tuning
	clientOptions: {
		slackApiUrl: "https://slack.com/api/",
	},
});

// Log socket connection events
app.client.on("connected" as any, () => {
	log.info("[Socket] Connected");
});

app.client.on("connecting" as any, () => {
	log.debug("[Socket] Connecting...");
});

app.client.on("disconnected" as any, () => {
	log.warn("[Socket] Disconnected - will attempt to reconnect");
});

app.client.on("reconnecting" as any, () => {
	log.info("[Socket] Reconnecting...");
});

app.client.on("error" as any, (error: any) => {
	log.error(`[Socket] Error: ${error?.message || error}`);
	if (error?.code) {
		log.error(`[Socket] Error code: ${error.code}`);
	}
	if (error?.data) {
		log.verbose(`[Socket] Error data:`, JSON.stringify(error.data, null, 2));
	}
});

// Ensure all data directories exist
function ensureDataDirs(): void {
	const dirs = [DATA_DIR, LOG_DIR, MESSAGES_DIR, CONTEXT_DIR, CHANNEL_CONTEXT_DIR, USER_CONTEXT_DIR, SLACK_FILES_DIR];
	let created = 0;
	dirs.forEach((dir) => {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
			created++;
		}
	});
	if (created > 0) {
		log.info(`[Startup] Created ${created} data directories`);
	}
}

// Save raw message to messages folder (for summarization)
// Includes thread_ts so we can generate links back to original discussions
function saveRawMessage(channelId: string, userId: string, messageText: string, timestamp: string, threadTs?: string): void {
	ensureDataDirs();
	const msgFilePath = pathResolve(MESSAGES_DIR, `${channelId}.txt`);
	// Format: [timestamp] <@user> (thread:ts): message
	// Thread ts can be used to generate Slack links: /archives/CHANNEL/pTHREAD_TS (without dots)
	const threadInfo = threadTs ? ` (thread:${threadTs})` : "";
	const entry = `[${timestamp}] <@${userId}>${threadInfo}: ${messageText}\n`;
	try {
		appendFileSync(msgFilePath, entry);
	} catch (error) {
		log.error(`Failed to save raw message:`, error);
	}
}

// Load raw messages from messages folder
function loadRawMessages(channelId: string): string {
	const msgFilePath = pathResolve(MESSAGES_DIR, `${channelId}.txt`);
	if (existsSync(msgFilePath)) {
		try {
			return readFileSync(msgFilePath, "utf-8");
		} catch (error) {
			log.error(`Failed to load raw messages:`, error);
		}
	}
	return "";
}

// Check if there are messages from previous days in the temp file
// Returns true if we should trigger summarization (messages exist from before today)
function hasMessagesFromPreviousDay(channelId: string): boolean {
	const rawMessages = loadRawMessages(channelId);
	if (!rawMessages || rawMessages.trim().length === 0) {
		return false;
	}

	// Get today's date (start of day in local timezone)
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Parse timestamps from messages - format: [ISO_TIMESTAMP] <@userId>: message
	const timestampPattern = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/gm;
	let match;
	while ((match = timestampPattern.exec(rawMessages)) !== null) {
		try {
			const messageDate = new Date(match[1]);
			messageDate.setHours(0, 0, 0, 0);
			if (messageDate < today) {
				log.debug(`[Summary] Found message from previous day: ${match[1]}`);
				return true;
			}
		} catch {
			// Skip invalid timestamps
		}
	}

	return false;
}

// Clear message file after successful summary
function clearRawMessages(channelId: string): void {
	const msgFilePath = pathResolve(MESSAGES_DIR, `${channelId}.txt`);
	if (existsSync(msgFilePath)) {
		try {
			unlinkSync(msgFilePath);
			log.debug(`Cleared raw messages for ${channelId}`);
		} catch (error) {
			log.error(`Failed to clear raw messages:`, error);
		}
	}
}

// Save curated channel context (from auto-summaries)
function saveChannelContext(channelId: string, summary: string): void {
	ensureDataDirs();
	const timestamp = new Date().toISOString();
	const channelDir = pathResolve(CHANNEL_CONTEXT_DIR, channelId);
	const channelContextPath = pathResolve(channelDir, "context.md");

	// Ensure the channel directory exists
	if (!existsSync(channelDir)) {
		mkdirSync(channelDir, { recursive: true });
	}

	const entry = `## Summary - ${timestamp}

${summary}

---

`;
	try {
		appendFileSync(channelContextPath, entry);
		log.debug(`Saved channel context for ${channelId}`);
		commitContextChange(channelDir, channelId, "Daily summary");
	} catch (error) {
		log.error(`Failed to save channel context:`, error);
	}
}

// Trigger Claude Code CLI for ephemeral responses (simplified, no streaming)
async function triggerClaudeCodeEphemeral(
	channelId: string,
	userId: string,
	text: string,
	sendResponse: (text: string) => Promise<void>,
	client: any
): Promise<void> {
	const startTime = Date.now();
	const isDM = isDMChannel(channelId);
	const botToken = process.env.SLACK_BOT_TOKEN!;

	// Build context
	const userName = await getUserName(userId);

	// Get file paths for @ references
	const configPath = getChannelConfigPath(channelId);
	const contextPath = getChannelContextPath(channelId);
	const userContextPath = getUserContextPath(userId);

	// Build @ file references section
	const fileRefs: string[] = [];
	if (configPath) fileRefs.push(`@${configPath}`);
	if (contextPath) fileRefs.push(`@${contextPath}`);
	if (userContextPath) fileRefs.push(`@${userContextPath}`);

	const fileRefsSection = fileRefs.length > 0 ? fileRefs.join(" ") + "\n\n" : "";

	// Fetch channel canvases (same as regular channel messages)
	let canvasContext = "";
	if (!isDM) {
		const fetchedCanvases = await fetchCanvases(client, text, botToken, undefined, channelId, true);
		if (fetchedCanvases.length > 0) {
			const canvasSections = fetchedCanvases.map((canvas) => {
				const permalinkNote = canvas.permalink ? `\nPermalink: ${canvas.permalink}` : "";
				return `### ${canvas.title}${permalinkNote}\n\n${canvas.content}`;
			}).join("\n\n---\n\n");

			canvasContext = `
## Slack Canvases

The following Slack Canvas documents are attached to this channel:

${canvasSections}

`;
			log.info(`[/claudy] Included ${fetchedCanvases.length} canvas(es)`);
		}
	}

	// Fetch conversation history (DM or channel)
	let historySection = "";
	if (isDM) {
		log.info(`[/claudy] Detected DM channel, fetching history...`);
		const dmHistory = await fetchDMHistory(client, channelId, undefined, 50, userId);
		if (dmHistory.length > 0) {
			const maxHistoryLength = 4000;
			const truncatedHistory =
				dmHistory.length > maxHistoryLength
					? "...\n" + dmHistory.slice(-maxHistoryLength)
					: dmHistory;
			historySection = `Here is the recent DM conversation history:

${truncatedHistory}

`;
			log.info(`[/claudy DM] Included ${dmHistory.length} chars of DM history`);
		} else {
			log.info(`[/claudy DM] No DM history returned`);
		}
	} else {
		// Fetch recent channel messages (last 20)
		try {
			const result = await client.conversations.history({
				channel: channelId,
				limit: 20,
			});
			if (result.messages && result.messages.length > 0) {
				const messages = result.messages.reverse(); // Chronological order
				const formattedMessages = await Promise.all(
					messages.map(async (msg: any) => {
						const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
						const msgUserId = msg.user || "unknown";
						const msgUserName = await getUserName(msgUserId);
						const msgText = msg.text || "";
						return `[${timestamp}] ${msgUserName}: ${msgText}`;
					})
				);
				historySection = `## Recent Channel Activity (last ${messages.length} messages)

${formattedMessages.join("\n")}

`;
				log.info(`[/claudy] Included ${messages.length} recent channel messages`);
			}
		} catch (error: any) {
			log.error(`[/claudy] Failed to fetch channel history: ${error?.message}`);
		}
	}

	// Add metadata for context - DM-specific or channel-specific
	const channelName = isDM ? "Direct Message" : await getChannelName(channelId);
	const metadataSection = isDM
		? `
## Internal Context (do not mention these technical details in your response)

- This is a Direct Message conversation
- Speaking with: ${userName} (User ID: ${userId})
- User memory file: data/context/users/${userId}/context.md

`
		: `
## Internal Context (do not mention these technical details in your response)

- Channel: #${channelName} (ID: ${channelId})
- Speaking with: ${userName}
- Memory file: data/context/channels/${channelId}/context.md

`;

	// Multi-source search instructions for project knowledge queries
	const searchInstructions = isMcpQuery(text) ? `
## Search Instructions

When answering questions about project knowledge (SOW, requirements, status, milestones, etc.):
1. Check the @context.md and @config.json files provided above
2. Check any Slack Canvases included above
3. Use MCP tools to search Confluence (getPagesInConfluenceSpace, getConfluencePage)
4. Use MCP tools to search Jira (search, searchJiraIssuesUsingJql)
5. Use NotebookLM if configured in config.json (via Google skills)

Search ALL relevant sources and synthesize the information. Do NOT ask what to search - just search everything relevant.

` : "";

	const prompt = `${fileRefsSection}${metadataSection}${canvasContext}${searchInstructions}${historySection}${userName} asked:
"${text}"

Reply naturally and conversationally.${historySection ? " Take into account the conversation history above." : ""} Output ONLY the reply text.`;

	// Load channel config for model selection
	// Use thinking model for MCP queries (complex searches need better reasoning)
	const channelConfig = loadChannelConfig(channelId);
	const modelThinking = channelConfig?.claudeModelThinking || DEFAULT_MODEL_THINKING;
	const modelQuick = channelConfig?.claudeModelQuick || DEFAULT_MODEL_QUICK;
	const model = isMcpQuery(text) ? modelThinking : modelQuick;

	log.info(`Triggering Claude Code CLI (${model}) for ephemeral response...`);
	log.verbose(`Prompt length: ${prompt.length} chars`);

	return new Promise((resolve) => {
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

		const childProcess = spawn("claude", args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			cwd: ROOT_DIR,
		});

		let finalResponse = "";
		let buffer = "";
		let isCompleted = false;

		if (childProcess.stdout) {
			childProcess.stdout.on("data", (data) => {
				buffer += data.toString();

				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						if (event.type === "result") {
							finalResponse = event.result || "";
						}
						if (event.type === "message" && event.message?.content) {
							const textBlocks = event.message.content.filter((b: any) => b.type === "text");
							if (textBlocks.length > 0) {
								finalResponse = textBlocks.map((b: any) => b.text).join("\n");
							}
						}
					} catch (e) {
						// Not valid JSON, skip
					}
				}
			});
		}

		childProcess.on("close", async (code) => {
			if (isCompleted) return;
			isCompleted = true;

			// Process remaining buffer
			if (buffer.trim()) {
				try {
					const event = JSON.parse(buffer);
					if (event.type === "result") {
						finalResponse = event.result || "";
					}
				} catch (e) {
					// Ignore
				}
			}

			const totalSeconds = Math.round((Date.now() - startTime) / 1000);

			if (code === 0 || code === null) {
				const response = finalResponse.trim();

				if (containsSystemReminder(response)) {
					log.warn(`Ephemeral response contained system-reminder tags, discarding`);
					await sendResponse("Sorry, I couldn't process that request. Please try again.");
					resolve();
					return;
				}

				if (response) {
					log.info(`Ephemeral response (${totalSeconds}s): "${response.substring(0, 200)}${response.length > 200 ? "..." : ""}"`);
					await sendResponse(response);
				} else {
					log.warn(`Claude CLI returned empty response`);
					await sendResponse("Sorry, I couldn't generate a response. Please try again.");
				}
			} else {
				log.error(`Claude CLI exited with code ${code}`);
				await sendResponse("Sorry, I encountered an error processing your request. Please try again.");
			}
			resolve();
		});

		childProcess.on("error", async (error: any) => {
			if (isCompleted) return;
			isCompleted = true;

			log.error(`Claude CLI spawn error: ${error.message}`);
			await sendResponse(`Sorry, I encountered an error: ${error.message}`);
			resolve();
		});

		// Timeout after 300s
		setTimeout(async () => {
			if (!childProcess.killed && !isCompleted) {
				isCompleted = true;
				log.warn(`Ephemeral request timed out`);
				childProcess.kill();
				await sendResponse("⏱️ The request timed out. Please try a simpler question.");
				resolve();
			}
		}, 300000);
	});
}

// Handle /claudy slash command (private/ephemeral by default)
app.command("/claudy", async ({ command, ack, client }) => {
	// Must acknowledge within 3 seconds
	await ack();

	const { channel_id, user_id, text, response_url } = command;

	// Bot mode filter
	if (!shouldHandleChannel(channel_id)) return;

	if (!text || !text.trim()) {
		// No text provided - send ephemeral help message
		try {
			await fetch(response_url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					response_type: "ephemeral",
					text: "Usage: `/claudy <your question>`\n\nExample: `/claudy What's the status of the project?`"
				})
			});
		} catch (e) {
			log.error(`Failed to send help message:`, e);
		}
		return;
	}

	const [channelName, userName] = await Promise.all([getChannelName(channel_id), getUserName(user_id)]);
	log.info(`[COMMAND] /claudy channel=${channel_id}|#${channelName} user=${user_id}|@${userName} "${text}"`);

	// Broadcast new message event to monitor clients
	broadcastMonitorEvent("newMessage", { channel: channel_id, user: user_id });

	// Send initial "thinking" ephemeral message
	try {
		const thinkingResponse = await fetch(response_url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				response_type: "ephemeral",
				text: "_Thinking..._"
			})
		});

		if (!thinkingResponse.ok) {
			const responseText = await thinkingResponse.text();
			log.error(`[/claudy] Failed to send thinking message - ${thinkingResponse.status}: ${responseText}`);
		} else {
			log.debug(`[/claudy] Thinking message sent to response_url`);
		}
	} catch (e) {
		log.error(`Failed to send thinking message:`, e);
	}

	// Run Claude and send ephemeral response
	const sendEphemeralResponse = async (text: string) => {
		try {
			const response = await fetch(response_url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					response_type: "ephemeral",
					replace_original: true,
					text
				})
			});

			if (!response.ok) {
				const responseText = await response.text();
				log.error(`[/claudy] Slack response_url returned ${response.status}: ${responseText}`);
			} else {
				log.debug(`[/claudy] Ephemeral response sent successfully`);
			}
		} catch (e) {
			log.error(`Failed to send ephemeral response:`, e);
		}
	};

	// Queue request - only one Claude process per channel at a time
	queueClaudeRequest(channel_id, async () => {
		try {
			// Use a simplified version for ephemeral responses (no thread tracking)
			await triggerClaudeCodeEphemeral(channel_id, user_id, text, sendEphemeralResponse, client);
		} catch (error: unknown) {
			const err = error as Error;
			log.error(`Failed to process /claudy command:`, err);
			log.error(`Stack:`, err.stack);
			await sendEphemeralResponse(`Sorry, I encountered an error:\n\`\`\`\n${err.message || "Unknown error"}\n\`\`\``);
		}
	});
});

// Handle App Home opened - publish a welcome view
app.event("app_home_opened", async ({ event, client }) => {
	console.log(">>> APP HOME OPENED - Event received:", JSON.stringify(event, null, 2));
	try {
		console.log(">>> Attempting to publish App Home view for user:", event.user);
		await client.views.publish({
			user_id: event.user,
			view: {
				type: "home",
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "*👋 Hi! I'm Claudy, your AI assistant.*"
						}
					},
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "Switch to the *Messages* tab to chat with me - no @mention needed!"
						}
					},
					{
						type: "divider"
					},
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "*I can help with:*\n• Answering questions\n• Searching Jira/Confluence\n• Reading files you share\n• Remembering notes for you"
						}
					}
				]
			}
		});
		console.log(">>> SUCCESS: Published App Home view for user:", event.user);
		log.debug(`Published App Home view for user ${event.user}`);
	} catch (err: any) {
		console.log(">>> FAILED to publish App Home view:", err.message, err.data?.error);
		log.error(`Failed to publish App Home view:`, err.message);
	}
});

// Handle @mentions of the bot
app.event("app_mention", async ({ event, say, client }) => {
	// CRITICAL: Wrap entire handler in try-catch to never crash the socket
	try {
		const { channel, ts, thread_ts, user, text, files, attachments } = event as any;
		const threadTs = thread_ts || ts; // Use thread_ts if in thread, otherwise use message ts

		// Bot mode filter
		if (!shouldHandleChannel(channel)) return;

		if (!text) {
			return;
		}

		// Skip already processed mentions (use mention-specific key)
		const mentionKey = `mention-${channel}-${ts}`;
		if (processedMessages.has(mentionKey)) {
			return;
		}
		processedMessages.add(mentionKey);

		const [channelName, userName] = await Promise.all([getChannelName(channel), getUserName(user!)]);
		log.info(`[MESSAGE] channel=${channel}|#${channelName} user=${user}|@${userName} "${text}"`);
		log.debug(`Thread: ${threadTs} (tracking for replies)`);

		// Broadcast new message event to monitor clients
		broadcastMonitorEvent("newMessage", { channel, user });

		// Check for config commands first (watch, unwatch, list watched)
		if (isConfigCommand(text, BOT_USER_ID)) {
			log.debug(`Detected config command`);
			try {
				const userName = await getUserName(user!);
				const result = await processConfigCommand({
					text,
					userId: user!,
					userName,
					channelId: channel,
					client: client as any,
					botUserId: BOT_USER_ID,
					threadTs,
				});

				if (result.handled) {
					const response = result.error || result.response;
					if (response) {
						await say({
							text: response,
							thread_ts: threadTs,
						});
					}
					return;
				}
			} catch (error: any) {
				log.error(`Failed to process config command:`, error);
				await say({
					text: `Failed to process command: ${error.message || error}`,
					thread_ts: threadTs,
				});
				return;
			}
		}

		// Extract unfurl content from URL previews
		const unfurls = extractUnfurlContent(attachments);

		// Debounce rapid messages from same user in same thread
		const dKey = debounceKey(channel, threadTs, user!);
		const batch = debounceMessage(dKey, { text, ts, files, attachments });
		if (!batch) return; // Added to existing batch — first caller will handle it

		const batchResult = await batch;

		// Queue request - only one Claude process per channel at a time
		queueClaudeRequest(channel, async () => {
			try {
				const batchedUnfurls = extractUnfurlContent(batchResult.attachments);
				await triggerClaudeCode(channel, threadTs, user!, batchResult.combinedText, say, client,
					batchResult.files.length > 0 ? batchResult.files : undefined,
					false, false, batchedUnfurls.length > 0 ? batchedUnfurls : unfurls, batchResult.lastTs);
			} catch (error: unknown) {
				const err = error as Error;
				log.error(`Failed to process @mention:`, err);
				log.error(`Channel: ${channel}, Thread: ${threadTs}`);
				log.error(`Stack:`, err.stack);

				// Always notify user of errors
				try {
					await say({
						text: `Sorry, I encountered an error processing your message:\n\`\`\`\n${err.message || "Unknown error"}\n\`\`\`\nPlease try asking something else.`,
						thread_ts: threadTs,
					});
				} catch (e) {
					log.error(`[CRITICAL] Failed to send error message to Slack:`, e);
				}
			}
		});
	} catch (error) {
		// CRITICAL: Never let event handler crash
		log.error(`[CRITICAL] Event handler crashed:`, error);
		log.error(`This should never happen - event handler must be bulletproof`);
	}
});

// Handle messages (for thread replies and translation)
app.event("message", async ({ event, say, client }) => {
	// CRITICAL: Wrap entire handler in try-catch to never crash the socket
	try {
		// Type guard for message events
		if (!("user" in event) || !event.user) {
			return;
		}

		// Bot mode filter (skip for DMs — both instances handle DMs based on their own DM allowlist)
		if ("channel" in event && !isDMChannel(event.channel as string) && !shouldHandleChannel(event.channel as string)) {
			return;
		}

		// Skip bot messages
		if ("bot_id" in event && event.bot_id) {
			return;
		}

		// Skip own messages
		if (BOT_USER_ID && event.user === BOT_USER_ID) {
			return;
		}

		// Skip message subtypes (joins, leaves, etc.)
		if ("subtype" in event && event.subtype) {
			return;
		}

		const { channel, ts, thread_ts, user, text, files, attachments } = event as {
			channel: string;
			ts: string;
			thread_ts?: string;
			user: string;
			text?: string;
			files?: any[];
			attachments?: any[];
		};

		if (!text) {
			return;
		}

		// Skip already processed messages (use message-specific key)
		const messageKey = `msg-${channel}-${ts}`;
		if (processedMessages.has(messageKey)) {
			return;
		}
		processedMessages.add(messageKey);

		// Skip if this is an @mention (handled by app_mention handler)
		const botMentionPattern = BOT_USER_ID ? new RegExp(`<@${BOT_USER_ID}>`) : null;
		if (botMentionPattern && botMentionPattern.test(text)) {
			// Don't process here - let app_mention handler deal with it
			// Still save the message for summarization before returning
			const messageTimestamp = new Date((ts as any) * 1000).toISOString();
			saveRawMessage(channel, user, text, messageTimestamp, thread_ts);
			return;
		}

		// Clean up old entries (keep last 1000)
		if (processedMessages.size > 1000) {
			const entries = Array.from(processedMessages);
			entries.slice(0, 500).forEach((key) => processedMessages.delete(key));
		}

		const threadTs = thread_ts || ts;
		const isThreadReply = !!thread_ts;

		// Extract unfurl content from URL previews
		const unfurls = extractUnfurlContent(attachments);

		// Check if this is a DM channel - DMs auto-respond without @mention
		const isDM = isDMChannel(channel);
		if (isDM) {
			// Check if user is allowed to DM the bot
			if (!isUserAllowedToDM(user)) {
				const userName = await getUserName(user);
				log.info(`[DM] BLOCKED user=${user}|@${userName} - not in ALLOWED_DM_USERS`);
				try {
					await say({
						text: "Sorry, DM access is restricted to NAM organization members.",
						thread_ts: threadTs,
					});
				} catch (e) {
					log.error(`Failed to send DM restriction message:`, e);
				}
				return;
			}

			// Skip @mention check for DMs - just respond to all messages
			const userName = await getUserName(user);
			log.info(`[DM] user=${user}|@${userName} "${text}"`);

			// Broadcast new message event to monitor clients
			broadcastMonitorEvent("newMessage", { channel, user, type: "dm" });

			// Debounce rapid messages from same user in same DM thread
			const dKey = debounceKey(channel, threadTs, user);
			const batch = debounceMessage(dKey, { text, ts, files, attachments });
			if (!batch) return; // Added to existing batch

			const batchResult = await batch;

			// Queue request - only one Claude process per channel at a time
			queueClaudeRequest(channel, async () => {
				try {
					// For DMs: use threadTs if replying in thread, ts if new message
					await triggerClaudeCode(channel, threadTs, user, batchResult.combinedText, say, client,
						batchResult.files.length > 0 ? batchResult.files : files,
						true, isThreadReply, unfurls, batchResult.lastTs);
				} catch (error: unknown) {
					const err = error as Error;
					log.error(`Failed to process DM:`, err);
					log.error(`Channel: ${channel}, User: ${user}`);
					log.error(`Stack:`, err.stack);

					// Always notify user of errors
					try {
						await say({
							text: `Sorry, I encountered an error processing your message:\n\`\`\`\n${err.message || "Unknown error"}\n\`\`\`\nPlease try asking something else.`,
						});
					} catch (e) {
						log.error(`[CRITICAL] Failed to send error message to DM:`, e);
					}
				}
			});
			return; // Early return - don't continue to channel/thread logic
		}

		// Check if we need to summarize previous day's messages before saving new one
		if (hasMessagesFromPreviousDay(channel)) {
			log.info(`[Summary] Found messages from previous day in <#${channel}>, triggering daily summarization...`);
			// Run summarization in background (don't block message handler)
			summarizeChannel(channel).catch((error) => {
				log.error(`[Summary] Background summarization failed:`, error);
			});
		}

		// Save raw message to temp file for summarization
		// Include thread_ts so we can link back to original discussions in summaries
		const messageTimestamp = new Date((ts as any) * 1000).toISOString();
		saveRawMessage(channel, user, text, messageTimestamp, thread_ts);

		// Add channel to monitoring list
		monitoredChannels.add(channel);
	} catch (error) {
		// CRITICAL: Never let event handler crash
		log.error(`[CRITICAL] Message event handler crashed:`, error);
		log.error(`This should never happen - event handler must be bulletproof`);
	}
});

// Summarize and archive channel temp messages when threshold is reached
async function summarizeChannel(channelId: string): Promise<void> {
	try {
		// Load raw messages from temp file
		const rawMessages = loadRawMessages(channelId);

		if (!rawMessages || rawMessages.trim().length === 0) {
			log.debug(`[Summary] No messages to summarize for <#${channelId}>`);
			return;
		}

		const messageCount = rawMessages.split("\n").filter((line) => line.trim()).length;
		log.info(`[Summary] Processing ${messageCount} messages from <#${channelId}>`);

		// Extract useful context using Claude
		// Note: Messages may include (thread:TIMESTAMP) which can be used to generate Slack links
		const prompt = `Analyze these Slack channel messages and extract ONLY the useful context:

Messages:
${rawMessages}

Channel ID: ${channelId}

Extract and output ONLY:
1. **Links** - Any URLs shared (with brief context of what they are)
2. **Files/Resources** - Any files, documents, or resources mentioned
3. **Issues/Bugs** - Any problems, bugs, or blockers discussed
4. **Decisions** - Key decisions made or action items agreed upon

IMPORTANT: When referencing discussions, include a Slack thread link if available.
Thread links can be generated from (thread:TIMESTAMP) using format: https://slack.com/archives/${channelId}/pTIMESTAMP_WITHOUT_DOTS
Example: (thread:1736712000.123456) becomes https://slack.com/archives/${channelId}/p1736712000123456

Format as a concise bullet list. If a category has nothing, omit it entirely. If there's nothing useful at all, output: "[No significant context]"`;

		const summarizeProcess = spawn("claude", [
			"-p", prompt,
			"--model", "sonnet",
			"--mcp-config", pathResolve(ROOT_DIR, ".mcp.json"),
			"--dangerously-skip-permissions", pathResolve(ROOT_DIR, ".env"),
		], {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			cwd: ROOT_DIR,
		});

		let summary = "";
		let stderr = "";

		summarizeProcess.stdout?.on("data", (data) => {
			summary += data.toString();
		});

		summarizeProcess.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		await new Promise<void>((resolve) => {
			summarizeProcess.on("close", (code) => {
				if (code === 0 && summary.trim()) {
					const cleanSummary = summary.trim();
					if (!cleanSummary.includes("[No significant context]")) {
						saveChannelContext(channelId, cleanSummary);
						clearRawMessages(channelId);
						log.debug(`[Summary] Saved and cleared for <#${channelId}>`);
					} else {
						// Still clear even if no useful context
						clearRawMessages(channelId);
						log.debug(`[Summary] No significant context for <#${channelId}>, cleared temp file`);
					}
				} else {
					log.error(`[Summary] Failed to summarize <#${channelId}>:`, stderr);
				}
				resolve();
			});
		});
	} catch (error) {
		log.error(`[Summary] Error processing channel ${channelId}:`, error);
	}
}

// Global error handler - catch any unhandled errors
app.error(async (error) => {
	const err = error as any;
	log.error(`[CRITICAL] Slack app error: ${err?.code || err?.name || 'Unknown'}`);
	log.error(`Message: ${err?.message || err}`);
	if (err?.original) {
		log.error(`Original error: ${err.original?.message || err.original}`);
	}
	if (err?.stack) {
		log.verbose(`Stack trace:\n${err.stack}`);
	}
	if (err?.data) {
		log.verbose(`Error data:`, JSON.stringify(err.data, null, 2));
	}
	log.error("Socket connection should remain active");
	// Don't crash - just log the error
});

// Start the app
(async () => {
	try {
		// Ensure all data directories exist before anything else
		ensureDataDirs();

		// Start WebSocket server for Mac client monitor
		startMonitorWebSocket(MONITOR_WS_PORT);

		await app.start();

		// Set Slack client references for all modules
		setQueueSlackClient(app.client);
		setMonitorSlackClient(app.client);
		setSlackClient(app.client);

		// Start periodic cleanup of expired sessions
		startSessionCleanup();

		// Test API connection
		try {
			const authTest = await app.client.auth.test();
			log.info(`[OK] API connected as: ${authTest.user} (${authTest.user_id})`);
		} catch (e: any) {
			log.error(`[ERROR] API test failed: ${e.message}`);
		}

		// Start periodic cleanup of old Slack files
		startFileCleanupInterval();

		// Initialize news scheduler for scheduled news posts
		initializeNewsScheduler(app.client);

		// Initialize vacation scheduler for Monday vacation broadcasts
		initializeVacationScheduler(app.client);

		// Initialize project status scheduler for automated status reports
		initializeStatusScheduler(app.client);

		console.log("");
		console.log("========================================");
		console.log("   Claude Slack Bot (Bolt + Socket Mode)");
		console.log("========================================");
		console.log("");
		console.log("Bot is running with Socket Mode (real-time events)");
		if (DEV_CHANNEL) {
			console.log(`Mode: ${BOT_MODE.toUpperCase()} ${BOT_MODE === "dev" ? `(only #${DEV_CHANNEL})` : `(all channels except #${DEV_CHANNEL})`}`);
		}
		console.log("");
		if (BOT_USER_ID) {
			console.log(`Bot User ID: ${BOT_USER_ID}`);
		}
		console.log(`Models: per-channel config (defaults: thinking=${DEFAULT_MODEL_THINKING}, quick=${DEFAULT_MODEL_QUICK})`);
		console.log(`Auto-summary: daily (summarizes previous day's messages)`);
		console.log("");
		console.log("Listening for:");
		console.log("  - Direct Messages (auto-responds with session continuity)");
		console.log("  - @mentions of the bot");
		console.log("  - @mentions in threads");
		console.log("  - Channel messages (auto-summarizes daily)");
		console.log("  - Scheduled news posts (configure via 'news subscribe')");
		console.log("  - Vacation broadcasts (Monday 9AM, configure 'vacationBroadcast' in channel config)");
		console.log("");
		console.log("Press Ctrl+C to stop");
		console.log("========================================");
		console.log("");
	} catch (error) {
		log.error("[FATAL] Failed to start Slack app:", error);
		process.exit(1);
	}
})();

// Handle graceful shutdown
process.on("SIGINT", async () => {
	log.info("\nShutting down...");
	stopAllNewsJobs();
	stopAllVacationJobs();
	stopAllStatusJobs();
	await app.stop();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	log.info("\nShutting down...");
	stopAllNewsJobs();
	stopAllVacationJobs();
	stopAllStatusJobs();
	await app.stop();
	process.exit(0);
});
