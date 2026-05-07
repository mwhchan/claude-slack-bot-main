import { log } from "../utils/log.js";
import {
	channelClaudeQueues,
	channelClaudeProcessing,
} from "../state/index.js";

// Process the Claude request queue for a specific channel
const processClaudeQueue = async (channelId: string) => {
	if (channelClaudeProcessing.get(channelId)) return;
	channelClaudeProcessing.set(channelId, true);

	const queue = channelClaudeQueues.get(channelId) || [];

	while (queue.length > 0) {
		const item = queue.shift();
		if (!item) break;

		try {
			await item.execute();
		} catch (e) {
			log.error(`Error processing Claude request:`, e);
		}
	}

	channelClaudeProcessing.set(channelId, false);
};

// Queue a Claude request for a specific channel
export const queueClaudeRequest = (channelId: string, execute: () => Promise<void>): void => {
	if (!channelClaudeQueues.has(channelId)) {
		channelClaudeQueues.set(channelId, []);
	}

	const queue = channelClaudeQueues.get(channelId)!;
	const queuePosition = queue.length + (channelClaudeProcessing.get(channelId) ? 1 : 0);

	if (queuePosition > 0) {
		log.info(`Queued request for channel ${channelId} (position: ${queuePosition})`);
	}

	queue.push({ execute, channelId });

	// Start processing if not already running
	processClaudeQueue(channelId);
};
