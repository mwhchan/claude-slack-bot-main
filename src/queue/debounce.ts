import { log } from "../utils/log.js";

interface BufferedMessage {
	text: string;
	ts: string;
	files?: any[];
	attachments?: any[];
}

interface PendingBatch {
	messages: BufferedMessage[];
	timer: NodeJS.Timeout;
	resolve: () => void;
}

// Per-key debounce state
const pending = new Map<string, PendingBatch>();

// Default debounce window (ms) — wait this long for more messages
const DEBOUNCE_MS = 1500;

/**
 * Build a debounce key from channel + thread + user.
 * Messages from the same user in the same thread get batched.
 */
export function debounceKey(channelId: string, threadTs: string, userId: string): string {
	return `${channelId}:${threadTs}:${userId}`;
}

/**
 * Debounce an inbound message. Returns a promise that resolves when the batch
 * is ready to process, with the combined text and metadata.
 *
 * If more messages arrive within DEBOUNCE_MS, they're batched together.
 * Returns null if this message was added to an existing batch (caller should skip).
 */
export function debounceMessage(
	key: string,
	message: BufferedMessage,
	debounceMs: number = DEBOUNCE_MS
): Promise<{ combinedText: string; firstTs: string; lastTs: string; files: any[]; attachments: any[] }> | null {
	const existing = pending.get(key);

	if (existing) {
		// Add to existing batch — reset timer
		existing.messages.push(message);
		clearTimeout(existing.timer);
		existing.timer = setTimeout(() => flushBatch(key), debounceMs);
		log.debug(`[Debounce] Batched message for ${key} (${existing.messages.length} total)`);
		return null; // Caller should skip — the first caller's promise will resolve
	}

	// First message — create new batch
	return new Promise((resolve) => {
		const batch: PendingBatch = {
			messages: [message],
			timer: setTimeout(() => flushBatch(key), debounceMs),
			resolve: () => {
				const msgs = batch.messages;
				const combinedText = msgs.map((m) => m.text).join("\n\n");
				const files = msgs.flatMap((m) => m.files || []);
				const attachments = msgs.flatMap((m) => m.attachments || []);
				resolve({
					combinedText,
					firstTs: msgs[0].ts,
					lastTs: msgs[msgs.length - 1].ts,
					files: files.length > 0 ? files : [],
					attachments: attachments.length > 0 ? attachments : [],
				});
			},
		};
		pending.set(key, batch);
	});
}

function flushBatch(key: string): void {
	const batch = pending.get(key);
	if (!batch) return;
	pending.delete(key);

	const count = batch.messages.length;
	if (count > 1) {
		log.info(`[Debounce] Flushing ${count} batched messages for ${key}`);
	}
	batch.resolve();
}
