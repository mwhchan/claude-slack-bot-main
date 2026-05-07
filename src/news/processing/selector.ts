/**
 * Article Selector (Stage 1)
 * Uses AI to select the best articles from RSS feeds
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { ROOT_DIR } from "../../config/paths.js";
import { log } from "../../utils/log.js";
import type { ParsedRssItem } from "../rss/types.js";
import { buildSelectionPrompt, buildRelevanceFilterPrompt } from "./prompts.js";

// Model options for different tasks
export type ClaudeModel = "haiku" | "sonnet" | "opus";

/**
 * Run Claude CLI and get JSON response
 */
export async function runClaudeForJson<T>(
	prompt: string,
	timeout: number = 60000,
	model: ClaudeModel = "sonnet"
): Promise<T | null> {
	return new Promise((resolve) => {
		const args = [
			"-p",
			prompt,
			"--model",
			model,
			"--output-format",
			"text",
			"--dangerously-skip-permissions",
			pathResolve(ROOT_DIR, ".env"),
		];

		const childProcess = spawn("claude", args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			cwd: ROOT_DIR,
		});

		let stdout = "";
		let stderr = "";

		if (childProcess.stdout) {
			childProcess.stdout.on("data", (data) => {
				stdout += data.toString();
			});
		}

		if (childProcess.stderr) {
			childProcess.stderr.on("data", (data) => {
				stderr += data.toString();
			});
		}

		const timeoutHandle = setTimeout(() => {
			log.warn(`[Selector] Claude CLI timeout`);
			childProcess.kill();
			resolve(null);
		}, timeout);

		childProcess.on("close", (code) => {
			clearTimeout(timeoutHandle);

			if (code !== 0) {
				log.error(`[Selector] Claude CLI exited with code ${code}`);
				if (stderr) log.verbose(`[Selector] stderr: ${stderr}`);
				resolve(null);
				return;
			}

			try {
				// Extract JSON from response
				const jsonMatch = stdout.match(/\[[\s\S]*\]/);
				if (!jsonMatch) {
					log.warn(`[Selector] No JSON array found in response`);
					log.verbose(`[Selector] Raw response: ${stdout.substring(0, 500)}`);
					resolve(null);
					return;
				}

				const result = JSON.parse(jsonMatch[0]) as T;
				resolve(result);
			} catch (error) {
				log.error(`[Selector] Failed to parse JSON:`, error);
				log.verbose(`[Selector] Raw response: ${stdout.substring(0, 500)}`);
				resolve(null);
			}
		});

		childProcess.on("error", (error) => {
			clearTimeout(timeoutHandle);
			log.error(`[Selector] Failed to spawn Claude CLI:`, error);
			resolve(null);
		});
	});
}

/**
 * Filter articles by relevance to a topic
 * Returns indices of relevant articles
 */
export async function filterByRelevance(
	items: ParsedRssItem[],
	topic: string
): Promise<number[]> {
	if (items.length === 0) return [];

	log.debug(`[Selector] Filtering ${items.length} items for relevance to "${topic}"`);

	const prompt = buildRelevanceFilterPrompt(items, topic);
	// Use sonnet for relevance filtering
	const indices = await runClaudeForJson<number[]>(prompt, 90000, "sonnet");

	if (!indices || !Array.isArray(indices)) {
		log.warn(`[Selector] Relevance filter failed, returning all items`);
		return items.map((_, i) => i);
	}

	// Validate indices
	const validIndices = indices.filter((i) => typeof i === "number" && i >= 0 && i < items.length);
	log.debug(`[Selector] Relevance filter: ${validIndices.length}/${items.length} items relevant`);

	return validIndices;
}

/**
 * Select the best articles using AI
 * Returns the selected items
 */
export async function selectBestArticles(
	items: ParsedRssItem[],
	topic: string,
	maxItems: number = 20
): Promise<ParsedRssItem[]> {
	if (items.length === 0) return [];

	// If we have fewer items than max, no need to select
	if (items.length <= maxItems) {
		log.debug(`[Selector] Only ${items.length} items, skipping selection`);
		return items;
	}

	log.info(`[Selector] Selecting best ${maxItems} articles from ${items.length} (using opus)`);

	const prompt = buildSelectionPrompt(items, topic, maxItems);
	// Use opus for selection - best at following deduplication rules
	const indices = await runClaudeForJson<number[]>(prompt, 180000, "opus");

	if (!indices || !Array.isArray(indices)) {
		log.warn(`[Selector] Selection failed, returning first ${maxItems} items`);
		return items.slice(0, maxItems);
	}

	// Validate and extract selected items
	const validIndices = indices.filter((i) => typeof i === "number" && i >= 0 && i < items.length);
	const selectedItems = validIndices.map((i) => items[i]);

	log.info(`[Selector] Selected ${selectedItems.length} articles`);

	// If we got too few, fill with remaining top items
	if (selectedItems.length < maxItems * 0.5) {
		log.warn(`[Selector] Too few items selected, using fallback`);
		return items.slice(0, maxItems);
	}

	return selectedItems;
}

/**
 * Combined selection: filter by relevance then select best
 */
export async function selectRelevantArticles(
	items: ParsedRssItem[],
	topic: string,
	maxItems: number = 20
): Promise<ParsedRssItem[]> {
	// Step 1: Filter by relevance (if many items)
	let relevantItems = items;

	if (items.length > 100) {
		const relevantIndices = await filterByRelevance(items, topic);
		relevantItems = relevantIndices.map((i) => items[i]);
		log.debug(`[Selector] After relevance filter: ${relevantItems.length} items`);
	}

	// Step 2: Select best articles
	return selectBestArticles(relevantItems, topic, maxItems);
}
