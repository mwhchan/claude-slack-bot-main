/**
 * JSON Export
 * Generates a structured JSON file from report.md for external automation
 * (e.g., Google Slides, dashboards). Saved alongside report history.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";

const STATUS_SECTION_PATTERN = /\[STATUS_SECTION:(\w+)\]([\s\S]*?)\[\/STATUS_SECTION\]/g;

export interface StatusReportJson {
	generatedAt: string;
	channelId: string;
	channelName?: string;
	sections: Record<string, string>;
	metadata: {
		dataSources: string[];
		reportDir: string;
	};
}

/**
 * Generate a structured JSON export from report.md.
 * Returns the JSON object and saves it to the report directory.
 */
export function exportReportJson(
	reportDir: string,
	channelId: string,
	channelName?: string
): StatusReportJson | null {
	const reportPath = pathResolve(reportDir, "report.md");

	if (!existsSync(reportPath)) {
		log.warn(`[StatusExport] report.md not found at ${reportPath}`);
		return null;
	}

	const content = readFileSync(reportPath, "utf-8");

	// Parse sections
	const sections: Record<string, string> = {};
	STATUS_SECTION_PATTERN.lastIndex = 0;
	let match;
	while ((match = STATUS_SECTION_PATTERN.exec(content)) !== null) {
		const [, name, text] = match;
		const trimmed = text.trim();
		if (trimmed) {
			sections[name] = trimmed;
		}
	}

	// Detect which data sources were collected
	const dataSources: string[] = [];
	const sourceFiles = [
		{ file: "slack-context.md", name: "slack" },
		{ file: "jira-sprint.md", name: "jira" },
		{ file: "confluence-recent.md", name: "confluence" },
		{ file: "google-docs.md", name: "google" },
		{ file: "github.md", name: "github" },
		{ file: "trends.md", name: "trends" },
	];
	for (const { file, name } of sourceFiles) {
		if (existsSync(pathResolve(reportDir, file))) {
			dataSources.push(name);
		}
	}

	const exportData: StatusReportJson = {
		generatedAt: new Date().toISOString(),
		channelId,
		channelName,
		sections,
		metadata: {
			dataSources,
			reportDir,
		},
	};

	const outputPath = pathResolve(reportDir, "report.json");
	writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
	log.info(`[StatusExport] Wrote report.json (${Object.keys(sections).length} sections)`);

	return exportData;
}
