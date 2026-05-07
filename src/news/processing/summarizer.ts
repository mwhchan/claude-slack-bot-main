/**
 * Article Summarizer (Stage 2)
 * Uses AI to create summaries and categorize articles
 */

import { log } from "../../utils/log.js";
import type { ParsedRssItem, NewsCategory } from "../rss/types.js";
import { buildSummarizationPrompt, buildDeduplicationPrompt } from "./prompts.js";
import { runClaudeForJson } from "./selector.js";

// Summarized article output
export interface SummarizedArticle {
	index: number;
	title: string;
	url: string;
	source: string;
	summary: string;
	category: NewsCategory;
}

// Enhanced news item with category and summary
export interface EnhancedNewsItem {
	title: string;
	url: string;
	source: string;
	summary: string;
	category: NewsCategory;
	pubDate?: string;
}

/**
 * Summarize and categorize articles using AI
 */
export async function summarizeArticles(
	items: ParsedRssItem[],
	topic: string
): Promise<EnhancedNewsItem[]> {
	if (items.length === 0) return [];

	log.info(`[Summarizer] Summarizing ${items.length} articles`);

	// Process in batches to avoid prompt length issues
	const batchSize = 15;
	const results: EnhancedNewsItem[] = [];

	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchResults = await summarizeBatch(batch, topic);
		results.push(...batchResults);
	}

	log.info(`[Summarizer] Summarized ${results.length} articles`);

	// Deduplicate stories
	const deduplicated = await deduplicateStories(results);
	log.info(`[Summarizer] After deduplication: ${deduplicated.length} articles`);

	return deduplicated;
}

/**
 * Deduplicate stories using AI to identify same news from different sources
 */
async function deduplicateStories(items: EnhancedNewsItem[]): Promise<EnhancedNewsItem[]> {
	if (items.length <= 1) return items;

	// Build list for deduplication prompt
	const itemsForPrompt = items.map((item, index) => ({
		index,
		title: item.title,
		source: item.source,
	}));

	const prompt = buildDeduplicationPrompt(itemsForPrompt);
	// Use opus for deduplication - best at identifying same stories
	const indicesToKeep = await runClaudeForJson<number[]>(prompt, 120000, "opus");

	if (!indicesToKeep || !Array.isArray(indicesToKeep)) {
		log.warn(`[Summarizer] Deduplication failed, returning all items`);
		return items;
	}

	// Filter to keep only selected indices
	const validIndices = indicesToKeep.filter(
		(i) => typeof i === "number" && i >= 0 && i < items.length
	);

	const deduplicated = validIndices.map((i) => items[i]);
	return deduplicated;
}

/**
 * Summarize a batch of articles
 */
async function summarizeBatch(
	items: ParsedRssItem[],
	topic: string
): Promise<EnhancedNewsItem[]> {
	const prompt = buildSummarizationPrompt(items, topic);
	// Use sonnet for summarization
	const summaries = await runClaudeForJson<SummarizedArticle[]>(prompt, 120000, "sonnet");

	if (!summaries || !Array.isArray(summaries)) {
		log.warn(`[Summarizer] Batch summarization failed, using fallback`);
		// Fallback: return items with snippet as summary
		return items.map((item) => ({
			title: item.title,
			url: item.url,
			source: item.source,
			summary: item.snippet.substring(0, 150) + "...",
			category: "general_tech" as NewsCategory,
			pubDate: item.pubDate.toISOString(),
		}));
	}

	// Map summaries back to items
	const results: EnhancedNewsItem[] = [];

	for (const summary of summaries) {
		// Validate the summary object
		if (!summary.title || !summary.url || !summary.summary) {
			continue;
		}

		// Find original item for pubDate
		const originalItem = items[summary.index] || items.find((item) => item.url === summary.url);

		results.push({
			title: summary.title,
			url: summary.url,
			source: summary.source || originalItem?.source || "Unknown",
			summary: summary.summary,
			category: isValidCategory(summary.category) ? summary.category : "general_tech",
			pubDate: originalItem?.pubDate.toISOString(),
		});
	}

	return results;
}

/**
 * Validate that a category string is a valid NewsCategory
 */
function isValidCategory(category: string): category is NewsCategory {
	const validCategories: NewsCategory[] = [
		"ai_models",
		"ai_products",
		"ai_research",
		"ai_business",
		"general_tech",
	];
	return validCategories.includes(category as NewsCategory);
}

/**
 * Group articles by category
 */
export function groupByCategory(
	items: EnhancedNewsItem[]
): Map<NewsCategory, EnhancedNewsItem[]> {
	const grouped = new Map<NewsCategory, EnhancedNewsItem[]>();

	for (const item of items) {
		const category = item.category || "general_tech";
		const existing = grouped.get(category) || [];
		existing.push(item);
		grouped.set(category, existing);
	}

	return grouped;
}

/**
 * Get human-readable category name
 */
export function getCategoryDisplayName(category: NewsCategory): string {
	const names: Record<NewsCategory, string> = {
		ai_models: "AI Models",
		ai_products: "AI Products",
		ai_research: "AI Research",
		ai_business: "AI Business",
		general_tech: "General Tech",
	};
	return names[category] || "General Tech";
}

/**
 * Get category emoji
 */
export function getCategoryEmoji(category: NewsCategory): string {
	const emojis: Record<NewsCategory, string> = {
		ai_models: "🤖",
		ai_products: "📱",
		ai_research: "🔬",
		ai_business: "💼",
		general_tech: "💻",
	};
	return emojis[category] || "📰";
}
