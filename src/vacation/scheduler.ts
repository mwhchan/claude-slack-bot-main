/**
 * Vacation Scheduler
 * Broadcasts vacation information every Monday at 9AM
 */

import { Cron } from "croner";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";
import { getVacationsThisWeek, cleanupOldVacations } from "./storage.js";
import { formatVacationMessage } from "./formatter.js";
import { parseSchedule, formatScheduleDescription } from "../news/formatter.js";
import type { WebClient } from "@slack/web-api";

export interface VacationBroadcastConfig {
	enabled: boolean;
	schedule?: string; // cron format, defaults to "0 9 * * 1" (Monday 9AM)
	lastRun?: string; // ISO timestamp
}

interface ChannelConfigWithVacation {
	id: string;
	name?: string;
	vacationBroadcast?: VacationBroadcastConfig;
	[key: string]: unknown;
}

// Store active cron jobs: Map<channelId, Cron>
const activeJobs = new Map<string, Cron>();

// Slack client reference
let slackClient: WebClient | null = null;

// Default schedule: Monday at 9AM
const DEFAULT_SCHEDULE = "0 9 * * 1";

/**
 * Set the Slack client for posting messages
 */
export function setVacationSlackClient(client: WebClient): void {
	slackClient = client;
}

/**
 * Initialize the vacation scheduler
 * Scans all channel configs and schedules jobs for enabled channels
 */
export function initializeVacationScheduler(client: WebClient): void {
	setVacationSlackClient(client);

	log.info("[Vacation] Initializing vacation scheduler...");

	if (!existsSync(CHANNEL_CONTEXT_DIR)) {
		log.debug("[Vacation] No channel context directory found");
		return;
	}

	const channelDirs = readdirSync(CHANNEL_CONTEXT_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);

	let totalEnabled = 0;

	for (const channelId of channelDirs) {
		const config = loadChannelConfigWithVacation(channelId);
		if (!config?.vacationBroadcast?.enabled) continue;

		scheduleVacationJob(channelId, config.vacationBroadcast);
		totalEnabled++;
	}

	log.info(`[Vacation] Scheduler initialized with ${totalEnabled} channel(s) enabled`);
}

/**
 * Load channel config with vacation broadcast settings
 */
function loadChannelConfigWithVacation(channelId: string): ChannelConfigWithVacation | null {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");

	try {
		if (existsSync(configPath)) {
			const data = readFileSync(configPath, "utf-8");
			return JSON.parse(data) as ChannelConfigWithVacation;
		}
	} catch (error) {
		log.error(`[Vacation] Failed to load config for ${channelId}:`, error);
	}

	return null;
}

/**
 * Validate cron expression
 */
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
 * Convert schedule to cron expression (handles both human-readable and cron formats)
 */
function toCronExpression(schedule: string): string | null {
	// If already a valid cron expression, return it
	if (isValidCron(schedule)) {
		return schedule;
	}

	// Try to parse as human-readable format
	return parseSchedule(schedule);
}

/**
 * Schedule a vacation broadcast job for a channel
 */
function scheduleVacationJob(channelId: string, config: VacationBroadcastConfig): void {
	const scheduleInput = config.schedule || DEFAULT_SCHEDULE;
	const cronExpression = toCronExpression(scheduleInput);

	if (!cronExpression) {
		log.error(`[Vacation] Invalid schedule for ${channelId}: ${scheduleInput}`);
		return;
	}

	const job = new Cron(cronExpression, async () => {
		await executeVacationBroadcast(channelId);
	});

	activeJobs.set(channelId, job);

	const scheduleDesc = formatScheduleDescription(cronExpression);
	log.info(`[Vacation] Scheduled broadcast for <#${channelId}> (${scheduleDesc})`);
}

/**
 * Execute vacation broadcast - read JSON and post if vacations found
 */
async function executeVacationBroadcast(channelId: string): Promise<void> {
	if (!slackClient) {
		log.error("[Vacation] Slack client not initialized");
		return;
	}

	log.info(`[Vacation] Running vacation check for <#${channelId}>`);

	try {
		// Clean up old vacations first
		cleanupOldVacations(channelId);

		// Get vacations for this week from JSON file
		const vacations = getVacationsThisWeek(channelId);

		// If no vacations this week, do nothing
		if (vacations.length === 0) {
			log.info(`[Vacation] No vacations this week for <#${channelId}>`);
			return;
		}

		// Format and post message
		const message = formatVacationMessage(vacations);

		await slackClient.chat.postMessage({
			channel: channelId,
			text: message,
		});

		log.info(`[Vacation] Posted vacation alert for ${vacations.length} person(s) to <#${channelId}>`);
	} catch (error) {
		log.error(`[Vacation] Failed to execute broadcast for <#${channelId}>:`, error);
	}
}

/**
 * Manually trigger a vacation broadcast (for testing)
 */
export async function broadcastVacationsNow(
	channelId: string,
	threadTs?: string
): Promise<{ success: boolean; message: string }> {
	if (!slackClient) {
		return { success: false, message: "Slack client not initialized" };
	}

	try {
		// Clean up old vacations first
		cleanupOldVacations(channelId);

		// Get vacations for this week
		const vacations = getVacationsThisWeek(channelId);

		if (vacations.length === 0) {
			return { success: true, message: "No vacations found for this week" };
		}

		const message = formatVacationMessage(vacations);

		await slackClient.chat.postMessage({
			channel: channelId,
			text: message,
			thread_ts: threadTs,
		});

		return { success: true, message: `Found ${vacations.length} vacation(s)` };
	} catch (error) {
		log.error("[Vacation] Failed to broadcast vacations:", error);
		return { success: false, message: "Failed to check vacations" };
	}
}

/**
 * Stop all scheduled vacation jobs (for graceful shutdown)
 */
export function stopAllVacationJobs(): void {
	for (const [channelId, job] of activeJobs) {
		job.stop();
		log.debug(`[Vacation] Stopped job for <#${channelId}>`);
	}
	activeJobs.clear();
	log.info("[Vacation] All vacation jobs stopped");
}

/**
 * Save channel config
 */
function saveChannelConfig(channelId: string, config: ChannelConfigWithVacation): boolean {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");

	try {
		writeFileSync(configPath, JSON.stringify(config, null, 2));
		return true;
	} catch (error) {
		log.error(`[Vacation] Failed to save config for ${channelId}:`, error);
		return false;
	}
}

/**
 * Enable vacation broadcast for a channel with a schedule
 */
export function enableVacationBroadcast(
	channelId: string,
	schedule: string
): { success: boolean; message: string } {
	// Parse and validate schedule
	const cronExpression = toCronExpression(schedule);
	if (!cronExpression) {
		return {
			success: false,
			message: `Invalid schedule "${schedule}". Use formats like "weekly monday 9am" or "daily 10am"`,
		};
	}

	// Load existing config
	let config = loadChannelConfigWithVacation(channelId);
	if (!config) {
		config = { id: channelId, vacationBroadcast: { enabled: true, schedule } };
	} else {
		config.vacationBroadcast = {
			...config.vacationBroadcast,
			enabled: true,
			schedule,
		};
	}

	// Save config
	if (!saveChannelConfig(channelId, config)) {
		return { success: false, message: "Failed to save configuration" };
	}

	// Stop existing job if any
	const existingJob = activeJobs.get(channelId);
	if (existingJob) {
		existingJob.stop();
		activeJobs.delete(channelId);
	}

	// Schedule new job
	scheduleVacationJob(channelId, config.vacationBroadcast!);

	const scheduleDesc = formatScheduleDescription(cronExpression);
	return {
		success: true,
		message: `Vacation broadcast enabled ${scheduleDesc}`,
	};
}

/**
 * Disable vacation broadcast for a channel
 */
export function disableVacationBroadcast(channelId: string): { success: boolean; message: string } {
	// Load existing config
	const config = loadChannelConfigWithVacation(channelId);
	if (!config?.vacationBroadcast?.enabled) {
		return { success: false, message: "Vacation broadcast is not enabled for this channel" };
	}

	// Disable in config
	config.vacationBroadcast.enabled = false;

	// Save config
	if (!saveChannelConfig(channelId, config)) {
		return { success: false, message: "Failed to save configuration" };
	}

	// Stop the job
	const existingJob = activeJobs.get(channelId);
	if (existingJob) {
		existingJob.stop();
		activeJobs.delete(channelId);
	}

	return { success: true, message: "Vacation broadcast disabled" };
}

/**
 * Get vacation broadcast status for a channel
 */
export function getVacationBroadcastStatus(channelId: string): {
	enabled: boolean;
	schedule?: string;
	scheduleDescription?: string;
} {
	const config = loadChannelConfigWithVacation(channelId);
	if (!config?.vacationBroadcast?.enabled) {
		return { enabled: false };
	}

	const schedule = config.vacationBroadcast.schedule || DEFAULT_SCHEDULE;
	const cronExpression = toCronExpression(schedule);

	return {
		enabled: true,
		schedule,
		scheduleDescription: cronExpression ? formatScheduleDescription(cronExpression) : schedule,
	};
}
