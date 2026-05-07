import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";
import { isDMChannel } from "../utils/detection.js";
import { CHANNEL_CONTEXT_DIR, USER_CONTEXT_DIR } from "../config/paths.js";

// Slack client reference for fetching names (set via setSlackClient)
let slackClientForFetching: any = null;

// Set the Slack client reference (call this after app init)
export function setSlackClient(client: any): void {
	slackClientForFetching = client;
}

// Create channel context folder with config.json and context.md
export function ensureChannelContextFolder(channelId: string, channelName: string): void {
	const channelDir = pathResolve(CHANNEL_CONTEXT_DIR, channelId);

	// Skip if folder already exists
	if (existsSync(channelDir)) return;

	try {
		mkdirSync(channelDir, { recursive: true });

		// Create config.json
		const config = {
			type: "channel",
			id: channelId,
			name: channelName,
			displayName: channelName,
		};
		writeFileSync(pathResolve(channelDir, "config.json"), JSON.stringify(config, null, 2));

		// Create blank context.md
		writeFileSync(pathResolve(channelDir, "context.md"), "");

		log.info(`[Context] Created folder for channel #${channelName} (${channelId})`);
	} catch (error: any) {
		log.error(`Failed to create channel context folder: ${error?.message}`);
	}
}

// Create user context folder with config.json and context.md
export function ensureUserContextFolder(userId: string, realName: string, username: string, email?: string): void {
	const userDir = pathResolve(USER_CONTEXT_DIR, userId);

	// Skip if folder already exists
	if (existsSync(userDir)) return;

	try {
		mkdirSync(userDir, { recursive: true });

		// Create config.json
		const config: Record<string, string> = {
			type: "user",
			id: userId,
			name: username,
			displayName: realName,
		};
		if (email) {
			config.email = email;
		}
		writeFileSync(pathResolve(userDir, "config.json"), JSON.stringify(config, null, 2));

		// Create blank context.md
		writeFileSync(pathResolve(userDir, "context.md"), "");

		log.info(`[Context] Created folder for user @${username} (${userId})`);
	} catch (error: any) {
		log.error(`Failed to create user context folder: ${error?.message}`);
	}
}

// Fetch single channel name from Slack API
export async function fetchChannel(channelId: string): Promise<string | null> {
	// DM channels (start with D) don't have a name - return "Direct Message"
	if (isDMChannel(channelId)) {
		return "Direct Message";
	}

	if (!slackClientForFetching) return null;
	try {
		const result = await slackClientForFetching.conversations.info({ channel: channelId });
		if (result.channel?.name) {
			// Create context folder if it doesn't exist
			ensureChannelContextFolder(channelId, result.channel.name);
			return result.channel.name;
		}
	} catch (error: any) {
		log.debug(`Failed to fetch channel ${channelId}: ${error?.message}`);
	}
	return null;
}

// Fetch single user info from Slack API
export async function fetchUser(userId: string): Promise<{ realName: string; username: string; email?: string } | null> {
	if (!slackClientForFetching) return null;
	try {
		const result = await slackClientForFetching.users.info({ user: userId });
		if (result.user) {
			const username = result.user.name || userId;
			const realName = result.user.real_name || result.user.profile?.display_name || result.user.name || userId;
			const email = result.user.profile?.email;

			// Create context folder if it doesn't exist
			ensureUserContextFolder(userId, realName, username, email);

			return { realName, username, email };
		}
	} catch (error: any) {
		log.debug(`Failed to fetch user ${userId}: ${error?.message}`);
	}
	return null;
}

// Get channel name (fallback to ID if fetch fails)
export async function getChannelName(channelId: string): Promise<string> {
	const fetched = await fetchChannel(channelId);
	return fetched || channelId;
}

// Get user name (fallback to ID if fetch fails)
export async function getUserName(userId: string): Promise<string> {
	const fetched = await fetchUser(userId);
	return fetched?.realName || userId;
}

// Extract unique user IDs from thread history text
export function extractUserIdsFromHistory(history: string): string[] {
	// Match user IDs in format (U...) from thread history
	const userIdPattern = /\(U[A-Z0-9]+\)/g;
	const matches = history.match(userIdPattern) || [];
	const userIds = matches.map(m => m.slice(1, -1)); // Remove parentheses
	return [...new Set(userIds)];
}
