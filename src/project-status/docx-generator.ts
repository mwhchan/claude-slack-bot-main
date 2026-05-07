import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";

// Section metadata for docx heading styling
const SECTION_META: Record<string, { title: string }> = {
	executive_summary: { title: "Executive Summary" },
	platform_summary: { title: "Source Health Signals" },
	low_level_updates: { title: "Detailed Updates" },
	sprint_report: { title: "Sprint Report" },
	risk_blockers: { title: "Risks & Blockers" },
};

interface ReportSection {
	name: string;
	content: string;
}

// Generate a .docx file from parsed report sections.
// Uses a Node.js child process with the `docx` npm package.
export async function generateDocx(
	sections: ReportSection[],
	reportDir: string,
	channelName?: string
): Promise<string> {
	const date = new Date().toISOString().split("T")[0];
	const title = channelName
		? `Project Status Report — ${channelName} — ${date}`
		: `Project Status Report — ${date}`;
	const outputPath = pathResolve(reportDir, `status-report-${date}.docx`);

	// Build the docx generation script
	// The docx npm package is globally installed per the docx skill
	const script = buildDocxScript(title, sections, outputPath);
	const scriptPath = pathResolve(reportDir, "_generate-docx.cjs");
	writeFileSync(scriptPath, script);

	await runNodeScript(scriptPath);
	log.info(`[DocxGenerator] Generated ${outputPath}`);
	return outputPath;
}

function buildDocxScript(
	title: string,
	sections: ReportSection[],
	outputPath: string
): string {
	// Convert Slack mrkdwn sections into docx-js paragraph arrays
	const sectionCode = sections.map((s) => {
		const meta = SECTION_META[s.name] || { title: s.name };
		// Escape backticks and backslashes for template literal safety
		const escapedContent = s.content
			.replace(/\\/g, "\\\\")
			.replace(/`/g, "\\`")
			.replace(/\$/g, "\\$");
		return `
	// Section: ${s.name}
	children.push(
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			spacing: { before: 400, after: 200 },
			children: [new TextRun({ text: ${JSON.stringify(meta.title)}, bold: true })],
		})
	);
	parseMrkdwn(\`${escapedContent}\`).forEach(p => children.push(p));
`;
	}).join("\n");

	return `
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Tab, TabStopType, TabStopPosition } = require("docx");
const fs = require("fs");

// Convert Slack mrkdwn text to docx Paragraph array
function parseMrkdwn(text) {
	const paragraphs = [];
	const lines = text.split("\\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			paragraphs.push(new Paragraph({ spacing: { after: 100 } }));
			continue;
		}

		// Bullet point
		if (trimmed.startsWith("• ") || trimmed.startsWith("- ")) {
			const content = trimmed.slice(2);
			paragraphs.push(
				new Paragraph({
					bullet: { level: 0 },
					spacing: { after: 60 },
					children: parseInline(content),
				})
			);
			continue;
		}

		// Sub-bullet
		if (trimmed.startsWith("  • ") || trimmed.startsWith("  - ")) {
			const content = trimmed.slice(4);
			paragraphs.push(
				new Paragraph({
					bullet: { level: 1 },
					spacing: { after: 60 },
					children: parseInline(content),
				})
			);
			continue;
		}

		// Regular paragraph
		paragraphs.push(
			new Paragraph({
				spacing: { after: 120 },
				children: parseInline(trimmed),
			})
		);
	}

	return paragraphs;
}

// Parse Slack mrkdwn inline formatting: *bold*, _italic_, ~strike~, \`code\`
function parseInline(text) {
	const runs = [];
	// Pattern matches *bold*, _italic_, ~strike~, \`code\`, or plain text
	const pattern = /\\*([^*]+)\\*|_([^_]+)_|~([^~]+)~|\`([^\`]+)\`|([^*_~\`]+)/g;
	let m;
	while ((m = pattern.exec(text)) !== null) {
		if (m[1] !== undefined) {
			// Bold
			runs.push(new TextRun({ text: m[1], bold: true }));
		} else if (m[2] !== undefined) {
			// Italic
			runs.push(new TextRun({ text: m[2], italics: true }));
		} else if (m[3] !== undefined) {
			// Strikethrough
			runs.push(new TextRun({ text: m[3], strike: true }));
		} else if (m[4] !== undefined) {
			// Code
			runs.push(new TextRun({ text: m[4], font: "Courier New", size: 20 }));
		} else if (m[5] !== undefined) {
			// Plain text
			runs.push(new TextRun({ text: m[5] }));
		}
	}
	return runs.length > 0 ? runs : [new TextRun({ text })];
}

async function main() {
	const children = [];

	// Title
	children.push(
		new Paragraph({
			heading: HeadingLevel.TITLE,
			alignment: AlignmentType.CENTER,
			spacing: { after: 400 },
			children: [new TextRun({ text: ${JSON.stringify(title)}, bold: true, size: 36 })],
		})
	);

	// Date line
	children.push(
		new Paragraph({
			alignment: AlignmentType.CENTER,
			spacing: { after: 600 },
			children: [new TextRun({ text: "Generated: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}", italics: true, color: "666666", size: 22 })],
		})
	);

	${sectionCode}

	const doc = new Document({
		sections: [{
			properties: {
				page: {
					size: { width: 12240, height: 15840 },
					margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
				},
			},
			children,
		}],
	});

	const buffer = await Packer.toBuffer(doc);
	fs.writeFileSync(${JSON.stringify(outputPath)}, buffer);
}

main().catch(err => { console.error(err); process.exit(1); });
`;
}

function runNodeScript(scriptPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("node", [scriptPath], {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});

		let stderr = "";
		child.stderr?.on("data", (data) => { stderr += data.toString(); });

		const timeout = setTimeout(() => {
			if (!child.killed) child.kill();
			reject(new Error("Docx generation timed out after 30s"));
		}, 30_000);

		child.on("close", (code) => {
			clearTimeout(timeout);
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Docx script exited with code ${code}: ${stderr.substring(0, 200)}`));
			}
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});
	});
}
