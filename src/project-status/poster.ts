import { existsSync, readFileSync, createReadStream } from "fs";
import { resolve as pathResolve, basename } from "path";
import { log } from "../utils/log.js";
import { buildSectionBlocks } from "../utils/format.js";
import { retryAsync } from "../utils/retry.js";
import { addReaction } from "../slack/reactions.js";
import { broadcastMonitorEvent } from "../monitor/websocket.js";
import { generateDocx } from "./docx-generator.js";

// Section header config
const SECTION_HEADERS: Record<string, { emoji: string; title: string }> = {
	executive_summary: { emoji: ":bar_chart:", title: "Project Status" },
	platform_summary: { emoji: ":mag:", title: "Source Health Signals" },
	low_level_updates: { emoji: ":clipboard:", title: "Detailed Updates" },
	sprint_report: { emoji: ":dart:", title: "Sprint Report" },
	risk_blockers: { emoji: ":warning:", title: "Risks & Blockers" },
};

const STATUS_SECTION_PATTERN = /\[STATUS_SECTION:(\w+)\]([\s\S]*?)\[\/STATUS_SECTION\]/g;

export interface PostContext {
	channelId: string;
	threadTs: string;
	say: (message: any) => Promise<any>;
	client: any;
	originalMessageTs?: string;
	channelName?: string;
}

// Read report.md, generate a .docx file, upload it to Slack,
// and post the executive summary as a thread message.
export async function postReport(
	reportDir: string,
	context: PostContext
): Promise<boolean> {
	const reportPath = pathResolve(reportDir, "report.md");

	if (!existsSync(reportPath)) {
		log.error(`[StatusPoster] report.md not found at ${reportPath}`);
		return false;
	}

	const reportContent = readFileSync(reportPath, "utf-8");
	const sections = parseSections(reportContent);

	if (sections.length === 0) {
		log.warn(`[StatusPoster] No STATUS_SECTION tags in report.md, posting as-is`);
		const blocks = buildSectionBlocks(reportContent.trim());
		await retryAsync(() =>
			context.say({
				text: reportContent.trim(),
				blocks,
				thread_ts: context.threadTs,
			})
		);
		return true;
	}

	// Generate Word document
	let docxPath: string | null = null;
	try {
		docxPath = await generateDocx(sections, reportDir, context.channelName);
		log.info(`[StatusPoster] Generated docx: ${docxPath}`);
	} catch (error: any) {
		log.error(`[StatusPoster] Failed to generate docx: ${error.message}`);
		// Fall back to posting sections as messages
	}

	// Post all sections as Slack messages
	await postSectionsAsMessages(sections, context);

	// Upload the docx file
	if (docxPath && existsSync(docxPath)) {
		try {
			const filename = basename(docxPath);
			const result = await context.client.filesUploadV2({
				channel_id: context.channelId,
				file: createReadStream(docxPath),
				filename,
				title: `Status Report — ${new Date().toISOString().split("T")[0]}`,
				thread_ts: context.threadTs,
				initial_comment: ":page_facing_up: Full status report attached.",
			});
			log.info(`[StatusPoster] Uploaded ${filename}`);

			// Broadcast for monitor
			try {
				const fileId = (result as any)?.files?.[0]?.id;
				if (fileId) {
					const fileInfo = await context.client.files.info({ file: fileId });
					const shares = fileInfo?.file?.shares;
					const channelShares = shares?.public?.[context.channelId] || shares?.private?.[context.channelId];
					const fileMessageTs = channelShares?.[0]?.ts;
					if (fileMessageTs) {
						broadcastMonitorEvent("aiReply", { channel: context.channelId, messageTs: fileMessageTs });
					}
				}
			} catch {
				// Best effort
			}
		} catch (error: any) {
			log.error(`[StatusPoster] Failed to upload docx: ${error.message}`);
		}
	}

	// Add reaction to original message
	if (context.originalMessageTs) {
		await addReaction(context.client, context.channelId, context.originalMessageTs, "bar_chart");
	}

	return true;
}

function parseSections(content: string): { name: string; content: string }[] {
	const sections: { name: string; content: string }[] = [];
	STATUS_SECTION_PATTERN.lastIndex = 0;
	let match;
	while ((match = STATUS_SECTION_PATTERN.exec(content)) !== null) {
		const [, name, text] = match;
		const trimmed = text.trim();
		if (trimmed) {
			sections.push({ name, content: trimmed });
		}
	}
	return sections;
}

async function postSectionsAsMessages(
	sections: { name: string; content: string }[],
	context: PostContext
): Promise<void> {
	for (const section of sections) {
		const header = SECTION_HEADERS[section.name];
		const alreadyHasHeader = header && section.content.includes(header.title);
		const text = header && !alreadyHasHeader
			? `${header.emoji} *${header.title}*\n\n${section.content}`
			: section.content;

		const blocks = buildSectionBlocks(text);
		try {
			await retryAsync(() =>
				context.say({ text, blocks, thread_ts: context.threadTs })
			);
		} catch (error) {
			log.error(`[StatusPoster] Failed to post section ${section.name}:`, error);
		}
	}
}
