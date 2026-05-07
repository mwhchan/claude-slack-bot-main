// Detect if message is an MCP/search query (use cheaper model)
export function isMcpQuery(text: string): boolean {
	const mcpKeywords = [
		// Jira/Confluence
		"jira", "ticket", "bug", "issue", "confluence", "sprint", "epic", "story", "task",
		// NotebookLM
		"notebooklm", "notebook", "sow", "requirements", "documentation", "docs",
		// Google Drive
		"drive", "google drive", "my files", "my documents",
		// Search actions
		"find", "search", "look up", "lookup", "get", "fetch", "check", "what is", "what's",
		// Project queries (multi-source search)
		"project plan", "milestone", "timeline", "roadmap", "status",
		"meeting", "retro", "retrospective", "vacation", "pto", "out of office",
	];
	const lowerText = text.toLowerCase();
	return mcpKeywords.some((keyword) => lowerText.includes(keyword));
}

// Detect if channel is a Direct Message (DM channels start with "D")
export function isDMChannel(channelId: string): boolean {
	return channelId.startsWith("D");
}

// Check if response contains leaked system-reminder tags
export function containsSystemReminder(text: string): boolean {
	return /<system-reminder>/i.test(text);
}
