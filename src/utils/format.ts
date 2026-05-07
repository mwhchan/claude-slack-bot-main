// Slack message length limit (with safety margin)
const SLACK_MAX_LENGTH = 39000;

// Truncate message for Slack if too long
export function truncateForSlack(text: string, maxLength: number = SLACK_MAX_LENGTH): string {
	if (text.length <= maxLength) {
		return text;
	}

	const truncationNotice = "\n\n_... (truncated - message too long for Slack)_";
	const availableLength = maxLength - truncationNotice.length;

	// Try to truncate at a natural break point (newline)
	let cutPoint = text.lastIndexOf("\n", availableLength);
	if (cutPoint < availableLength * 0.8) {
		// If no good break point, just cut at max length
		cutPoint = availableLength;
	}

	return text.substring(0, cutPoint) + truncationNotice;
}

// Format tool name for display (e.g., "mcp__atlassian__getJiraIssue" -> "Jira: Get Issue")
// Optional toolInput can be used to provide more context-aware names
export function formatToolName(toolName: string, toolInput?: any): string {
	// Special MCP server name mappings
	const serverDisplayNames: Record<string, string> = {
		atlassian: "Jira",
		notebooklm: "NotebookLM",
		context7: "Docs",
		figma: "Figma",
		google: "Google",
	};

	// MCP tool pattern: mcp__server__toolName
	const mcpMatch = toolName.match(/^mcp__(\w+)__(\w+)$/);
	if (mcpMatch) {
		const [, server, tool] = mcpMatch;
		// Use custom display name or capitalize server name
		const serverName = serverDisplayNames[server] || server.charAt(0).toUpperCase() + server.slice(1);
		// Format tool name (camelCase to Title Case)
		const formattedTool = tool
			.replace(/([A-Z])/g, " $1")
			.replace(/^./, (s) => s.toUpperCase())
			.trim();
		return `${serverName}: ${formattedTool}`;
	}

	// Check if this is a memory operation (file path contains /context/)
	const filePath = toolInput?.file_path || toolInput?.path || "";
	const isMemoryOp = filePath.includes("/context/") || filePath.includes("context.md");
	const isConfigOp = filePath.includes("config.json");

	// Built-in tools with context-aware names
	if (toolName === "Read") {
		if (isMemoryOp) return "Recalling memory";
		if (isConfigOp) return "Checking config";
		return "Reading";
	}
	if (toolName === "Write") {
		if (isMemoryOp) return "Saving to memory";
		if (isConfigOp) return "Updating config";
		return "Writing";
	}
	if (toolName === "Edit") {
		if (isMemoryOp) return "Updating memory";
		if (isConfigOp) return "Updating config";
		return "Editing";
	}

	// Other built-in tools
	const builtInNames: Record<string, string> = {
		Glob: "Searching files",
		Grep: "Searching code",
		Bash: "Running command",
		WebFetch: "Fetching page",
		WebSearch: "Searching web",
	};

	return builtInNames[toolName] || toolName;
}

// Threshold: only use blocks for messages longer than this.
// Shorter messages rely on Slack's native rendering.
const BLOCKS_THRESHOLD = 1500;

// Build Block Kit section blocks from text.
// Returns undefined for short messages (use plain text instead).
// Keeps paragraphs together in one block until hitting 3000-char limit,
// then starts a new block at the next paragraph boundary.
export function buildSectionBlocks(text: string): any[] | undefined {
	if (text.length <= BLOCKS_THRESHOLD) return undefined;
	const paragraphs = text.split(/\n{2,}/);
	const blocks: any[] = [];
	let current = "";

	// Push content as blocks, hard-splitting anything over 3000 chars
	const pushBlock = (content: string) => {
		while (content.length > 3000) {
			let splitAt = content.lastIndexOf("\n", 3000);
			if (splitAt < 1000) splitAt = content.lastIndexOf(" ", 3000);
			if (splitAt < 1000) splitAt = 3000;
			blocks.push({
				type: "section",
				text: { type: "mrkdwn", text: content.slice(0, splitAt) },
			});
			content = content.slice(splitAt).trimStart();
		}
		if (content) {
			blocks.push({
				type: "section",
				text: { type: "mrkdwn", text: content },
			});
		}
	};

	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (!trimmed) continue;

		const candidate = current ? current + "\n\n" + trimmed : trimmed;

		if (candidate.length > 3000 && current) {
			pushBlock(current);
			current = trimmed;
		} else {
			current = candidate;
		}
	}

	if (current) {
		pushBlock(current);
	}

	return blocks.slice(0, 50);
}
