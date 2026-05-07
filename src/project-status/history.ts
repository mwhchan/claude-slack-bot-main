/**
 * Report History
 * Load previous reports from data/context/channels/{id}/reports/ for trend analysis.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";

export interface HistoricalReport {
	date: string;       // YYYY-MM-DD
	content: string;    // Raw report.md content
	reportDir: string;  // Full path to report directory
}

/**
 * Load the last N reports for a channel, sorted by date descending (newest first).
 */
export function loadRecentReports(channelId: string, count: number = 4): HistoricalReport[] {
	const reportsDir = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "reports");

	if (!existsSync(reportsDir)) {
		return [];
	}

	try {
		const dateDirs = readdirSync(reportsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
			.map((d) => d.name)
			.sort()
			.reverse();

		const reports: HistoricalReport[] = [];

		for (const date of dateDirs.slice(0, count)) {
			const reportDir = pathResolve(reportsDir, date);
			const reportPath = pathResolve(reportDir, "report.md");

			if (existsSync(reportPath)) {
				try {
					const content = readFileSync(reportPath, "utf-8").trim();
					if (content) {
						reports.push({ date, content, reportDir });
					}
				} catch {
					// Skip unreadable reports
				}
			}
		}

		log.debug(`[StatusHistory] Loaded ${reports.length} historical reports for ${channelId}`);
		return reports;
	} catch (error) {
		log.error(`[StatusHistory] Failed to load reports for ${channelId}:`, error);
		return [];
	}
}

/**
 * Format historical reports as a compact prompt-friendly summary for the synthesis step.
 * Extracts just the executive_summary sections to keep it small.
 */
export function formatHistoryForPrompt(reports: HistoricalReport[]): string {
	if (reports.length === 0) return "";

	const EXEC_PATTERN = /\[STATUS_SECTION:executive_summary\]([\s\S]*?)\[\/STATUS_SECTION\]/;
	const summaries: string[] = [];

	for (const report of reports) {
		const match = EXEC_PATTERN.exec(report.content);
		if (match) {
			summaries.push(`### ${report.date}\n${match[1].trim()}`);
		}
	}

	if (summaries.length === 0) return "";

	return `## Previous Report Summaries (for trend analysis)\n\n${summaries.join("\n\n---\n\n")}\n`;
}
