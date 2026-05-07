/**
 * Config Command Handler
 * Handles bot configuration commands via Slack messages
 *
 * Supported commands:
 * - @bot watch <slack-link>       - Add a channel/user to watched list
 * - @bot unwatch <id-or-link>     - Remove from watched list
 * - @bot list watched             - List all watched channels/users
 * - @bot config list              - Alias for list watched
 *
 * News commands:
 * - @bot news subscribe <topic> <schedule>  - Subscribe to news (e.g., "news subscribe AI daily 9am")
 * - @bot news unsubscribe <topic>           - Unsubscribe from news
 * - @bot news list                          - List news subscriptions
 * - @bot news now <topic>                   - Fetch and post news immediately
 *
 * Vacation commands:
 * - @bot vacations now                                - Check and post vacation info for this week
 * - @bot vacations enable <schedule>                  - Enable vacation broadcast (e.g., "weekly monday 9am")
 * - @bot vacations disable                            - Disable vacation broadcast
 * - @bot vacations status                             - Show current vacation broadcast settings
 *
 * Status report commands:
 * - @bot status now                                   - Generate a project status report immediately
 * - @bot status enable <schedule>                     - Enable scheduled status reports (e.g., "weekly monday 9am")
 * - @bot status disable                               - Disable scheduled status reports
 * - @bot status settings                              - Show current status report settings
 */

import {
	parseSlackLink,
	extractSlackLinks,
	type ParsedSlackLink,
} from "./slack-links.js";
import {
	addWatchedChannel,
	addWatchedUser,
	removeWatchedChannel,
	removeWatchedUser,
	formatWatchedList,
	getWatchedChannel,
	getWatchedUser,
	type WatchedChannel,
	type WatchedUser,
} from "./config-manager.js";
import {
	addSubscription,
	removeSubscription,
	listSubscriptions,
	fetchNewsNow,
	parseSchedule,
	formatScheduleDescription,
} from "../news/index.js";
// Note: parseSchedule and formatScheduleDescription are also used by status commands below
import {
	broadcastVacationsNow,
	enableVacationBroadcast,
	disableVacationBroadcast,
	getVacationBroadcastStatus,
} from "../vacation/index.js";
import {
	enableStatusSchedule,
	disableStatusSchedule,
	getStatusScheduleInfo,
	generateStatusNow,
} from "../project-status/index.js";

export interface CommandResult {
	handled: boolean;
	response?: string;
	error?: string;
}

export interface SlackClient {
	conversations: {
		info: (params: { channel: string }) => Promise<any>;
	};
	users: {
		info: (params: { user: string }) => Promise<any>;
	};
}

export interface CommandContext {
	text: string;
	userId: string;
	userName: string;
	channelId: string;
	client: SlackClient;
	botUserId?: string;
	threadTs?: string;  // Thread timestamp for posting replies
}

/**
 * Check if a message is a config command
 */
export function isConfigCommand(text: string, botUserId?: string): boolean {
	// Remove bot mention from text
	let cleanText = text;
	if (botUserId) {
		cleanText = text.replace(new RegExp(`<@${botUserId}>\\s*`, "gi"), "").trim();
	}

	const commandPatterns = [
		/^watch\s+/i,
		/^unwatch\s+/i,
		/^list\s+watched/i,
		/^config\s+list/i,
		/^config\s+add/i,
		/^config\s+remove/i,
		// News commands
		/^news\s+subscribe\s+/i,
		/^news\s+unsubscribe\s+/i,
		/^news\s+list$/i,
		/^news\s+now\s+/i,
		/^news\s+(?:on|about)\s+/i,
		/^(?:what'?s\s+the\s+)?news\s+(?:on|about)\s+/i,
		/^(?:latest|recent)\s+news\s+(?:on|about)\s+/i,
		/^(?:any\s+)?news\s+(?:on|about|for)\s+/i,
		/^what'?s\s+happening\s+(?:with|in)\s+/i,
		/^current\s+events?\s+(?:on|about|in)\s+/i,
		// Vacation commands
		/^vacations?\s+now$/i,
		/^vacations?\s+enable\s+/i,
		/^vacations?\s+disable$/i,
		/^vacations?\s+status$/i,
		// Status report commands
		/^status\s+now$/i,
		/^status\s+enable\s+/i,
		/^status\s+disable$/i,
		/^status\s+settings$/i,
	];

	return commandPatterns.some((pattern) => pattern.test(cleanText));
}

/**
 * Process a config command and return the result
 */
export async function processConfigCommand(ctx: CommandContext): Promise<CommandResult> {
	// Remove bot mention from text
	let cleanText = ctx.text;
	if (ctx.botUserId) {
		cleanText = ctx.text.replace(new RegExp(`<@${ctx.botUserId}>\\s*`, "gi"), "").trim();
	}

	// Parse command
	const parts = cleanText.split(/\s+/);
	const command = parts[0]?.toLowerCase();
	const subCommand = parts[1]?.toLowerCase();

	// Handle: watch <link>
	if (command === "watch") {
		const linkText = parts.slice(1).join(" ");
		return await handleWatchCommand(linkText, ctx);
	}

	// Handle: unwatch <id-or-link>
	if (command === "unwatch") {
		const linkText = parts.slice(1).join(" ");
		return handleUnwatchCommand(linkText, ctx);
	}

	// Handle: list watched
	if (command === "list" && subCommand === "watched") {
		return handleListCommand();
	}

	// Handle: config list
	if (command === "config" && subCommand === "list") {
		return handleListCommand();
	}

	// Handle: config add <link>
	if (command === "config" && subCommand === "add") {
		const linkText = parts.slice(2).join(" ");
		return await handleWatchCommand(linkText, ctx);
	}

	// Handle: config remove <id-or-link>
	if (command === "config" && subCommand === "remove") {
		const linkText = parts.slice(2).join(" ");
		return handleUnwatchCommand(linkText, ctx);
	}

	// Handle: news subscribe <topic> <schedule>
	if (command === "news" && subCommand === "subscribe") {
		const args = parts.slice(2).join(" ");
		return handleNewsSubscribe(args, ctx);
	}

	// Handle: news unsubscribe <topic>
	if (command === "news" && subCommand === "unsubscribe") {
		const topic = parts.slice(2).join(" ");
		return handleNewsUnsubscribe(topic, ctx);
	}

	// Handle: news list
	if (command === "news" && subCommand === "list") {
		return handleNewsList(ctx);
	}

	// Handle: news now <topic>
	if (command === "news" && subCommand === "now") {
		const topic = parts.slice(2).join(" ");
		return await handleNewsNow(topic, ctx);
	}

	// Handle: news on/about <topic>, latest news on <topic>, what's the news on <topic>
	if (command === "news" && (subCommand === "on" || subCommand === "about")) {
		const topic = parts.slice(2).join(" ");
		return await handleNewsNow(topic, ctx);
	}
	if ((command === "latest" || command === "recent") && parts[1]?.toLowerCase() === "news") {
		const topic = cleanText.replace(/^(?:latest|recent)\s+news\s+(?:on|about)\s+/i, "").trim();
		return await handleNewsNow(topic, ctx);
	}
	if (command === "what's" || command === "whats") {
		const newsMatch = cleanText.match(/^what'?s\s+(?:the\s+)?news\s+(?:on|about)\s+(.+)/i);
		if (newsMatch) {
			return await handleNewsNow(newsMatch[1].trim(), ctx);
		}
		const happeningMatch = cleanText.match(/^what'?s\s+happening\s+(?:with|in)\s+(.+)/i);
		if (happeningMatch) {
			return await handleNewsNow(happeningMatch[1].trim(), ctx);
		}
	}
	// Handle: any news on <topic>
	if (command === "any") {
		const anyNewsMatch = cleanText.match(/^any\s+news\s+(?:on|about|for)\s+(.+)/i);
		if (anyNewsMatch) {
			return await handleNewsNow(anyNewsMatch[1].trim(), ctx);
		}
	}
	// Handle: current events on <topic>
	if (command === "current") {
		const currentMatch = cleanText.match(/^current\s+events?\s+(?:on|about|in)\s+(.+)/i);
		if (currentMatch) {
			return await handleNewsNow(currentMatch[1].trim(), ctx);
		}
	}

	// Handle: vacations now (or vacation now)
	if ((command === "vacations" || command === "vacation") && subCommand === "now") {
		return await handleVacationsNow(ctx);
	}

	// Handle: vacations enable <schedule>
	if ((command === "vacations" || command === "vacation") && subCommand === "enable") {
		const schedule = parts.slice(2).join(" ");
		return handleVacationsEnable(schedule, ctx);
	}

	// Handle: vacations disable
	if ((command === "vacations" || command === "vacation") && subCommand === "disable") {
		return handleVacationsDisable(ctx);
	}

	// Handle: vacations status
	if ((command === "vacations" || command === "vacation") && subCommand === "status") {
		return handleVacationsStatus(ctx);
	}

	// Handle: status now
	if (command === "status" && subCommand === "now") {
		return await handleStatusNow(ctx);
	}

	// Handle: status enable <schedule>
	if (command === "status" && subCommand === "enable") {
		const schedule = parts.slice(2).join(" ");
		return handleStatusEnable(schedule, ctx);
	}

	// Handle: status disable
	if (command === "status" && subCommand === "disable") {
		return handleStatusDisable(ctx);
	}

	// Handle: status settings
	if (command === "status" && subCommand === "settings") {
		return handleStatusSettings(ctx);
	}

	return { handled: false };
}

/**
 * Handle the watch command
 */
async function handleWatchCommand(linkText: string, ctx: CommandContext): Promise<CommandResult> {
	if (!linkText.trim()) {
		return {
			handled: true,
			error: "Please provide a Slack link or ID to watch.\n\nUsage: `watch <slack-link-or-id>`\n\nExamples:\n• `watch https://slack.com/archives/C0A7U1W8WR4`\n• `watch C0A7U1W8WR4`\n• `watch <#C0A7U1W8WR4>`",
		};
	}

	// Try to extract links from the text
	const links = extractSlackLinks(linkText);
	if (links.length === 0) {
		// Try parsing as a single link/ID
		const parsed = parseSlackLink(linkText);
		if (parsed) {
			links.push(parsed);
		}
	}

	if (links.length === 0) {
		return {
			handled: true,
			error: `Could not parse "${linkText}" as a Slack link or ID.\n\nSupported formats:\n• Channel URL: \`https://slack.com/archives/C0A7U1W8WR4\`\n• User URL: \`https://slack.com/team/U012AB3CD\`\n• Raw ID: \`C0A7U1W8WR4\` or \`U012AB3CD\`\n• Slack mention: \`<#C0A7U1W8WR4>\` or \`<@U012AB3CD>\``,
		};
	}

	const results: string[] = [];

	for (const link of links) {
		if (link.type === "channel" || link.type === "message") {
			const result = await addChannelToWatch(link.id, ctx);
			results.push(result);
		} else if (link.type === "user") {
			const result = await addUserToWatch(link.id, ctx);
			results.push(result);
		}
	}

	return {
		handled: true,
		response: results.join("\n"),
	};
}

/**
 * Add a channel to the watch list
 */
async function addChannelToWatch(channelId: string, ctx: CommandContext): Promise<string> {
	// Check if already watched
	const existing = getWatchedChannel(channelId);
	if (existing) {
		return `<#${channelId}> is already being watched (added ${new Date(existing.addedAt).toLocaleDateString()})`;
	}

	// Fetch channel info from Slack API
	try {
		const result = await ctx.client.conversations.info({ channel: channelId });
		if (!result.channel) {
			return `Could not find channel \`${channelId}\``;
		}

		const channel: WatchedChannel = {
			id: channelId,
			name: result.channel.name || channelId,
			purpose: result.channel.purpose?.value,
			addedAt: new Date().toISOString(),
			addedBy: ctx.userId,
			addedByName: ctx.userName,
		};

		addWatchedChannel(channel);
		return `Added <#${channelId}> to watched list`;
	} catch (error: any) {
		if (error.data?.error === "channel_not_found") {
			return `Channel \`${channelId}\` not found. Make sure the bot has access to this channel.`;
		}
		return `Failed to add channel \`${channelId}\`: ${error.message || error}`;
	}
}

/**
 * Add a user to the watch list
 */
async function addUserToWatch(userId: string, ctx: CommandContext): Promise<string> {
	// Check if already watched
	const existing = getWatchedUser(userId);
	if (existing) {
		return `<@${userId}> is already being watched (added ${new Date(existing.addedAt).toLocaleDateString()})`;
	}

	// Fetch user info from Slack API
	try {
		const result = await ctx.client.users.info({ user: userId });
		if (!result.user) {
			return `Could not find user \`${userId}\``;
		}

		const user: WatchedUser = {
			id: userId,
			username: result.user.name || userId,
			realName: result.user.real_name || result.user.profile?.display_name || result.user.name || userId,
			addedAt: new Date().toISOString(),
			addedBy: ctx.userId,
			addedByName: ctx.userName,
		};

		addWatchedUser(user);
		return `Added <@${userId}> (${user.realName}) to watched list`;
	} catch (error: any) {
		if (error.data?.error === "user_not_found") {
			return `User \`${userId}\` not found.`;
		}
		return `Failed to add user \`${userId}\`: ${error.message || error}`;
	}
}

/**
 * Handle the unwatch command
 */
function handleUnwatchCommand(linkText: string, ctx: CommandContext): CommandResult {
	if (!linkText.trim()) {
		return {
			handled: true,
			error: "Please provide a Slack link or ID to unwatch.\n\nUsage: `unwatch <slack-link-or-id>`",
		};
	}

	// Try to extract links from the text
	const links = extractSlackLinks(linkText);
	if (links.length === 0) {
		// Try parsing as a single link/ID
		const parsed = parseSlackLink(linkText);
		if (parsed) {
			links.push(parsed);
		}
	}

	if (links.length === 0) {
		return {
			handled: true,
			error: `Could not parse "${linkText}" as a Slack link or ID.`,
		};
	}

	const results: string[] = [];

	for (const link of links) {
		if (link.type === "channel" || link.type === "message") {
			const removed = removeWatchedChannel(link.id);
			if (removed) {
				results.push(`Removed <#${link.id}> from watched list`);
			} else {
				results.push(`<#${link.id}> was not in the watched list`);
			}
		} else if (link.type === "user") {
			const removed = removeWatchedUser(link.id);
			if (removed) {
				results.push(`Removed <@${link.id}> from watched list`);
			} else {
				results.push(`<@${link.id}> was not in the watched list`);
			}
		}
	}

	return {
		handled: true,
		response: results.join("\n"),
	};
}

/**
 * Handle the list command
 */
function handleListCommand(): CommandResult {
	const list = formatWatchedList();
	return {
		handled: true,
		response: list,
	};
}

/**
 * Handle news subscribe command
 * Format: news subscribe <topic> <schedule>
 * Examples:
 *   news subscribe AI daily 9am
 *   news subscribe Tech weekdays 5pm
 *   news subscribe Crypto weekly monday 10am
 */
function handleNewsSubscribe(args: string, ctx: CommandContext): CommandResult {
	if (!args.trim()) {
		return {
			handled: true,
			error: "Please provide a topic and schedule.\n\nUsage: `news subscribe <topic> <schedule>`\n\nExamples:\n• `news subscribe AI daily 9am`\n• `news subscribe Tech weekdays 5pm`\n• `news subscribe Crypto weekly monday 10am`",
		};
	}

	// Parse topic and schedule from args
	// Topic is the first word, schedule is the rest
	const firstSpaceIndex = args.indexOf(" ");
	if (firstSpaceIndex === -1) {
		return {
			handled: true,
			error: "Please provide both a topic and schedule.\n\nUsage: `news subscribe <topic> <schedule>`\n\nExamples:\n• `news subscribe AI daily 9am`",
		};
	}

	const topic = args.substring(0, firstSpaceIndex).trim();
	const scheduleText = args.substring(firstSpaceIndex + 1).trim();

	// Parse schedule into cron expression
	const cronExpression = parseSchedule(scheduleText);
	if (!cronExpression) {
		return {
			handled: true,
			error: `Could not parse schedule "${scheduleText}".\n\nSupported formats:\n• \`daily 9am\` or \`daily 9:00\`\n• \`weekdays 5pm\`\n• \`weekends 10am\`\n• \`weekly monday 9am\``,
		};
	}

	// Add subscription
	const result = addSubscription(ctx.channelId, topic, cronExpression);

	if (result.success) {
		return {
			handled: true,
			response: result.message,
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle news unsubscribe command
 */
function handleNewsUnsubscribe(topic: string, ctx: CommandContext): CommandResult {
	if (!topic.trim()) {
		return {
			handled: true,
			error: "Please provide a topic to unsubscribe from.\n\nUsage: `news unsubscribe <topic>`",
		};
	}

	const result = removeSubscription(ctx.channelId, topic.trim());

	if (result.success) {
		return {
			handled: true,
			response: result.message,
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle news list command
 */
function handleNewsList(ctx: CommandContext): CommandResult {
	const subscriptions = listSubscriptions(ctx.channelId);

	if (subscriptions.length === 0) {
		return {
			handled: true,
			response: "No news subscriptions for this channel.\n\nUse `news subscribe <topic> <schedule>` to add one.",
		};
	}

	const lines: string[] = ["*News subscriptions for this channel:*\n"];

	for (const sub of subscriptions) {
		const scheduleDesc = formatScheduleDescription(sub.schedule);
		const status = sub.enabled ? "✅" : "⏸️";
		lines.push(`• *${sub.topic}* - ${scheduleDesc} ${status}`);
		if (sub.lastRun) {
			const lastRunDate = new Date(sub.lastRun).toLocaleString();
			lines.push(`  _Last run: ${lastRunDate}_`);
		}
	}

	return {
		handled: true,
		response: lines.join("\n"),
	};
}

/**
 * Handle news now command (fetch and post immediately)
 */
async function handleNewsNow(topic: string, ctx: CommandContext): Promise<CommandResult> {
	if (!topic.trim()) {
		return {
			handled: true,
			error: "Please provide a topic.\n\nUsage: `news now <topic>`\n\nExample: `news now AI`",
		};
	}

	// Fetch and post news (in thread if called from a thread)
	const result = await fetchNewsNow(ctx.channelId, topic.trim(), ctx.threadTs);

	if (result.success) {
		// News was posted directly to the channel/thread, no need for a response
		return {
			handled: true,
			response: undefined, // Don't send a separate response
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle vacations now command (check and post vacation info for this week)
 */
async function handleVacationsNow(ctx: CommandContext): Promise<CommandResult> {
	const result = await broadcastVacationsNow(ctx.channelId, ctx.threadTs);

	if (result.success) {
		if (result.message === "No vacations found for this week") {
			return {
				handled: true,
				response: ":calendar: No vacations found for this week.",
			};
		}
		// Vacation info was posted directly, no need for a separate response
		return {
			handled: true,
			response: undefined,
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle vacations enable command
 * Format: vacations enable <schedule>
 * Examples:
 *   vacations enable weekly monday 9am
 *   vacations enable daily 10am
 */
function handleVacationsEnable(schedule: string, ctx: CommandContext): CommandResult {
	if (!schedule.trim()) {
		return {
			handled: true,
			error: "Please provide a schedule.\n\nUsage: `vacations enable <schedule>`\n\nExamples:\n• `vacations enable weekly monday 9am`\n• `vacations enable daily 10am`\n• `vacations enable weekdays 9:30am`",
		};
	}

	const result = enableVacationBroadcast(ctx.channelId, schedule.trim());

	if (result.success) {
		return {
			handled: true,
			response: `:palm_tree: ${result.message}`,
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle vacations disable command
 */
function handleVacationsDisable(ctx: CommandContext): CommandResult {
	const result = disableVacationBroadcast(ctx.channelId);

	if (result.success) {
		return {
			handled: true,
			response: `:palm_tree: ${result.message}`,
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle vacations status command
 */
function handleVacationsStatus(ctx: CommandContext): CommandResult {
	const status = getVacationBroadcastStatus(ctx.channelId);

	if (!status.enabled) {
		return {
			handled: true,
			response: ":palm_tree: Vacation broadcast is *disabled* for this channel.\n\nUse `vacations enable <schedule>` to enable it.\nExample: `vacations enable weekly monday 9am`",
		};
	}

	return {
		handled: true,
		response: `:palm_tree: Vacation broadcast is *enabled*\n\n• Schedule: ${status.scheduleDescription}\n\nUse \`vacations disable\` to turn it off.`,
	};
}

/**
 * Handle status now command — generate a project status report immediately
 */
async function handleStatusNow(ctx: CommandContext): Promise<CommandResult> {
	const result = await generateStatusNow(ctx.channelId, ctx.threadTs);

	if (result.success) {
		return {
			handled: true,
			response: undefined, // Report posted directly
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle status enable command
 * Format: status enable <schedule>
 * Examples:
 *   status enable weekly monday 9am
 *   status enable weekdays 10am
 */
function handleStatusEnable(schedule: string, ctx: CommandContext): CommandResult {
	if (!schedule.trim()) {
		return {
			handled: true,
			error: "Please provide a schedule.\n\nUsage: `status enable <schedule>`\n\nExamples:\n• `status enable weekly monday 9am`\n• `status enable weekdays 10am`",
		};
	}

	const cronExpression = parseSchedule(schedule.trim());
	if (!cronExpression) {
		return {
			handled: true,
			error: `Could not parse schedule "${schedule}".\n\nSupported formats:\n• \`weekly monday 9am\`\n• \`weekdays 10am\`\n• \`daily 9:00\``,
		};
	}

	const result = enableStatusSchedule(ctx.channelId, cronExpression);

	if (result.success) {
		const desc = formatScheduleDescription(cronExpression);
		return {
			handled: true,
			response: `:bar_chart: Status report schedule enabled — ${desc}`,
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle status disable command
 */
function handleStatusDisable(ctx: CommandContext): CommandResult {
	const result = disableStatusSchedule(ctx.channelId);

	if (result.success) {
		return {
			handled: true,
			response: `:bar_chart: ${result.message}`,
		};
	} else {
		return {
			handled: true,
			error: result.message,
		};
	}
}

/**
 * Handle status settings command
 */
function handleStatusSettings(ctx: CommandContext): CommandResult {
	const info = getStatusScheduleInfo(ctx.channelId);

	if (!info.enabled || !info.schedule) {
		return {
			handled: true,
			response: ":bar_chart: Status report schedule is *not configured* for this channel.\n\nUse `status enable <schedule>` to set one up.\nExample: `status enable weekly monday 9am`",
		};
	}

	const { formatScheduleDescription } = require("../news/index.js");
	const desc = formatScheduleDescription(info.schedule);
	const lastRunStr = info.lastRun
		? `\n• Last run: ${new Date(info.lastRun).toLocaleString()}`
		: "";

	return {
		handled: true,
		response: `:bar_chart: Status report schedule is *enabled*\n\n• Schedule: ${desc}${lastRunStr}\n\nUse \`status disable\` to turn it off.\nUse \`status now\` to generate one immediately.`,
	};
}
