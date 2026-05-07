/**
 * News Scheduler
 * Manages scheduled news posts using croner (ESM-compatible cron)
 */

import { Cron } from "croner";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";
import { fetchNews, type FetchNewsOptions } from "./fetcher.js";
import { formatNewsForSlack, formatScheduleDescription } from "./formatter.js";
import type { NewsLanguage } from "./rss/types.js";
import type { WebClient } from "@slack/web-api";

export interface NewsSubscription {
	topic: string;
	schedule: string; // cron format: "0 9 * * *"
	enabled: boolean;
	lastRun?: string; // ISO timestamp
	// New optional fields for enhanced RSS processing
	useTwoStageProcessing?: boolean; // default: true
	preferRss?: boolean; // default: true
	languages?: NewsLanguage[]; // default: ['en']
	maxItems?: number; // default: 6
}

interface ChannelConfigWithNews {
	id: string;
	name?: string;
	newsSubscriptions?: NewsSubscription[];
	[key: string]: unknown;
}

// Store active cron jobs: Map<channelId, Map<topic, Cron>>
const activeJobs = new Map<string, Map<string, Cron>>();

// Slack client reference
let slackClient: WebClient | null = null;

/**
 * Set the Slack client for posting messages
 */
export function setNewsSlackClient(client: WebClient): void {
	slackClient = client;
}

/**
 * Initialize the news scheduler
 * Scans all channel configs and schedules jobs for active subscriptions
 */
export function initializeNewsScheduler(client: WebClient): void {
	setNewsSlackClient(client);

	log.info("[News] Initializing news scheduler...");

	// Scan all channel directories
	if (!existsSync(CHANNEL_CONTEXT_DIR)) {
		log.debug("[News] No channel context directory found");
		return;
	}

	const channelDirs = readdirSync(CHANNEL_CONTEXT_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);

	let totalSubscriptions = 0;

	for (const channelId of channelDirs) {
		const config = loadChannelConfigWithNews(channelId);
		if (!config?.newsSubscriptions?.length) continue;

		for (const sub of config.newsSubscriptions) {
			if (sub.enabled) {
				scheduleNewsJob(channelId, sub);
				totalSubscriptions++;
			}
		}
	}

	log.info(`[News] Scheduler initialized with ${totalSubscriptions} active subscription(s)`);
}

/**
 * Load channel config with news subscriptions
 */
function loadChannelConfigWithNews(channelId: string): ChannelConfigWithNews | null {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");

	try {
		if (existsSync(configPath)) {
			const data = readFileSync(configPath, "utf-8");
			return JSON.parse(data) as ChannelConfigWithNews;
		}
	} catch (error) {
		log.error(`[News] Failed to load config for ${channelId}:`, error);
	}

	return null;
}

/**
 * Save channel config
 */
function saveChannelConfig(channelId: string, config: ChannelConfigWithNews): boolean {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");

	try {
		writeFileSync(configPath, JSON.stringify(config, null, 2));
		return true;
	} catch (error) {
		log.error(`[News] Failed to save config for ${channelId}:`, error);
		return false;
	}
}

/**
 * Validate cron expression
 */
function isValidCron(expression: string): boolean {
	try {
		// Try to create a Cron instance - it will throw if invalid
		const test = new Cron(expression, { paused: true }, () => {});
		test.stop();
		return true;
	} catch {
		return false;
	}
}

/**
 * Schedule a news job for a channel
 */
function scheduleNewsJob(channelId: string, sub: NewsSubscription): void {
	// Validate cron expression
	if (!isValidCron(sub.schedule)) {
		log.error(`[News] Invalid cron expression for ${channelId}/${sub.topic}: ${sub.schedule}`);
		return;
	}

	// Create job
	const job = new Cron(sub.schedule, async () => {
		await executeNewsJob(channelId, sub);
	});

	// Store job reference
	if (!activeJobs.has(channelId)) {
		activeJobs.set(channelId, new Map());
	}
	activeJobs.get(channelId)!.set(sub.topic.toLowerCase(), job);

	const scheduleDesc = formatScheduleDescription(sub.schedule);
	log.info(`[News] Scheduled "${sub.topic}" news for <#${channelId}> (${scheduleDesc})`);
}

/**
 * Convert subscription options to FetchNewsOptions
 */
function subscriptionToFetchOptions(sub: NewsSubscription): FetchNewsOptions {
	return {
		useTwoStageProcessing: sub.useTwoStageProcessing ?? true,
		preferRss: sub.preferRss ?? true,
		languages: sub.languages ?? ["en"],
		maxItems: sub.maxItems ?? 6,
		fallbackToWebSearch: false,
	};
}

/**
 * Execute a news job - fetch and post news
 */
async function executeNewsJob(channelId: string, sub: NewsSubscription): Promise<void> {
	if (!slackClient) {
		log.error("[News] Slack client not initialized");
		return;
	}

	// Skip news publishing on weekends (Saturday = 6, Sunday = 0)
	const today = new Date().getDay();
	if (today === 0 || today === 6) {
		log.info(`[News] Skipping scheduled news job for "${sub.topic}" in <#${channelId}> (weekend)`);
		return;
	}

	log.info(`[News] Running scheduled news job for "${sub.topic}" in <#${channelId}>`);

	try {
		// Build fetch options from subscription
		const fetchOptions = subscriptionToFetchOptions(sub);

		// Fetch news
		const news = await fetchNews(sub.topic, fetchOptions);

		// Format for Slack
		const message = formatNewsForSlack(sub.topic, news);

		// Post to channel
		await slackClient.chat.postMessage({
			channel: channelId,
			text: message,
		});

		// Update lastRun in config
		const config = loadChannelConfigWithNews(channelId);
		if (config?.newsSubscriptions) {
			const configSub = config.newsSubscriptions.find((s) => s.topic === sub.topic);
			if (configSub) {
				configSub.lastRun = new Date().toISOString();
				saveChannelConfig(channelId, config);
			}
		}

		log.info(`[News] Posted ${news.length} news items for "${sub.topic}" to <#${channelId}>`);
	} catch (error) {
		log.error(`[News] Failed to execute news job for "${sub.topic}" in <#${channelId}>:`, error);
	}
}

/**
 * Add a news subscription to a channel
 */
export function addSubscription(
	channelId: string,
	topic: string,
	schedule: string,
	options?: Partial<NewsSubscription>
): { success: boolean; message: string } {
	// Load existing config
	let config = loadChannelConfigWithNews(channelId);

	if (!config) {
		// Create minimal config if it doesn't exist
		config = {
			id: channelId,
			newsSubscriptions: [],
		};
	}

	if (!config.newsSubscriptions) {
		config.newsSubscriptions = [];
	}

	// Check if subscription already exists
	const existing = config.newsSubscriptions.find(
		(s) => s.topic.toLowerCase() === topic.toLowerCase()
	);

	if (existing) {
		// Update existing subscription
		existing.schedule = schedule;
		existing.enabled = true;
		// Apply any new options
		if (options?.useTwoStageProcessing !== undefined) {
			existing.useTwoStageProcessing = options.useTwoStageProcessing;
		}
		if (options?.preferRss !== undefined) {
			existing.preferRss = options.preferRss;
		}
		if (options?.languages !== undefined) {
			existing.languages = options.languages;
		}
		if (options?.maxItems !== undefined) {
			existing.maxItems = options.maxItems;
		}

		// Re-schedule the job
		stopSubscription(channelId, topic);
		scheduleNewsJob(channelId, existing);
	} else {
		// Add new subscription
		const newSub: NewsSubscription = {
			topic,
			schedule,
			enabled: true,
			useTwoStageProcessing: options?.useTwoStageProcessing ?? true,
			preferRss: options?.preferRss ?? true,
			languages: options?.languages ?? ["en"],
			maxItems: options?.maxItems ?? 6,
		};
		config.newsSubscriptions.push(newSub);
		scheduleNewsJob(channelId, newSub);
	}

	// Save config
	if (!saveChannelConfig(channelId, config)) {
		return { success: false, message: "Failed to save configuration" };
	}

	const scheduleDesc = formatScheduleDescription(schedule);
	return {
		success: true,
		message: `Subscribed to *${topic}* news ${scheduleDesc}`,
	};
}

/**
 * Remove a news subscription from a channel
 */
export function removeSubscription(
	channelId: string,
	topic: string
): { success: boolean; message: string } {
	const config = loadChannelConfigWithNews(channelId);

	if (!config?.newsSubscriptions) {
		return { success: false, message: `No subscriptions found for this channel` };
	}

	const index = config.newsSubscriptions.findIndex(
		(s) => s.topic.toLowerCase() === topic.toLowerCase()
	);

	if (index === -1) {
		return { success: false, message: `No subscription found for *${topic}*` };
	}

	// Stop the cron job
	stopSubscription(channelId, topic);

	// Remove from config
	config.newsSubscriptions.splice(index, 1);

	// Save config
	if (!saveChannelConfig(channelId, config)) {
		return { success: false, message: "Failed to save configuration" };
	}

	return {
		success: true,
		message: `Unsubscribed from *${topic}* news`,
	};
}

/**
 * Stop a scheduled job
 */
function stopSubscription(channelId: string, topic: string): void {
	const channelJobs = activeJobs.get(channelId);
	if (!channelJobs) return;

	const job = channelJobs.get(topic.toLowerCase());
	if (job) {
		job.stop();
		channelJobs.delete(topic.toLowerCase());
		log.debug(`[News] Stopped job for "${topic}" in <#${channelId}>`);
	}
}

/**
 * List all subscriptions for a channel
 */
export function listSubscriptions(channelId: string): NewsSubscription[] {
	const config = loadChannelConfigWithNews(channelId);
	return config?.newsSubscriptions || [];
}

/**
 * Fetch and post news immediately (for "news now" command)
 */
export async function fetchNewsNow(
	channelId: string,
	topic: string,
	threadTs?: string,
	options?: FetchNewsOptions
): Promise<{ success: boolean; message: string }> {
	if (!slackClient) {
		return { success: false, message: "Slack client not initialized" };
	}

	try {
		// Use provided options or defaults
		const fetchOptions: FetchNewsOptions = {
			useTwoStageProcessing: true,
			preferRss: true,
			languages: ["en"],
			maxItems: 6,
			fallbackToWebSearch: false,
			...options,
		};

		const news = await fetchNews(topic, fetchOptions);
		const message = formatNewsForSlack(topic, news);

		await slackClient.chat.postMessage({
			channel: channelId,
			text: message,
			thread_ts: threadTs,
		});

		return { success: true, message: "" };
	} catch (error) {
		log.error(`[News] Failed to fetch news now:`, error);
		return { success: false, message: "Failed to fetch news" };
	}
}

/**
 * Stop all scheduled jobs (for graceful shutdown)
 */
export function stopAllNewsJobs(): void {
	for (const [channelId, channelJobs] of activeJobs) {
		for (const [topic, job] of channelJobs) {
			job.stop();
			log.debug(`[News] Stopped job for "${topic}" in <#${channelId}>`);
		}
	}
	activeJobs.clear();
	log.info("[News] All news jobs stopped");
}
