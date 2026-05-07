import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";

// Slack collector — no CLI needed, just reads local memory/context files
// and extracts relevant recent information.
export async function collectSlackData(
	channelId: string,
	reportDir: string,
	additionalChannels?: string[]
): Promise<void> {
	const sections: string[] = [];
	const channelIds = [channelId, ...(additionalChannels || [])];

	for (const chId of channelIds) {
		const channelDir = pathResolve(CHANNEL_CONTEXT_DIR, chId);
		const isMain = chId === channelId;
		const label = isMain ? "Primary Channel" : `Channel ${chId}`;

		// Read memory.md
		const memoryPath = pathResolve(channelDir, "memory.md");
		if (existsSync(memoryPath)) {
			const content = readFileSync(memoryPath, "utf-8").trim();
			if (content) {
				sections.push(`## ${label} — Memory\n\n${content}`);
			}
		}

		// Read context.md (auto-summaries)
		const contextPath = pathResolve(channelDir, "context.md");
		if (existsSync(contextPath)) {
			const content = readFileSync(contextPath, "utf-8").trim();
			if (content) {
				sections.push(`## ${label} — Recent Context\n\n${content}`);
			}
		}
	}

	if (sections.length === 0) {
		log.info(`[StatusCollector:Slack] No Slack context found for ${channelId}`);
		return;
	}

	const output = `# Slack Channel Context\n\n${sections.join("\n\n---\n\n")}\n`;
	writeFileSync(pathResolve(reportDir, "slack-context.md"), output);
	log.info(`[StatusCollector:Slack] Wrote slack-context.md (${output.length} chars)`);
}
