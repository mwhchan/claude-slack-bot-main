import { log } from "../utils/log.js";

// Regex pattern to match [REACT:emoji_name] tag
const REACT_PATTERN = /\[REACT:([a-zA-Z0-9_+-]+)\]/g;

/**
 * Extract [REACT:emoji] tag from response and return emoji name and cleaned text.
 * Returns null if no reaction tag found.
 */
export function extractReaction(response: string): { emoji: string; cleanedResponse: string } | null {
	const match = REACT_PATTERN.exec(response);
	if (!match) {
		return null;
	}

	const emoji = match[1];
	// Remove all reaction tags from the response
	const cleanedResponse = response.replace(REACT_PATTERN, "").trim();

	return { emoji, cleanedResponse };
}

/**
 * Add a reaction to a message. Fails silently on error.
 * @returns true if reaction was added successfully, false otherwise
 */
export async function addReaction(
	client: any,
	channelId: string,
	messageTs: string,
	emoji: string
): Promise<boolean> {
	try {
		await client.reactions.add({
			channel: channelId,
			timestamp: messageTs,
			name: emoji,
		});
		log.debug(`Added reaction :${emoji}: to message ${messageTs}`);
		return true;
	} catch (error: any) {
		// Fail silently - reaction errors shouldn't break the response flow
		log.warn(`Failed to add reaction :${emoji}:: ${error?.message || error}`);
		return false;
	}
}

