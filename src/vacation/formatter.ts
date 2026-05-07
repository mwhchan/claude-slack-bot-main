/**
 * Vacation Formatter
 * Formats vacation information for Slack messages
 */

import type { VacationEntry } from "./storage.js";

/**
 * Format vacation entries for Slack broadcast
 */
export function formatVacationMessage(vacations: VacationEntry[]): string {
	if (vacations.length === 0) {
		return "";
	}

	const lines: string[] = [
		":palm_tree: *Vacation Alert - This Week*",
		"",
	];

	for (const v of vacations) {
		const dateRange = v.start === v.end
			? formatDate(v.start)
			: `${formatDate(v.start)} - ${formatDate(v.end)}`;

		let line = `• *${v.user}*: ${dateRange}`;
		if (v.note) {
			line += ` _(${v.note})_`;
		}
		lines.push(line);
	}

	lines.push("");
	lines.push("_Have a great week everyone!_");

	return lines.join("\n");
}

/**
 * Format a date string (YYYY-MM-DD) to a readable format
 */
function formatDate(dateStr: string): string {
	try {
		const date = new Date(dateStr + "T00:00:00");
		return date.toLocaleDateString("en-US", {
			weekday: "short",
			month: "short",
			day: "numeric",
		});
	} catch {
		return dateStr;
	}
}
