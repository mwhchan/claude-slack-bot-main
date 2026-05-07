import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";
import { ROOT_DIR } from "../config/paths.js";

export interface CliRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

// Spawn a short-lived Claude CLI session with a focused prompt.
// Used by collectors to run MCP queries and write results to disk.
export function runClaudeCli(
	prompt: string,
	options: { timeoutMs?: number; model?: string } = {}
): Promise<CliRunResult> {
	const { timeoutMs = 120_000, model = "sonnet" } = options;

	return new Promise((resolve) => {
		const args = [
			"-p",
			prompt,
			"--model",
			model,
			"--verbose",
			"--output-format",
			"stream-json",
			"--mcp-config",
			pathResolve(ROOT_DIR, ".mcp.json"),
			"--dangerously-skip-permissions",
		];

		const childProcess = spawn("claude", args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			cwd: ROOT_DIR,
		});

		let stdout = "";
		let stderr = "";
		let buffer = "";
		let inputTokens = 0;
		let outputTokens = 0;
		let costUsd = 0;

		if (childProcess.stdout) {
			childProcess.stdout.on("data", (data) => {
				const chunk = data.toString();
				stdout += chunk;
				buffer += chunk;

				// Parse newline-delimited JSON events to extract token usage
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete last line
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					try {
						const event = JSON.parse(trimmed);
						if (event.type === "result") {
							if (event.usage) {
								inputTokens = event.usage.input_tokens || 0;
								outputTokens = event.usage.output_tokens || 0;
							}
							if (event.total_cost_usd) costUsd = event.total_cost_usd;
						}
					} catch {
						// Not valid JSON, ignore
					}
				}
			});
		}

		if (childProcess.stderr) {
			childProcess.stderr.on("data", (data) => {
				stderr += data.toString();
			});
		}

		const timeout = setTimeout(() => {
			if (!childProcess.killed) {
				log.warn(`[StatusCLI] Timed out after ${timeoutMs / 1000}s, killing`);
				childProcess.kill();
			}
		}, timeoutMs);

		childProcess.on("close", (code) => {
			clearTimeout(timeout);
			// Parse any remaining buffer
			if (buffer.trim()) {
				try {
					const event = JSON.parse(buffer.trim());
					if (event.type === "result") {
						if (event.usage) {
							inputTokens = event.usage.input_tokens || 0;
							outputTokens = event.usage.output_tokens || 0;
						}
						if (event.total_cost_usd) costUsd = event.total_cost_usd;
					}
				} catch {
					// Ignore
				}
			}
			if (inputTokens || outputTokens) {
				log.debug(`[StatusCLI] Tokens: ${inputTokens}→${outputTokens}, $${costUsd.toFixed(4)}`);
			}
			resolve({ exitCode: code, stdout, stderr, inputTokens, outputTokens, costUsd });
		});

		childProcess.on("error", (error: any) => {
			clearTimeout(timeout);
			log.error(`[StatusCLI] Spawn error: ${error.message}`);
			resolve({ exitCode: 1, stdout: "", stderr: error.message, inputTokens: 0, outputTokens: 0, costUsd: 0 });
		});
	});
}
