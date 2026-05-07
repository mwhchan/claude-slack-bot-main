/**
 * Project Status Scheduler
 * Manages scheduled status report generation using croner (ESM-compatible cron)
 * Follows the pattern of src/news/scheduler.ts
 */

import { Cron } from "croner";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";
import { generateProjectStatus } from "./orchestrator.js";
import type { PostContext } from "./poster.js";
import type { WebClient } from "@slack/web-api";

// Store active cron jobs: Map<channelId, Cron>
const activeJobs = new Map<string, Cron>();

// Slack client reference
let slackClient: WebClient | null = null;

/**
 * Set the Slack client for posting messages
 */
export function setStatusSlackClient(client: WebClient): void {
	slackClient = client;
}

/**
 * Initialize the status report scheduler.
 * Scans all channel configs and schedules jobs for channels with projectStatus.schedule.
 */
export function initializeStatusScheduler(client: WebClient): void {
	setStatusSlackClient(client);

	log.info("[Status] Initializing status report scheduler...");

	if (!existsSync(CHANNEL_CONTEXT_DIR)) {
		log.debug("[Status] No channel context directory found");
		return;
	}

	const channelDirs = readdirSync(CHANNEL_CONTEXT_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);

	let totalScheduled = 0;

	for (const channelId of channelDirs) {
		const config = loadChannelStatusConfig(channelId);
		if (!config) continue;

		const ps = config.projectStatus;
		if (ps?.enabled !== false && ps?.schedule) {
			scheduleStatusJob(channelId, ps.schedule);
			totalScheduled++;
		}
	}

	log.info(`[Status] Scheduler initialized with ${totalScheduled} active schedule(s)`);
}

interface ChannelConfigWithStatus {
	id: string;
	name?: string;
	displayName?: string;
	projectStatus?: {
		enabled?: boolean;
		schedule?: string;
		lastRun?: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

function loadChannelStatusConfig(channelId: string): ChannelConfigWithStatus | null {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");
	try {
		if (existsSync(configPath)) {
			return JSON.parse(readFileSync(configPath, "utf-8")) as ChannelConfigWithStatus;
		}
	} catch (error) {
		log.error(`[Status] Failed to load config for ${channelId}:`, error);
	}
	return null;
}

function saveChannelStatusConfig(channelId: string, config: ChannelConfigWithStatus): boolean {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");
	try {
		writeFileSync(configPath, JSON.stringify(config, null, 2));
		return true;
	} catch (error) {
		log.error(`[Status] Failed to save config for ${channelId}:`, error);
		return false;
	}
}

function isValidCron(expression: string): boolean {
	try {
		const test = new Cron(expression, { paused: true }, () => {});
		test.stop();
		return true;
	} catch {
		return false;
	}
}

/**
 * Schedule a status report job for a channel
 */
function scheduleStatusJob(channelId: string, schedule: string): void {
	if (!isValidCron(schedule)) {
		log.error(`[Status] Invalid cron expression for ${channelId}: ${schedule}`);
		return;
	}

	// Stop existing job if any
	stopStatusJob(channelId);

	const job = new Cron(schedule, async () => {
		await executeStatusJob(channelId);
	});

	activeJobs.set(channelId, job);
	log.info(`[Status] Scheduled status report for <#${channelId}> (${schedule})`);
}

/**
 * Execute a scheduled status report job
 */
async function executeStatusJob(channelId: string): Promise<void> {
	if (!slackClient) {
		log.error("[Status] Slack client not initialized");
		return;
	}

	log.info(`[Status] Running scheduled status report for <#${channelId}>`);

	try {
		// Post to the channel directly (not in a thread)
		// Use chat.postMessage to create a new top-level message
		const introResult = await slackClient.chat.postMessage({
			channel: channelId,
			text: ":bar_chart: Generating scheduled project status report...",
		});

		const threadTs = introResult.ts || "";

		// Build a say function that posts to the thread
		const say = async (message: any) => {
			const payload = typeof message === "string" ? { text: message } : message;
			return slackClient!.chat.postMessage({
				channel: channelId,
				...payload,
			});
		};

		const config = loadChannelStatusConfig(channelId);
		const postContext: PostContext = {
			channelId,
			threadTs,
			say,
			client: slackClient,
			channelName: config?.displayName || config?.name,
		};

		await generateProjectStatus(channelId, postContext);

		// Update lastRun
		if (config?.projectStatus) {
			config.projectStatus.lastRun = new Date().toISOString();
			saveChannelStatusConfig(channelId, config);
		}

		log.info(`[Status] Scheduled status report posted for <#${channelId}>`);
	} catch (error) {
		log.error(`[Status] Failed to execute scheduled status report for <#${channelId}>:`, error);
	}
}

/**
 * Stop a scheduled job for a channel
 */
function stopStatusJob(channelId: string): void {
	const job = activeJobs.get(channelId);
	if (job) {
		job.stop();
		activeJobs.delete(channelId);
		log.debug(`[Status] Stopped job for <#${channelId}>`);
	}
}

/**
 * Enable status report schedule for a channel.
 * Updates config and starts the cron job.
 */
export function enableStatusSchedule(
	channelId: string,
	schedule: string
): { success: boolean; message: string } {
	if (!isValidCron(schedule)) {
		return { success: false, message: `Invalid schedule: "${schedule}"` };
	}

	const config = loadChannelStatusConfig(channelId);
	if (!config) {
		return { success: false, message: "No channel config found" };
	}

	if (!config.projectStatus) {
		config.projectStatus = {};
	}
	config.projectStatus.enabled = true;
	config.projectStatus.schedule = schedule;

	if (!saveChannelStatusConfig(channelId, config)) {
		return { success: false, message: "Failed to save configuration" };
	}

	scheduleStatusJob(channelId, schedule);
	return { success: true, message: `Status report scheduled (${schedule})` };
}

/**
 * Disable status report schedule for a channel.
 */
export function disableStatusSchedule(
	channelId: string
): { success: boolean; message: string } {
	const config = loadChannelStatusConfig(channelId);
	if (!config?.projectStatus?.schedule) {
		return { success: false, message: "No status schedule configured for this channel" };
	}

	config.projectStatus.enabled = false;
	stopStatusJob(channelId);

	if (!saveChannelStatusConfig(channelId, config)) {
		return { success: false, message: "Failed to save configuration" };
	}

	return { success: true, message: "Status report schedule disabled" };
}

/**
 * Get status schedule settings for a channel
 */
export function getStatusScheduleInfo(channelId: string): {
	enabled: boolean;
	schedule?: string;
	lastRun?: string;
} {
	const config = loadChannelStatusConfig(channelId);
	const ps = config?.projectStatus;
	return {
		enabled: !!(ps?.enabled !== false && ps?.schedule),
		schedule: ps?.schedule,
		lastRun: ps?.lastRun,
	};
}

/**
 * Generate a status report immediately (for "status now" command)
 */
export async function generateStatusNow(
	channelId: string,
	threadTs?: string
): Promise<{ success: boolean; message: string }> {
	if (!slackClient) {
		return { success: false, message: "Slack client not initialized" };
	}

	const say = async (message: any) => {
		const payload = typeof message === "string" ? { text: message } : message;
		return slackClient!.chat.postMessage({
			channel: channelId,
			...payload,
		});
	};

	const config = loadChannelStatusConfig(channelId);
	const postContext: PostContext = {
		channelId,
		threadTs: threadTs || "",
		say,
		client: slackClient,
		channelName: config?.displayName || config?.name,
	};

	try {
		const posted = await generateProjectStatus(channelId, postContext);
		if (posted) {
			// Update lastRun
			if (config?.projectStatus) {
				config.projectStatus.lastRun = new Date().toISOString();
				saveChannelStatusConfig(channelId, config);
			}
			return { success: true, message: "" };
		}
		return { success: false, message: "Failed to generate report — check channel config" };
	} catch (error: any) {
		log.error(`[Status] Failed to generate status now:`, error);
		return { success: false, message: `Failed to generate report: ${error.message}` };
	}
}

/**
 * Stop all scheduled status jobs (for graceful shutdown)
 */
export function stopAllStatusJobs(): void {
	for (const [channelId, job] of activeJobs) {
		job.stop();
		log.debug(`[Status] Stopped job for <#${channelId}>`);
	}
	activeJobs.clear();
	log.info("[Status] All status jobs stopped");
}
