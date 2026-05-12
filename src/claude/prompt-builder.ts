import { log } from "../utils/log.js";
import { downloadSlackFiles } from "../slack/files.js";
import { fetchCanvases } from "../slack/canvas.js";
import { fetchThreadHistory, fetchDMHistory } from "../slack/history.js";
import { getUserName, getChannelName, extractUserIdsFromHistory } from "../slack/context.js";
import { getChannelContextPath, getChannelConfigPath, getUserContextPath, getChannelMemoryPath, getUserMemoryPath } from "../config/loader.js";
import { formatUnfurlsForPrompt, type UnfurlContent } from "../slack/unfurl.js";
import { buildSkillsPromptSection } from "./skills-loader.js";
import type { DownloadedFile, CanvasInfo } from "../types/index.js";
import { resolve as pathResolve } from "node:path";
import { ROOT_DIR } from "../config/paths.js";

// GitHub second-brain context instruction
function getGitHubContextSection(): string {
	return `## GitHub Repository: mwhchan/TheForge

TheForge is the Provident Ark team's second brain — it contains documentation, project updates, decisions, notes, and code.

### Reading from TheForge
Before answering any question, follow these steps:
1. Fetch the root CLAUDE.md file first: \`get_file_contents({ owner: "mwhchan", repo: "TheForge", path: "CLAUDE.md" })\`
2. CLAUDE.md is the index — it tells you which files and directories are relevant to which topics
3. Based on the user's question, fetch only the specific files the index points you to

Always cite the file path when you reference something from the repo (e.g. "According to \`docs/architecture.md\` in TheForge...").

### Writing to TheForge (commit & push)
You have full write access to mwhchan/TheForge via the GitHub MCP tools. Use these when the user asks you to save, update, create, or commit anything to the repo:

- **Create or update a file:** \`create_or_update_file({ owner: "mwhchan", repo: "TheForge", path: "...", message: "commit message", content: "<base64>", branch: "main" })\`
  - Always fetch the file first with \`get_file_contents\` to get its current \`sha\` (required for updates)
  - Encode content as base64
- **Push multiple files at once:** \`push_files({ owner: "mwhchan", repo: "TheForge", branch: "main", files: [...], message: "commit message" })\`
- **Create a branch:** \`create_branch({ owner: "mwhchan", repo: "TheForge", branch: "feature/..." })\`
- **Open a PR:** \`create_pull_request({ owner: "mwhchan", repo: "TheForge", title: "...", body: "...", head: "feature/...", base: "main" })\`

When the user asks to commit or save something to TheForge, do it directly — don't ask them to do it manually. Confirm with the commit URL after.

`;
}

// Helper to get current date context for news filtering
function getCurrentDateContext(): string {
	const now = new Date();
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);

	const formatDate = (d: Date) => d.toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	const formatShort = (d: Date) => d.toISOString().split("T")[0];

	return `## Current Date (for news filtering)
- Today: ${formatDate(now)} (${formatShort(now)})
- Yesterday: ${formatDate(yesterday)} (${formatShort(yesterday)})
- 24-hour cutoff: ${yesterday.toISOString()}
- For news searches: ONLY include articles dated ${formatShort(now)} or ${formatShort(yesterday)}

`;
}

// Result of building a prompt
export interface PromptResult {
	prompt: string;
	hasHistory: boolean;
	hasChannelHistory: boolean;
	uniqueGoogleUrls: string[];
	slackFilesCount: number;
	canvasCount: number;
	unfurlCount: number;
	initialSeenUserIds: string[];
}

// ============================================================================
// DM Prompt Builder
// ============================================================================

export async function buildDMPrompt(
	client: any,
	channelId: string,
	userId: string,
	text: string,
	messageFiles?: any[],
	isThreadReply: boolean = false,
	threadTs?: string,
	isResuming: boolean = false,
	seenUserIds: string[] = [],
	unfurls: UnfurlContent[] = []
): Promise<PromptResult> {
	const userName = await getUserName(userId);
	const botToken = process.env.SLACK_BOT_TOKEN!;

	// For resumed sessions, check if current user is new to this conversation
	let newUserContext = "";
	if (isResuming && !seenUserIds.includes(userId)) {
		const userContextPath = getUserContextPath(userId);
		const userMemoryPath = getUserMemoryPath(userId);
		const refs = [userContextPath, userMemoryPath].filter(Boolean).map(p => `@${p}`);
		if (refs.length > 0) {
			newUserContext = refs.join(" ") + "\n\n";
			log.debug(`Including context for new user ${userId} joining DM thread`);
		}
		seenUserIds.push(userId);
	}

	// Fetch conversation history
	// If replying in a thread, fetch that thread's history; otherwise fetch channel history
	const conversationHistory = isThreadReply && threadTs
		? await fetchThreadHistory(client, channelId, threadTs)
		: await fetchDMHistory(client, channelId, threadTs || "", 100, userId);
	const hasHistory = conversationHistory.length > 0;

	// Build history section
	let historySection = "";
	if (hasHistory) {
		const maxHistoryLength = 8000;
		const truncatedHistory = conversationHistory.length > maxHistoryLength
			? "...\n" + conversationHistory.slice(-maxHistoryLength)
			: conversationHistory;
		const historyLabel = isThreadReply ? "Thread History" : "Recent DM History";
		historySection = `## ${historyLabel} (for context)

${truncatedHistory}

`;
	}

	// Download Slack files and fetch canvases from the current message
	const downloadedSlackFiles = await downloadSlackFiles(client, text, botToken, messageFiles);
	const fetchedCanvases = await fetchCanvases(client, text, botToken, messageFiles, channelId, true);

	// Build file references for any new files/canvases
	let attachmentsContext = "";
	if (downloadedSlackFiles.length > 0) {
		const fileRefs = downloadedSlackFiles.map(f => `@${f.localPath}`).join(" ");
		attachmentsContext += `${fileRefs}\n\n`;
		attachmentsContext += `## Slack Files Attached\n\n${downloadedSlackFiles.map(f => `- ${f.name} (${f.mimetype})`).join("\n")}\n\n`;
	}
	if (fetchedCanvases.length > 0) {
		const canvasSections = fetchedCanvases.map((canvas) => {
			const permalinkNote = canvas.permalink ? `\nPermalink: ${canvas.permalink}` : "";
			return `### ${canvas.title}${permalinkNote}\n\n${canvas.content}`;
		}).join("\n\n---\n\n");
		attachmentsContext += `## Slack Canvases\n\nThe following Slack Canvas documents were shared:\n\n${canvasSections}\n\n`;
	}

	// Extract Google URLs from history and current message
	const googleUrlPattern = /https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/[^\s>]+/g;
	const historyUrls = conversationHistory.match(googleUrlPattern) || [];
	const currentMsgUrls = text.match(googleUrlPattern) || [];
	const uniqueGoogleUrls = [...new Set([...historyUrls, ...currentMsgUrls])];

	let googleUrlsContext = "";
	if (uniqueGoogleUrls.length > 0) {
		googleUrlsContext = `
## Important: Previously Shared Files in This Conversation

The following Google files were shared in this conversation. If the user's question relates to these files, you MUST re-fetch them using the Google skills to answer accurately:

${uniqueGoogleUrls.map((url) => `- ${url}`).join("\n")}

Use: cd .claude/skills/google && python3 scripts/run.py get_file.py --file-url "URL"

`;
	}

	// Build metadata section for DM
	const botUserId = process.env.BOT_USER_ID || "";
	const metadataSection = isResuming
		? `Bot User ID: ${botUserId} (this is YOUR user ID - @mentions containing this ID are directed at YOU)
To save to memory: [MEMORY_SAVE:user]{new content}[/MEMORY_SAVE] (append) or [MEMORY_UPDATE:user]{full updated memory}[/MEMORY_UPDATE] (rewrite)

`
		: `
## Internal Context (do not mention these technical details in your response)

- This is a Direct Message conversation
- Speaking with: ${userName} (User ID: ${userId})
- **Your Bot User ID: ${botUserId}** (messages with <@${botUserId}> are directed at YOU)

## Memory Instructions
When user asks to "save", "remember", or "memorize" something:
- Read existing memory first (included via @ file reference above)
- If adding NEW info not already in memory: [MEMORY_SAVE:user]{new content}[/MEMORY_SAVE]
- If UPDATING/reorganizing existing memory: [MEMORY_UPDATE:user]{complete rewritten memory content}[/MEMORY_UPDATE]
Then confirm: "Saved to your personal memory!" or "Updated your personal memory!"

`;

	// Include user context for new sessions
	let userContextRefs = "";
	let initialUserIds = seenUserIds;
	if (!isResuming) {
		const userIdsInThread = extractUserIdsFromHistory(conversationHistory);
		userIdsInThread.push(userId);
		initialUserIds = [...new Set(userIdsInThread)];
		const userFilePaths: string[] = [];
		for (const uid of initialUserIds) {
			const userContextPath = getUserContextPath(uid);
			const userMemoryPath = getUserMemoryPath(uid);
			if (userContextPath) userFilePaths.push(`@${userContextPath}`);
			if (userMemoryPath) userFilePaths.push(`@${userMemoryPath}`);
		}
		if (userFilePaths.length > 0) {
			userContextRefs = userFilePaths.join(" ") + "\n\n";
		}
	}

	// Format unfurl content
	const unfurlContext = formatUnfurlsForPrompt(unfurls);

	// Get current date context for news filtering
	const dateContext = getCurrentDateContext();

	// Build skills section (auto-detection)
	const skillsDir = pathResolve(ROOT_DIR, ".claude/skills");
	const skillsSection = buildSkillsPromptSection(skillsDir);

	const githubContext = getGitHubContextSection();

	const prompt = `${skillsSection}${userContextRefs}${newUserContext}${metadataSection}${dateContext}${githubContext}${googleUrlsContext}${attachmentsContext}${unfurlContext}${historySection}${userName} just said:
"${text}"

Reply naturally and conversationally.${hasHistory ? " Take into account the conversation history above." : ""}`;

	return {
		prompt,
		hasHistory,
		hasChannelHistory: false,
		uniqueGoogleUrls,
		slackFilesCount: downloadedSlackFiles.length,
		canvasCount: fetchedCanvases.length,
		unfurlCount: unfurls.length,
		initialSeenUserIds: initialUserIds,
	};
}

// ============================================================================
// Channel Thread Prompt Builder
// ============================================================================

export async function buildChannelThreadPrompt(
	client: any,
	channelId: string,
	threadTs: string,
	userId: string,
	text: string,
	messageFiles?: any[],
	isResuming: boolean = false,
	seenUserIds: string[] = [],
	unfurls: UnfurlContent[] = [],
): Promise<PromptResult> {
	const userName = await getUserName(userId);
	const channelName = await getChannelName(channelId);
	const botToken = process.env.SLACK_BOT_TOKEN!;

	// For resumed sessions, check if current user is new to this conversation
	let newUserContext = "";
	if (isResuming && !seenUserIds.includes(userId)) {
		const userContextPath = getUserContextPath(userId);
		const userMemoryPath = getUserMemoryPath(userId);
		const refs = [userContextPath, userMemoryPath].filter(Boolean).map(p => `@${p}`);
		if (refs.length > 0) {
			newUserContext = refs.join(" ") + "\n\n";
			log.debug(`Including context for new user ${userId} joining thread`);
		}
		seenUserIds.push(userId);
	}

	// Always fetch thread history for channel threads
	const conversationHistory = await fetchThreadHistory(client, channelId, threadTs);
	const hasHistory = conversationHistory.length > 0;

	// Download Slack files from the message
	const downloadedSlackFiles = await downloadSlackFiles(client, text, botToken, messageFiles);

	// Fetch any canvases shared in the message, plus the channel canvas if it exists
	const fetchedCanvases = await fetchCanvases(client, text, botToken, messageFiles, channelId, true);

	// Get file paths for @ references (Claude CLI will read these files)
	const configPath = getChannelConfigPath(channelId);
	const contextPath = getChannelContextPath(channelId);
	const memoryPath = getChannelMemoryPath(channelId);
	const hasChannelHistory = contextPath !== null || memoryPath !== null;

	// Build @ file references section
	const fileRefs: string[] = [];
	if (configPath) fileRefs.push(`@${configPath}`);
	if (contextPath) fileRefs.push(`@${contextPath}`);
	if (memoryPath) fileRefs.push(`@${memoryPath}`);

	// Add downloaded Slack files as @ references
	for (const slackFile of downloadedSlackFiles) {
		fileRefs.push(`@${slackFile.localPath}`);
	}

	// Include user context files for users involved in the conversation
	const userIdsInThread = extractUserIdsFromHistory(conversationHistory);
	userIdsInThread.push(userId); // Always include current user
	const uniqueUserIds = [...new Set(userIdsInThread)];
	for (const uid of uniqueUserIds) {
		const userContextPath = getUserContextPath(uid);
		const userMemoryPath = getUserMemoryPath(uid);
		if (userContextPath) fileRefs.push(`@${userContextPath}`);
		if (userMemoryPath) fileRefs.push(`@${userMemoryPath}`);
	}

	const fileRefsSection = fileRefs.length > 0 ? fileRefs.join(" ") + "\n\n" : "";

	// Build conversation history section (from Slack API, not a file)
	let historySection = "";
	if (hasHistory) {
		const maxHistoryLength = 8000;
		const truncatedHistory =
			conversationHistory.length > maxHistoryLength
				? "...\n" + conversationHistory.slice(-maxHistoryLength)
				: conversationHistory;

		historySection = `Here is the conversation history in this thread:

${truncatedHistory}

`;
	}

	// Build metadata section for channel
	const botUserId = process.env.BOT_USER_ID || "";
	const metadataSection = isResuming
		? `Bot User ID: ${botUserId} (this is YOUR user ID - @mentions containing this ID are directed at YOU)
Memory: read existing memory first. Append new: [MEMORY_SAVE:channel]{new}[/MEMORY_SAVE]. Rewrite/update: [MEMORY_UPDATE:channel]{full content}[/MEMORY_UPDATE]. User personal: use :user instead of :channel.

`
		: `
## Internal Context (do not mention these technical details in your response)

- Channel: #${channelName} (ID: ${channelId})
- Speaking with: ${userName} (User ID: ${userId})
- Thread: ${threadTs}
- **Your Bot User ID: ${botUserId}** (messages with <@${botUserId}> are directed at YOU)

## Memory Instructions
When user asks to "save", "remember", or "memorize" something:
- Read existing channel memory first (included via @ file reference above)
- If adding NEW info not already in memory → append: [MEMORY_SAVE:channel]{new content}[/MEMORY_SAVE]
- If info overlaps or should UPDATE existing memory → rewrite: [MEMORY_UPDATE:channel]{complete rewritten memory}[/MEMORY_UPDATE]
- Only use :user if user explicitly says "personal memory" or "private memory"
Then confirm: "Saved to this channel's memory!" or "Updated this channel's memory!"

`;

	// Extract Google Docs/Sheets/Slides URLs from conversation history AND current message
	const googleUrlPattern = /https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/[^\s>]+/g;
	const historyUrls = conversationHistory.match(googleUrlPattern) || [];
	const currentMsgUrls = text.match(googleUrlPattern) || [];
	const uniqueGoogleUrls = [...new Set([...historyUrls, ...currentMsgUrls])];

	let googleUrlsContext = "";
	if (uniqueGoogleUrls.length > 0) {
		googleUrlsContext = `
## Important: Previously Shared Files in This Conversation

The following Google files were shared in this thread. If the user's question relates to these files, you MUST re-fetch them using the Google skills to answer accurately:

${uniqueGoogleUrls.map((url) => `- ${url}`).join("\n")}

Use: cd .claude/skills/google && python3 scripts/run.py get_file.py --file-url "URL"

`;
	}

	// Add context about downloaded Slack files
	let slackFilesContext = "";
	if (downloadedSlackFiles.length > 0) {
		slackFilesContext = `
## Slack Files Attached

The following files from Slack have been downloaded and are available via @ file references above:

${downloadedSlackFiles.map((f) => `- ${f.name} (${f.mimetype})`).join("\n")}

You can read these files directly using the Read tool if needed.

`;
	}

	// Add context about fetched Slack canvases
	let canvasContext = "";
	if (fetchedCanvases.length > 0) {
		const canvasSections = fetchedCanvases.map((canvas) => {
			const permalinkNote = canvas.permalink ? `\nPermalink: ${canvas.permalink}` : "";
			return `### ${canvas.title}${permalinkNote}\n\n${canvas.content}`;
		}).join("\n\n---\n\n");

		canvasContext = `
## Slack Canvases

The following Slack Canvas documents were shared. Their content is included below:

${canvasSections}

`;
	}

	// Format unfurl content
	const unfurlContext = formatUnfurlsForPrompt(unfurls);

	// Get current date context for news filtering
	const dateContext = getCurrentDateContext();

	// Build skills section (auto-detection)
	const skillsDir = pathResolve(ROOT_DIR, ".claude/skills");
	const skillsSection = buildSkillsPromptSection(skillsDir);

	const githubContext = getGitHubContextSection();

	// Direct @mention or DM - always reply
	const endingInstruction = `Reply naturally and conversationally to ${userName}.${hasHistory ? " Take into account the conversation history above." : ""} If the question relates to shared files, read them.`;

	const prompt = `${skillsSection}${fileRefsSection}${newUserContext}${metadataSection}${dateContext}${githubContext}${googleUrlsContext}${slackFilesContext}${canvasContext}${unfurlContext}${historySection}${userName} just said:
"${text}"

${endingInstruction}`;

	return {
		prompt,
		hasHistory,
		hasChannelHistory,
		uniqueGoogleUrls,
		slackFilesCount: downloadedSlackFiles.length,
		canvasCount: fetchedCanvases.length,
		unfurlCount: unfurls.length,
		initialSeenUserIds: uniqueUserIds,
	};
}
