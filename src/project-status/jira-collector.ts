import { log } from "../utils/log.js";
import { runClaudeCli, type CliRunResult } from "./cli-runner.js";
import type { JiraConfig } from "../types/index.js";

// Jira collector — spawns a Claude CLI session that runs JQL queries
// via Atlassian MCP and writes results to the report folder.
export async function collectJiraData(
	jiraConfigs: JiraConfig[],
	reportDir: string
): Promise<CliRunResult | undefined> {
	if (!jiraConfigs.length) {
		log.info(`[StatusCollector:Jira] No Jira config, skipping`);
		return undefined;
	}

	const projectKeys = jiraConfigs.map((j) => j.project).join(", ");
	const site = jiraConfigs[0].site;

	const prompt = `You are a data collector. Your ONLY job is to run Jira queries and write the results to files. Do NOT analyze or synthesize — just collect raw data.

## Setup

Use the Atlassian MCP tools. The Jira site is "${site}".
First call getAccessibleAtlassianResources to get the cloudId, then run the queries below.

## Queries

For each project key (${projectKeys}), run these JQL queries using searchJiraIssuesUsingJql:

### 1. Current Sprint Issues
JQL: \`project = {KEY} AND sprint in openSprints() ORDER BY status\`
Fields: summary, status, assignee, priority, story_points, created, duedate
Write results to: ${reportDir}/jira-sprint.md

### 2. Blocked Items
JQL: \`project = {KEY} AND status = Blocked ORDER BY priority DESC\`
Fields: summary, status, assignee, priority, created
Write results to: ${reportDir}/jira-blocked.md

### 3. Completed Last 7 Days
JQL: \`project = {KEY} AND status = Done AND resolved >= -7d\`
Fields: summary, assignee, priority, resolved
Write results to: ${reportDir}/jira-completed.md

### 4. Overdue Items
JQL: \`project = {KEY} AND duedate < now() AND status != Done ORDER BY duedate\`
Fields: summary, status, assignee, priority, duedate
Write results to: ${reportDir}/jira-overdue.md

## Output Format

Each file should be markdown with:
- A heading with the query name and project key
- A markdown table with the query results
- If a query returns no results, write "No items found." and still create the file
- Include the total count at the top (e.g., "**12 items**")

Do NOT include any commentary, analysis, or synthesis. Just raw data tables.`;

	log.info(`[StatusCollector:Jira] Collecting data for projects: ${projectKeys}`);
	const result = await runClaudeCli(prompt, { timeoutMs: 180_000 });

	if (result.exitCode !== 0) {
		log.error(`[StatusCollector:Jira] CLI exited with code ${result.exitCode}: ${result.stderr.substring(0, 200)}`);
	} else {
		log.info(`[StatusCollector:Jira] Collection complete`);
	}
	return result;
}
