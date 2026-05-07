import { log } from "../utils/log.js";
import { runClaudeCli, type CliRunResult } from "./cli-runner.js";
import type { ProjectStatusConfig } from "../types/index.js";

// Synthesis — spawns a Claude CLI session that reads all collected .md files
// from the report folder and writes a synthesized report.md with STATUS_SECTION tags.
export async function synthesizeReport(
	reportDir: string,
	projectStatusConfig?: ProjectStatusConfig
): Promise<CliRunResult> {
	const customContext = projectStatusConfig?.customContext
		? `\n\n## Custom Focus\n${projectStatusConfig.customContext}`
		: "";

	const sectionsFilter = projectStatusConfig?.reportSections?.length
		? `\n\nOnly include these sections: ${projectStatusConfig.reportSections.join(", ")}`
		: "";

	const prompt = `You are a project status report synthesizer. Your job is to read all the collected data files and produce a comprehensive status report.

## Instructions

1. Read ALL .md files in ${reportDir}/ (except report.md itself). These contain raw data collected from Jira, Confluence, Slack, and Google Docs.
2. Analyze and synthesize the data into a structured project status report.
3. Write the final report to ${reportDir}/report.md

## Health Assessment

Score the project as Green, Yellow, or Red:
- Green: >70% sprint on track, 0 critical blockers, documentation current
- Yellow: 50-70% on track, 1-2 blockers, some staleness
- Red: <50% on track, 3+ blockers, stale docs

## Report Format

Write the report using [STATUS_SECTION:name] tags. Each section becomes a separate Slack message.
Use Slack mrkdwn formatting: *bold* (single asterisk), bullet points with •, <URL|label> for links.
Keep each section under 3500 characters.${sectionsFilter}

### Sections to include:

[STATUS_SECTION:executive_summary]
:bar_chart: *Project Status — {today's date}*

*Overall Health:* :large_green_circle: Green / :large_yellow_circle: Yellow / :red_circle: Red
(pick one based on assessment)

*Key Highlights:*
• Top 2-3 achievements or milestones

*Critical Blockers:*
• List or "None :white_check_mark:"

*What's Next:*
• Next major milestone
[/STATUS_SECTION]

[STATUS_SECTION:platform_summary]
:mag: *Source Health Signals*
Per-source summary with key data points from each collected file.
[/STATUS_SECTION]

[STATUS_SECTION:low_level_updates]
:clipboard: *Detailed Updates*
Focus this week, completed last week (max 6), upcoming this week (max 6), platform updates.
[/STATUS_SECTION]

[STATUS_SECTION:sprint_report]
:dart: *Sprint Report*
Sprint name/goal, committed vs completed points, carry-over, cycle time.
[/STATUS_SECTION]

[STATUS_SECTION:risk_blockers]
:warning: *Risks & Blockers*
Active blockers ranked by impact, risk register, overdue items, trends.
[/STATUS_SECTION]

## Important Rules

- If a data source file is missing or empty, note it briefly and skip that source — don't fabricate data
- Base everything on the actual collected data, not assumptions
- Keep the tone professional and factual
- Use Slack mrkdwn only: *bold* not **bold**, • not -, <URL|label> not [label](URL)${customContext}`;

	log.info(`[StatusSynthesis] Starting synthesis from ${reportDir}`);
	const result = await runClaudeCli(prompt, { timeoutMs: 180_000 });

	if (result.exitCode !== 0) {
		log.error(`[StatusSynthesis] CLI exited with code ${result.exitCode}: ${result.stderr.substring(0, 200)}`);
	} else {
		log.info(`[StatusSynthesis] Synthesis complete`);
	}
	return result;
}
