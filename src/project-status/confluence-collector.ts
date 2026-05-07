import { log } from "../utils/log.js";
import { runClaudeCli, type CliRunResult } from "./cli-runner.js";
import type { ConfluenceConfig } from "../types/index.js";

// Confluence collector — spawns a Claude CLI session that runs CQL queries
// via Atlassian MCP and writes results to the report folder.
export async function collectConfluenceData(
	confluenceConfigs: ConfluenceConfig[],
	reportDir: string
): Promise<CliRunResult | undefined> {
	if (!confluenceConfigs.length) {
		log.info(`[StatusCollector:Confluence] No Confluence config, skipping`);
		return undefined;
	}

	const spaceDetails = confluenceConfigs
		.map((c) => `Space: "${c.space}" (spaceId: ${c.spaceId}, cloudId: ${c.cloudId})`)
		.join("\n");

	const prompt = `You are a data collector. Your ONLY job is to run Confluence queries and write the results to a file. Do NOT analyze or synthesize — just collect raw data.

## Setup

Use the Atlassian MCP tools with these Confluence spaces:
${spaceDetails}

## Queries

### Recently Updated Pages (last 7 days)

For each space, use searchConfluenceUsingCql:
CQL: \`space = "{SPACE_KEY}" AND lastModified >= now("-7d") ORDER BY lastModified DESC\`
Limit: 10

For the top 5 most relevant results, fetch the page content using getConfluencePage (with contentFormat: "markdown") to get a brief summary.

Write ALL results to: ${reportDir}/confluence-recent.md

## Output Format

The file should be markdown with:
- A heading per space
- A list of recently updated pages with: title, last modified date, author
- A 2-3 sentence summary of each page's content (from the fetched page body)
- If no pages were updated, write "No recent updates."
- Include the total count at the top

Do NOT include any commentary, analysis, or synthesis. Just raw data.`;

	log.info(`[StatusCollector:Confluence] Collecting data for ${confluenceConfigs.length} space(s)`);
	const result = await runClaudeCli(prompt, { timeoutMs: 180_000 });

	if (result.exitCode !== 0) {
		log.error(`[StatusCollector:Confluence] CLI exited with code ${result.exitCode}: ${result.stderr.substring(0, 200)}`);
	} else {
		log.info(`[StatusCollector:Confluence] Collection complete`);
	}
	return result;
}
