import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";
import { ROOT_DIR } from "../config/paths.js";

// Google Docs collector — runs the existing Google skill scripts
// to fetch document content and writes results to the report folder.
export async function collectGoogleData(
	googleDocUrls: string[],
	reportDir: string
): Promise<void> {
	if (!googleDocUrls.length) {
		log.info(`[StatusCollector:Google] No Google Doc URLs, skipping`);
		return;
	}

	const sections: string[] = [];

	for (const url of googleDocUrls) {
		try {
			log.info(`[StatusCollector:Google] Fetching: ${url}`);
			const content = await fetchGoogleDoc(url);
			if (content) {
				sections.push(`## ${url}\n\n${content}`);
			}
		} catch (error: any) {
			log.error(`[StatusCollector:Google] Failed to fetch ${url}: ${error.message}`);
			sections.push(`## ${url}\n\n_Error: ${error.message}_`);
		}
	}

	if (sections.length === 0) return;

	const output = `# Google Docs\n\n${sections.join("\n\n---\n\n")}\n`;
	writeFileSync(pathResolve(reportDir, "google-docs.md"), output);
	log.info(`[StatusCollector:Google] Wrote google-docs.md (${output.length} chars)`);
}

function fetchGoogleDoc(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const scriptDir = pathResolve(ROOT_DIR, ".claude/skills/google");
		const child = spawn(
			"python3",
			["scripts/run.py", "get_file.py", "--file-url", url],
			{ cwd: scriptDir, stdio: ["ignore", "pipe", "pipe"], shell: false }
		);

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => { stdout += data.toString(); });
		child.stderr.on("data", (data) => { stderr += data.toString(); });

		const timeout = setTimeout(() => {
			if (!child.killed) child.kill();
			reject(new Error("Timed out after 60s"));
		}, 60_000);

		child.on("close", (code) => {
			clearTimeout(timeout);
			if (code === 0 && stdout.trim()) {
				resolve(stdout.trim());
			} else {
				reject(new Error(stderr.trim() || `Exit code ${code}`));
			}
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});
	});
}
