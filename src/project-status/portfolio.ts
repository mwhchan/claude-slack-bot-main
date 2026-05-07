/**
 * Portfolio View
 * Multi-project rollup: aggregate status from multiple channels into a single
 * executive summary. Reads the latest report.json from each channel's report directory.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";
import type { StatusReportJson } from "./export.js";

export interface PortfolioProject {
	channelId: string;
	channelName: string;
	reportDate: string;
	executiveSummary: string;
	dataSources: string[];
}

export interface PortfolioView {
	generatedAt: string;
	projects: PortfolioProject[];
}

/**
 * Build a portfolio view by aggregating the latest report from each channel
 * that has projectStatus configured.
 *
 * @param channelIds — specific channels to include (if empty, scans all channels)
 */
export function buildPortfolioView(channelIds?: string[]): PortfolioView {
	const idsToScan = channelIds?.length
		? channelIds
		: discoverStatusChannels();

	const projects: PortfolioProject[] = [];

	for (const channelId of idsToScan) {
		const project = loadLatestReport(channelId);
		if (project) {
			projects.push(project);
		}
	}

	log.info(`[Portfolio] Built portfolio with ${projects.length} project(s)`);

	return {
		generatedAt: new Date().toISOString(),
		projects,
	};
}

/**
 * Format portfolio view as Slack mrkdwn for posting.
 */
export function formatPortfolioForSlack(portfolio: PortfolioView): string {
	if (portfolio.projects.length === 0) {
		return "No project status reports found. Generate a status report first with `status now`.";
	}

	const lines: string[] = [
		`:bar_chart: *Portfolio Status Overview* — ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
		"",
	];

	for (const project of portfolio.projects) {
		lines.push(`*${project.channelName}* _(${project.reportDate})_`);
		// Extract just the first few lines of the executive summary
		const summaryLines = project.executiveSummary.split("\n").filter((l) => l.trim());
		const preview = summaryLines.slice(0, 4).join("\n");
		lines.push(preview);
		lines.push("");
	}

	return lines.join("\n");
}

function discoverStatusChannels(): string[] {
	if (!existsSync(CHANNEL_CONTEXT_DIR)) return [];

	const channels: string[] = [];
	const dirs = readdirSync(CHANNEL_CONTEXT_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory());

	for (const dir of dirs) {
		const configPath = pathResolve(CHANNEL_CONTEXT_DIR, dir.name, "config.json");
		if (existsSync(configPath)) {
			try {
				const config = JSON.parse(readFileSync(configPath, "utf-8"));
				if (config.projectStatus) {
					channels.push(dir.name);
				}
			} catch {
				// Skip invalid configs
			}
		}
	}

	return channels;
}

function loadLatestReport(channelId: string): PortfolioProject | null {
	const reportsDir = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "reports");
	if (!existsSync(reportsDir)) return null;

	// Find latest dated directory
	const dateDirs = readdirSync(reportsDir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
		.map((d) => d.name)
		.sort()
		.reverse();

	if (dateDirs.length === 0) return null;

	const latestDate = dateDirs[0];
	const reportDir = pathResolve(reportsDir, latestDate);

	// Try report.json first (structured), fallback to report.md
	const jsonPath = pathResolve(reportDir, "report.json");
	if (existsSync(jsonPath)) {
		try {
			const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as StatusReportJson;
			return {
				channelId,
				channelName: data.channelName || channelId,
				reportDate: latestDate,
				executiveSummary: data.sections.executive_summary || "",
				dataSources: data.metadata.dataSources,
			};
		} catch {
			// Fall through to report.md
		}
	}

	// Fallback: parse report.md
	const mdPath = pathResolve(reportDir, "report.md");
	if (!existsSync(mdPath)) return null;

	try {
		const content = readFileSync(mdPath, "utf-8");
		const execMatch = /\[STATUS_SECTION:executive_summary\]([\s\S]*?)\[\/STATUS_SECTION\]/.exec(content);

		// Read channel name from config
		const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");
		let channelName = channelId;
		if (existsSync(configPath)) {
			try {
				const config = JSON.parse(readFileSync(configPath, "utf-8"));
				channelName = config.displayName || config.name || channelId;
			} catch { /* use channelId */ }
		}

		return {
			channelId,
			channelName,
			reportDate: latestDate,
			executiveSummary: execMatch ? execMatch[1].trim() : "",
			dataSources: [],
		};
	} catch {
		return null;
	}
}
