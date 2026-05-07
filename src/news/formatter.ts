/**
 * News Formatter
 * Formats news items for Slack using mrkdwn syntax
 */

import type { NewsItem } from "./fetcher.js";
import type { NewsCategory } from "./rss/types.js";
import { getCategoryDisplayName, getCategoryEmoji } from "./processing/summarizer.js";

/**
 * Format news items for Slack (simple list, no categories)
 */
export function formatNewsForSlack(topic: string, news: NewsItem[]): string {
	if (news.length === 0) {
		return `No recent news found for *${topic}*`;
	}

	// Always use simple format (no categories)
	return formatNewsSimple(topic, news);
}

/**
 * Format news items without categories (simple list)
 */
function formatNewsSimple(topic: string, news: NewsItem[]): string {
	const today = new Date();
	const dateStr = today.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	const lines: string[] = [];
	lines.push(`*News on ${topic} - ${dateStr}*\n`);

	news.forEach((item, index) => {
		// Title with link
		const title = item.title.replace(/[<>]/g, ""); // Escape Slack special chars
		lines.push(`${index + 1}. *<${item.url}|${title}>*`);

		// Source and summary
		const source = item.source ? `_${item.source}_` : "";
		const summary = item.summary || "";

		if (source && summary) {
			lines.push(`   ${source} - ${summary}`);
		} else if (source) {
			lines.push(`   ${source}`);
		} else if (summary) {
			lines.push(`   ${summary}`);
		}

		lines.push(""); // Empty line between items
	});

	return lines.join("\n").trim();
}

/**
 * Format news items grouped by category
 */
export function formatNewsWithCategories(topic: string, news: NewsItem[]): string {
	const today = new Date();
	const dateStr = today.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	// Group by category
	const grouped = new Map<NewsCategory, NewsItem[]>();

	for (const item of news) {
		const category = item.category || "general_tech";
		const existing = grouped.get(category) || [];
		existing.push(item);
		grouped.set(category, existing);
	}

	// Define category display order
	const categoryOrder: NewsCategory[] = [
		"ai_models",
		"ai_products",
		"ai_research",
		"ai_business",
		"general_tech",
	];

	const lines: string[] = [];
	lines.push(`*News on ${topic} - ${dateStr}*\n`);

	let itemNumber = 1;

	// Format each category
	for (const category of categoryOrder) {
		const items = grouped.get(category);
		if (!items || items.length === 0) continue;

		// Category header (no emoji)
		const displayName = getCategoryDisplayName(category);
		lines.push(`*${displayName}*`);

		// Format items in this category
		for (const item of items) {
			const title = item.title.replace(/[<>]/g, "");
			lines.push(`${itemNumber}. *<${item.url}|${title}>*`);

			const source = item.source ? `_${item.source}_` : "";
			const summary = item.summary || "";

			if (source && summary) {
				lines.push(`   ${source} - ${summary}`);
			} else if (source) {
				lines.push(`   ${source}`);
			} else if (summary) {
				lines.push(`   ${summary}`);
			}

			itemNumber++;
		}

		lines.push(""); // Empty line after category
	}

	return lines.join("\n").trim();
}

/**
 * Format a human-readable schedule description
 */
export function formatScheduleDescription(cronExpression: string): string {
	const parts = cronExpression.split(" ");
	if (parts.length !== 5) return cronExpression;

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

	// Parse hour and minute
	const hourNum = parseInt(hour, 10);
	const minuteNum = parseInt(minute, 10);
	const ampm = hourNum >= 12 ? "PM" : "AM";
	const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
	const timeStr = `${hour12}:${minuteNum.toString().padStart(2, "0")} ${ampm}`;

	// Parse day of week
	if (dayOfWeek === "*" && dayOfMonth === "*" && month === "*") {
		return `daily at ${timeStr}`;
	}

	if (dayOfWeek === "1-5" && dayOfMonth === "*" && month === "*") {
		return `weekdays at ${timeStr}`;
	}

	if (dayOfWeek === "0,6" && dayOfMonth === "*" && month === "*") {
		return `weekends at ${timeStr}`;
	}

	const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	if (/^[0-6]$/.test(dayOfWeek) && dayOfMonth === "*" && month === "*") {
		return `weekly on ${dayNames[parseInt(dayOfWeek, 10)]} at ${timeStr}`;
	}

	// Fallback to cron expression
	return `(${cronExpression})`;
}

/**
 * Parse a human-readable schedule into cron expression
 * Examples:
 * - "daily 9am" -> "0 9 * * *"
 * - "weekdays 5pm" -> "0 17 * * 1-5"
 * - "weekly monday 10am" -> "0 10 * * 1"
 */
export function parseSchedule(schedule: string): string | null {
	const normalizedSchedule = schedule.toLowerCase().trim();

	// Parse time (required)
	const timeMatch = normalizedSchedule.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
	if (!timeMatch) return null;

	let hour = parseInt(timeMatch[1], 10);
	const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
	const ampm = timeMatch[3]?.toLowerCase();

	// Convert to 24-hour format
	if (ampm === "pm" && hour !== 12) hour += 12;
	if (ampm === "am" && hour === 12) hour = 0;

	// Validate hour and minute
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

	// Parse frequency
	if (/\bdaily\b/.test(normalizedSchedule)) {
		return `${minute} ${hour} * * *`;
	}

	if (/\bweekdays?\b/.test(normalizedSchedule)) {
		return `${minute} ${hour} * * 1-5`;
	}

	if (/\bweekends?\b/.test(normalizedSchedule)) {
		return `${minute} ${hour} * * 0,6`;
	}

	// Weekly with specific day
	const dayMatch = normalizedSchedule.match(
		/\bweekly\b\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)?/i
	);
	if (dayMatch) {
		const dayMap: Record<string, number> = {
			sunday: 0,
			monday: 1,
			tuesday: 2,
			wednesday: 3,
			thursday: 4,
			friday: 5,
			saturday: 6,
		};
		const dayName = dayMatch[1]?.toLowerCase() || "monday";
		const dayNum = dayMap[dayName] ?? 1;
		return `${minute} ${hour} * * ${dayNum}`;
	}

	// If just time provided, default to daily
	if (timeMatch && !normalizedSchedule.includes("weekly")) {
		return `${minute} ${hour} * * *`;
	}

	return null;
}
