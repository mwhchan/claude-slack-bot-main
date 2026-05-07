import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { loadChannelConfig } from "../config/loader.js";
import { collectSlackData } from "./slack-collector.js";
import { collectJiraData } from "./jira-collector.js";
import { collectConfluenceData } from "./confluence-collector.js";
import { collectGoogleData } from "./google-collector.js";
import { collectGitHubData } from "./github-collector.js";
import { synthesizeReport } from "./synthesis.js";
import { generateTrendsContext } from "./trends.js";
import { exportReportJson } from "./export.js";
import { postReport, type PostContext } from "./poster.js";
import type { CliRunResult } from "./cli-runner.js";

// Main orchestrator: creates report folder, spawns collectors in parallel,
// waits for all, runs synthesis, posts to Slack.
export async function generateProjectStatus(
	channelId: string,
	context: PostContext
): Promise<boolean> {
	const startTime = Date.now();
	const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
	const reportDir = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "reports", date);

	// Create report directory
	if (!existsSync(reportDir)) {
		mkdirSync(reportDir, { recursive: true });
	}
	log.info(`[StatusOrchestrator] Report dir: ${reportDir}`);

	// Load channel config
	const config = loadChannelConfig(channelId);
	if (!config) {
		log.warn(`[StatusOrchestrator] No config for channel ${channelId}`);
		return false;
	}

	// Copy config to report dir for collectors to read
	writeFileSync(
		pathResolve(reportDir, "config.json"),
		JSON.stringify(config, null, 2)
	);

	const projectStatus = config.projectStatus;

	// Run collectors in parallel, capturing CLI results for token tracking
	log.info(`[StatusOrchestrator] Starting parallel data collection...`);
	const collectorResults = await Promise.allSettled([
		// Slack: always runs (local file reads, fast — no CLI tokens)
		collectSlackData(
			channelId,
			reportDir,
			projectStatus?.slackChannels
		),

		// Jira: if configured (returns CliRunResult with token data)
		config.jira?.length
			? collectJiraData(config.jira, reportDir)
			: Promise.resolve(undefined),

		// Confluence: if configured (returns CliRunResult with token data)
		config.confluence?.length
			? collectConfluenceData(config.confluence, reportDir)
			: Promise.resolve(undefined),

		// Google Docs: if configured (no CLI tokens)
		projectStatus?.googleDocs?.length
			? collectGoogleData(projectStatus.googleDocs, reportDir)
			: Promise.resolve(),

		// GitHub: if configured (no CLI tokens)
		projectStatus?.githubRepos?.length
			? collectGitHubData(projectStatus.githubRepos, reportDir)
			: Promise.resolve(),
	]);

	// Log any collector failures
	const collectorNames = ["Slack", "Jira", "Confluence", "Google", "GitHub"];
	for (let i = 0; i < collectorResults.length; i++) {
		if (collectorResults[i].status === "rejected") {
			log.error(`[StatusOrchestrator] ${collectorNames[i]} collector failed:`, (collectorResults[i] as PromiseRejectedResult).reason);
		}
	}

	const collectSeconds = Math.round((Date.now() - startTime) / 1000);
	log.info(`[StatusOrchestrator] Data collection done in ${collectSeconds}s`);

	// Generate trends context from historical reports (writes trends.md if history exists)
	generateTrendsContext(channelId, reportDir);

	// Run synthesis
	const synthesisResult = await synthesizeReport(reportDir, projectStatus);
	const synthSeconds = Math.round((Date.now() - startTime) / 1000);
	log.info(`[StatusOrchestrator] Synthesis done in ${synthSeconds}s total`);

	// Aggregate token usage from all CLI sessions (Jira, Confluence, Synthesis)
	const cliResults: (CliRunResult | undefined)[] = [
		collectorResults[1].status === "fulfilled" ? collectorResults[1].value as CliRunResult | undefined : undefined,
		collectorResults[2].status === "fulfilled" ? collectorResults[2].value as CliRunResult | undefined : undefined,
		synthesisResult,
	];

	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalCostUsd = 0;
	for (const r of cliResults) {
		if (r) {
			totalInputTokens += r.inputTokens || 0;
			totalOutputTokens += r.outputTokens || 0;
			totalCostUsd += r.costUsd || 0;
		}
	}

	// Export structured JSON for external automation
	exportReportJson(reportDir, channelId, config.displayName || config.name);

	// Post to Slack (pass channel name for docx title)
	context.channelName = config.displayName || config.name;
	const posted = await postReport(reportDir, context);
	const totalSeconds = Math.round((Date.now() - startTime) / 1000);

	// Log in [RESPONSE] format so the monitor can parse token usage
	const tokenInfo = totalInputTokens || totalOutputTokens
		? ` [${totalInputTokens}→${totalOutputTokens} tokens, $${totalCostUsd.toFixed(4)}]`
		: "";
	log.info(`[RESPONSE] (${totalSeconds}s)${tokenInfo}: "Status report generated for ${config.displayName || config.name}"`);
	log.info(`[StatusOrchestrator] Pipeline complete in ${totalSeconds}s (posted: ${posted})`);

	return posted;
}
