/**
 * Trend Analysis
 * Extracts trend signals from historical reports for injection into synthesis prompts.
 */

import { loadRecentReports, formatHistoryForPrompt } from "./history.js";
import { writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";

/**
 * Generate a trends context file in the report directory.
 * Reads previous reports and writes a summary for the synthesis step.
 */
export function generateTrendsContext(channelId: string, reportDir: string): void {
	const reports = loadRecentReports(channelId, 4);

	if (reports.length === 0) {
		log.debug(`[StatusTrends] No historical reports found for ${channelId}`);
		return;
	}

	const historySummary = formatHistoryForPrompt(reports);
	if (!historySummary) {
		log.debug(`[StatusTrends] No executive summaries found in historical reports`);
		return;
	}

	const trendsContent = `# Trend Context\n\nThis file contains summaries from the last ${reports.length} report(s) for trend analysis.\nUse these to identify improving, stable, or declining trends per metric.\n\n${historySummary}`;

	writeFileSync(pathResolve(reportDir, "trends.md"), trendsContent);
	log.info(`[StatusTrends] Wrote trends.md with ${reports.length} historical report(s)`);
}
