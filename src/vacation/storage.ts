/**
 * Vacation Storage
 * Manages vacation entries in a markdown table file per channel.
 * Claude CLI edits vacations.md directly — no tag parsing needed.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";

export interface VacationEntry {
	user: string;
	userId?: string;
	start: string; // YYYY-MM-DD
	end: string; // YYYY-MM-DD
	note?: string;
}

/**
 * Get the path to a channel's vacations.md file
 */
export function getVacationsFilePath(channelId: string): string {
	return pathResolve(CHANNEL_CONTEXT_DIR, channelId, "vacations.md");
}

/**
 * Parse a markdown table into VacationEntry[].
 * Expected format:
 *   | Name | User ID | Start | End | Note |
 *   |------|---------|-------|-----|------|
 *   | Alice | U123 | 2026-02-13 | 2026-02-17 | trip |
 *
 * Skips malformed rows (missing dates, wrong column count, etc.)
 */
export function parseMarkdownTable(content: string): VacationEntry[] {
	const entries: VacationEntry[] = [];
	const lines = content.split("\n");
	const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

	for (const line of lines) {
		const trimmed = line.trim();
		// Skip non-table lines, header, and separator
		if (!trimmed.startsWith("|")) continue;
		if (trimmed.includes("---")) continue;

		// Split on pipe — drop first/last empty elements from leading/trailing pipes
		const raw = trimmed.split("|").map((c) => c.trim());
		const cells = raw.slice(1, -1);
		if (cells.length < 4) continue;

		const [name, userId, start, end, ...rest] = cells;

		// Skip header row
		if (name === "Name" || start === "Start") continue;

		// Validate dates
		if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) continue;

		entries.push({
			user: name,
			userId: userId || undefined,
			start,
			end,
			note: rest.join(" ").trim() || undefined,
		});
	}

	return entries;
}

/**
 * Generate markdown table content from VacationEntry[]
 */
export function generateMarkdownTable(entries: VacationEntry[]): string {
	let md = "# Vacations\n\n";
	md += "| Name | User ID | Start | End | Note |\n";
	md += "|------|---------|-------|-----|------|\n";

	for (const e of entries) {
		md += `| ${e.user} | ${e.userId || ""} | ${e.start} | ${e.end} | ${e.note || ""} |\n`;
	}

	return md;
}

/**
 * Load all vacation entries for a channel from vacations.md
 */
export function loadVacations(channelId: string): VacationEntry[] {
	const filePath = getVacationsFilePath(channelId);

	try {
		if (existsSync(filePath)) {
			const content = readFileSync(filePath, "utf-8");
			return parseMarkdownTable(content);
		}
	} catch (error) {
		log.error(`[Vacation] Failed to load vacations for ${channelId}:`, error);
	}

	return [];
}

/**
 * Format date to YYYY-MM-DD string in local timezone
 */
function formatDateLocal(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Get vacations for the current week (vacations that overlap with this week)
 */
export function getVacationsThisWeek(channelId: string): VacationEntry[] {
	const vacations = loadVacations(channelId);

	// Get current week's Monday and Sunday
	const today = new Date();
	const dayOfWeek = today.getDay();
	const monday = new Date(today);
	monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
	monday.setHours(0, 0, 0, 0);

	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);
	sunday.setHours(23, 59, 59, 999);

	// Use local timezone formatting (not UTC) to match stored dates
	const mondayStr = formatDateLocal(monday);
	const sundayStr = formatDateLocal(sunday);

	// Filter vacations that overlap with this week
	return vacations.filter((v) => {
		// Vacation overlaps with week if: start <= sunday AND end >= monday
		return v.start <= sundayStr && v.end >= mondayStr;
	});
}

/**
 * Clean up old vacation entries (past end date).
 * Rewrites vacations.md without expired entries.
 */
export function cleanupOldVacations(channelId: string): number {
	const vacations = loadVacations(channelId);
	const today = new Date().toISOString().split("T")[0];

	const active = vacations.filter((v) => v.end >= today);
	const removed = vacations.length - active.length;

	if (removed > 0) {
		const filePath = getVacationsFilePath(channelId);
		try {
			writeFileSync(filePath, generateMarkdownTable(active));
			log.info(`[Vacation] Cleaned up ${removed} old vacation(s) for <#${channelId}>`);
		} catch (error) {
			log.error(`[Vacation] Failed to write cleaned vacations for ${channelId}:`, error);
		}
	}

	return removed;
}
