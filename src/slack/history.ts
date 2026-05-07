import { log } from "../utils/log.js";
import { getUserName } from "./context.js";

// Fetch full thread history from Slack API
export async function fetchThreadHistory(client: any, channelId: string, threadTs: string): Promise<string> {
	try {
		const result = await client.conversations.replies({
			channel: channelId,
			ts: threadTs,
			limit: 200, // Get up to 200 messages in thread
		});

		if (!result.messages || result.messages.length === 0) {
			return "";
		}

		// Format all messages in chronological order with resolved user names
		const formattedMessages = await Promise.all(
			result.messages.map(async (msg: any) => {
				const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
				const userId = msg.user || "unknown";
				const userName = await getUserName(userId);
				const text = msg.text || "";
				return `[${timestamp}] ${userName} (${userId}): ${text}`;
			})
		);

		return formattedMessages.join("\n");
	} catch (error: any) {
		log.error(`[Slack API] conversations.replies failed: ${error?.code || error?.name} - ${error?.message}`);
		if (error?.data) {
			log.verbose(`[Slack API] Error details:`, JSON.stringify(error.data, null, 2));
		}
		return "";
	}
}

// Fetch DM conversation history from Slack API (for direct messages)
// For /claude command, we receive the channel ID from Slack but may need to open the conversation first
export async function fetchDMHistory(
	client: any,
	channelId: string,
	beforeTs?: string,
	limit: number = 50,
	userId?: string  // Optional: if provided, will try to open DM with this user if channel_not_found
): Promise<string> {
	try {
		// Use INFO level to ensure these logs are visible
		log.info(`[DM History] START - channel=${channelId}, userId=${userId || 'MISSING'}`);

		let dmChannelId = channelId;

		// If we have a userId, ALWAYS try to open/get the DM channel first
		// This is required because the channel_id from slash commands may not be accessible
		// without first "opening" the conversation
		if (userId) {
			try {
				log.info(`[DM History] Opening DM with user ${userId}...`);
				const openResult = await client.conversations.open({ users: userId });
				log.info(`[DM History] conversations.open result: ok=${openResult.ok}, channel_id=${openResult.channel?.id || 'none'}`);

				if (openResult.ok && openResult.channel?.id) {
					dmChannelId = openResult.channel.id;
					log.info(`[DM History] Using opened DM channel: ${dmChannelId}`);
				} else {
					log.warn(`[DM History] conversations.open returned ok=${openResult.ok} but no channel ID`);
				}
			} catch (openError: any) {
				log.warn(`[DM History] conversations.open FAILED: ${openError?.code || openError?.name} - ${openError?.message}`);
				if (openError?.data) {
					log.verbose(`[DM History] conversations.open error details:`, JSON.stringify(openError.data, null, 2));
				}
				// Continue with original channelId - it may still work
			}
		} else {
			log.warn(`[DM History] No userId provided - cannot call conversations.open`);
		}

		const options: any = {
			channel: dmChannelId,
			limit: limit,
		};
		// Exclude current message if beforeTs provided
		if (beforeTs) {
			options.latest = beforeTs;
		}

		log.debug(`[DM History] Calling conversations.history for channel ${dmChannelId}...`);
		const result = await client.conversations.history(options);

		if (!result.messages || result.messages.length === 0) {
			log.debug(`[DM History] No messages found for channel ${dmChannelId}`);
			return "";
		}

		log.debug(`[DM History] Found ${result.messages.length} messages`);

		// Format messages in chronological order (API returns newest first, so reverse)
		const messages = result.messages.reverse();
		const formattedMessages = await Promise.all(
			messages.map(async (msg: any) => {
				const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
				const msgUserId = msg.user || "unknown";
				const userName = await getUserName(msgUserId);
				const text = msg.text || "";
				return `[${timestamp}] ${userName} (${msgUserId}): ${text}`;
			})
		);

		const history = formattedMessages.join("\n");
		log.debug(`[DM History] Formatted history: ${history.length} chars`);
		return history;
	} catch (error: any) {
		log.error(`[Slack API] conversations.history failed: ${error?.code || error?.name} - ${error?.message}`);
		if (error?.data) {
			log.verbose(`[Slack API] Error details:`, JSON.stringify(error.data, null, 2));
		}
		return "";
	}
}
