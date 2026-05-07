import { log } from "../utils/log.js";
import type { ClaudeRequestItem } from "../types/index.js";

// ========================================
// Thread Tracking State
// ========================================

// Track Claude session IDs per thread for --resume continuations
// Sessions expire after 1 hour of inactivity
// seenUserIds tracks which users' context has already been included
export interface ThreadSession {
	sessionId: string;
	lastUsed: number;
	seenUserIds: string[];
}
export const threadSessions = new Map<string, ThreadSession>();
export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// Start periodic cleanup of expired sessions
export function startSessionCleanup(): void {
	setInterval(() => {
		const now = Date.now();
		let cleaned = 0;
		for (const [threadTs, session] of threadSessions.entries()) {
			if (now - session.lastUsed > SESSION_TTL_MS) {
				threadSessions.delete(threadTs);
				cleaned++;
			}
		}
		if (cleaned > 0) {
			log.debug(`[Session cleanup] Removed ${cleaned} expired session(s)`);
		}
	}, 10 * 60 * 1000); // Check every 10 minutes
}

// Track recently processed messages to avoid duplicates
export const processedMessages = new Set<string>();

// Track channels to monitor for hourly summaries
export const monitoredChannels = new Set<string>();

// ========================================
// Claude Request Queue State
// ========================================

// Per-channel Claude request queue - only one Claude process per channel at a time
export const channelClaudeQueues = new Map<string, ClaudeRequestItem[]>();
export const channelClaudeProcessing = new Map<string, boolean>();

// ========================================
// Slack Client Reference
// ========================================

// Slack client for queue processing (set via setQueueSlackClient after app init)
let slackClient: any = null;

export function setQueueSlackClient(client: any): void {
	slackClient = client;
}

export function getQueueSlackClient(): any {
	return slackClient;
}
