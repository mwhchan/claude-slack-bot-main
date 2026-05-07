/**
 * Slack Link Parser Utility
 * Parses Slack URLs to extract channel IDs, user IDs, and message timestamps
 */

export interface ParsedSlackLink {
	type: "channel" | "user" | "message";
	id: string;
	messageTs?: string; // Only for message links
	workspaceOrTeam?: string;
}

/**
 * Parse a Slack URL or link to extract the resource type and ID
 *
 * Supported formats:
 * - Channel: https://slack.com/archives/C0A7U1W8WR4
 * - Channel: https://workspace.slack.com/archives/C0A7U1W8WR4
 * - Channel: slack://channel?team=T123&id=C0A7U1W8WR4
 * - User: https://slack.com/team/U012AB3CD
 * - User: https://workspace.slack.com/team/U012AB3CD
 * - Message: https://workspace.slack.com/archives/C0A7U1W8WR4/p1234567890123456
 * - Raw ID: C0A7U1W8WR4 (channel) or U012AB3CD (user)
 */
export function parseSlackLink(input: string): ParsedSlackLink | null {
	const trimmed = input.trim();

	// Try to parse as URL first
	const urlResult = parseSlackUrl(trimmed);
	if (urlResult) {
		return urlResult;
	}

	// Try to parse as raw ID
	const rawIdResult = parseRawId(trimmed);
	if (rawIdResult) {
		return rawIdResult;
	}

	return null;
}

/**
 * Parse a Slack URL
 */
function parseSlackUrl(url: string): ParsedSlackLink | null {
	// Handle slack:// protocol URLs
	if (url.startsWith("slack://")) {
		return parseSlackProtocolUrl(url);
	}

	// Handle https:// URLs
	if (url.startsWith("http://") || url.startsWith("https://")) {
		return parseSlackHttpUrl(url);
	}

	return null;
}

/**
 * Parse slack:// protocol URLs
 * Examples:
 * - slack://channel?team=T123&id=C0A7U1W8WR4
 * - slack://user?team=T123&id=U012AB3CD
 */
function parseSlackProtocolUrl(url: string): ParsedSlackLink | null {
	try {
		const parsed = new URL(url);
		const id = parsed.searchParams.get("id");
		const team = parsed.searchParams.get("team");

		if (!id) return null;

		if (parsed.hostname === "channel" || parsed.pathname.includes("channel")) {
			return { type: "channel", id, workspaceOrTeam: team || undefined };
		}

		if (parsed.hostname === "user" || parsed.pathname.includes("user")) {
			return { type: "user", id, workspaceOrTeam: team || undefined };
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Parse https:// Slack URLs
 * Examples:
 * - https://slack.com/archives/C0A7U1W8WR4
 * - https://workspace.slack.com/archives/C0A7U1W8WR4
 * - https://workspace.slack.com/archives/C0A7U1W8WR4/p1234567890123456
 * - https://slack.com/team/U012AB3CD
 * - https://workspace.slack.com/team/U012AB3CD
 */
function parseSlackHttpUrl(url: string): ParsedSlackLink | null {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname;
		const pathParts = parsed.pathname.split("/").filter(Boolean);

		// Extract workspace from hostname (e.g., "myworkspace" from "myworkspace.slack.com")
		let workspace: string | undefined;
		if (hostname.endsWith(".slack.com") && hostname !== "slack.com") {
			workspace = hostname.replace(".slack.com", "");
		}

		// Channel link: /archives/C0A7U1W8WR4
		if (pathParts[0] === "archives" && pathParts[1]) {
			const channelId = pathParts[1];

			// Check if it's a message link: /archives/C0A7U1W8WR4/p1234567890123456
			if (pathParts[2] && pathParts[2].startsWith("p")) {
				const messageTs = pathParts[2].slice(1); // Remove 'p' prefix
				// Convert to Slack timestamp format (add decimal point)
				const formattedTs = messageTs.slice(0, 10) + "." + messageTs.slice(10);
				return {
					type: "message",
					id: channelId,
					messageTs: formattedTs,
					workspaceOrTeam: workspace,
				};
			}

			return { type: "channel", id: channelId, workspaceOrTeam: workspace };
		}

		// User link: /team/U012AB3CD
		if (pathParts[0] === "team" && pathParts[1]) {
			return { type: "user", id: pathParts[1], workspaceOrTeam: workspace };
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Parse a raw Slack ID (channel or user)
 * Channel IDs start with C, D (DM), or G (group)
 * User IDs start with U or W (workspace user)
 */
function parseRawId(input: string): ParsedSlackLink | null {
	// Clean up any angle brackets from Slack formatting
	const cleaned = input.replace(/^<#|^<@|>$/g, "").split("|")[0];

	// Channel ID pattern: starts with C, D, or G followed by alphanumeric
	if (/^[CDG][A-Z0-9]{8,}$/i.test(cleaned)) {
		return { type: "channel", id: cleaned.toUpperCase() };
	}

	// User ID pattern: starts with U or W followed by alphanumeric
	if (/^[UW][A-Z0-9]{8,}$/i.test(cleaned)) {
		return { type: "user", id: cleaned.toUpperCase() };
	}

	return null;
}

/**
 * Extract all Slack links from a text message
 */
export function extractSlackLinks(text: string): ParsedSlackLink[] {
	const links: ParsedSlackLink[] = [];

	// Match URLs
	const urlPattern = /https?:\/\/[^\s<>]+slack\.com[^\s<>]*/gi;
	const urls = text.match(urlPattern) || [];

	for (const url of urls) {
		const parsed = parseSlackLink(url);
		if (parsed) {
			links.push(parsed);
		}
	}

	// Match Slack-formatted channel mentions: <#C0A7U1W8WR4|channel-name>
	const channelMentionPattern = /<#([CDG][A-Z0-9]+)(?:\|[^>]*)?>/gi;
	let match;
	while ((match = channelMentionPattern.exec(text)) !== null) {
		links.push({ type: "channel", id: match[1] });
	}

	// Match Slack-formatted user mentions: <@U012AB3CD|username>
	const userMentionPattern = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/gi;
	while ((match = userMentionPattern.exec(text)) !== null) {
		links.push({ type: "user", id: match[1] });
	}

	// Deduplicate by id
	const seen = new Set<string>();
	return links.filter((link) => {
		const key = `${link.type}:${link.id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Format a channel or user ID as a Slack mention
 */
export function formatAsMention(type: "channel" | "user", id: string): string {
	if (type === "channel") {
		return `<#${id}>`;
	}
	return `<@${id}>`;
}
