/**
 * RSS Parser
 * Fetches and parses RSS feeds with filtering and deduplication
 */

import Parser from "rss-parser";
import { log } from "../../utils/log.js";
import { getFilteredFeeds } from "./feeds.js";
import type {
	RssSource,
	RawRssItem,
	ParsedRssItem,
	RssFetchOptions,
	RssFetchResult,
	NewsLanguage,
	RssCategory,
} from "./types.js";

// Create parser instance
const parser = new Parser({
	timeout: 10000,
	headers: {
		"User-Agent": "ClaudeSlackBot/1.0 (RSS Reader)",
		Accept: "application/rss+xml, application/xml, text/xml",
	},
});

/**
 * Clean HTML tags from text
 */
export function cleanHtml(html: string | undefined): string {
	if (!html) return "";

	return html
		.replace(/<[^>]*>/g, "") // Remove HTML tags
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ") // Normalize whitespace
		.trim();
}

/**
 * Fetch a single RSS feed
 */
export async function fetchRssFeed(source: RssSource): Promise<ParsedRssItem[]> {
	try {
		const feed = await parser.parseURL(source.url);
		const items: ParsedRssItem[] = [];

		for (const item of feed.items || []) {
			const rawItem = item as RawRssItem;

			// Skip items without title or link
			if (!rawItem.title || !rawItem.link) continue;

			// Parse publication date
			const pubDateStr = rawItem.isoDate || rawItem.pubDate;
			const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

			// Skip items with invalid dates
			if (isNaN(pubDate.getTime())) continue;

			// Get snippet from content
			const snippet = cleanHtml(rawItem.contentSnippet || rawItem.content || "");

			items.push({
				title: cleanHtml(rawItem.title),
				url: rawItem.link,
				source: source.name,
				pubDate,
				snippet: snippet.substring(0, 500), // Limit snippet length
				language: source.language,
				sourceCategory: source.category,
			});
		}

		return items;
	} catch (error) {
		log.warn(`[RSS] Failed to fetch ${source.name}: ${(error as Error).message}`);
		return [];
	}
}

/**
 * Fetch multiple RSS feeds with concurrency control
 */
export async function fetchMultipleFeeds(
	sources: RssSource[],
	concurrency: number = 5
): Promise<{ items: ParsedRssItem[]; failed: number }> {
	const allItems: ParsedRssItem[] = [];
	let failed = 0;

	// Process in batches
	for (let i = 0; i < sources.length; i += concurrency) {
		const batch = sources.slice(i, i + concurrency);
		const results = await Promise.all(batch.map((source) => fetchRssFeed(source)));

		for (let j = 0; j < results.length; j++) {
			if (results[j].length === 0) {
				failed++;
			} else {
				allItems.push(...results[j]);
			}
		}
	}

	return { items: allItems, failed };
}

/**
 * Filter items by age (hours)
 */
export function filterRecentItems(
	items: ParsedRssItem[],
	maxAgeHours: number = 48
): ParsedRssItem[] {
	const cutoff = new Date();
	cutoff.setHours(cutoff.getHours() - maxAgeHours);

	return items.filter((item) => item.pubDate >= cutoff);
}

/**
 * Deduplicate items by URL and similar titles
 */
export function deduplicateItems(items: ParsedRssItem[]): ParsedRssItem[] {
	const kept: ParsedRssItem[] = [];

	for (const item of items) {
		// Check for duplicate URL
		const normalizedUrl = normalizeUrl(item.url);
		const hasSameUrl = kept.some((k) => normalizeUrl(k.url) === normalizedUrl);
		if (hasSameUrl) {
			continue;
		}

		// Check for same story (using word overlap)
		const existingIndex = kept.findIndex((k) => isSameStory(k.title, item.title));

		if (existingIndex !== -1) {
			// Same story - keep higher priority source
			const existing = kept[existingIndex];
			const currentPriority = getSourcePriority(item.source);
			const existingPriority = getSourcePriority(existing.source);

			if (currentPriority > existingPriority) {
				// Replace with higher priority source
				kept[existingIndex] = item;
			}
			continue;
		}

		kept.push(item);
	}

	return kept;
}

/**
 * Normalize URL for comparison
 */
function normalizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		// Remove tracking parameters
		parsed.searchParams.delete("utm_source");
		parsed.searchParams.delete("utm_medium");
		parsed.searchParams.delete("utm_campaign");
		parsed.searchParams.delete("utm_content");
		parsed.searchParams.delete("utm_term");
		parsed.searchParams.delete("ref");
		parsed.searchParams.delete("source");
		return parsed.toString().toLowerCase();
	} catch {
		return url.toLowerCase();
	}
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\s]/g, "") // Remove punctuation
		.replace(/\s+/g, " ") // Normalize whitespace
		.trim()
		.substring(0, 100); // Limit length for comparison
}

/**
 * Extract key words from title (remove common stop words)
 */
function extractKeyWords(title: string): Set<string> {
	const stopWords = new Set([
		"a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
		"of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
		"being", "have", "has", "had", "do", "does", "did", "will", "would",
		"could", "should", "may", "might", "must", "shall", "can", "need",
		"into", "its", "it", "as", "that", "this", "new", "now", "says",
		"adds", "gets", "brings", "launches", "announces", "introduces",
	]);

	const words = title
		.toLowerCase()
		.replace(/[^\w\s]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !stopWords.has(w));

	return new Set(words);
}

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
	const intersection = new Set([...set1].filter((x) => set2.has(x)));
	const union = new Set([...set1, ...set2]);
	return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Check if two titles are about the same story
 */
function isSameStory(title1: string, title2: string): boolean {
	const words1 = extractKeyWords(title1);
	const words2 = extractKeyWords(title2);
	const similarity = jaccardSimilarity(words1, words2);
	// If 50%+ of key words overlap, likely same story
	return similarity >= 0.5;
}

/**
 * Get source priority (higher = more authoritative)
 */
function getSourcePriority(source: string): number {
	const priorities: Record<string, number> = {
		// AI official blogs - highest priority
		"OpenAI Blog": 100,
		"Anthropic News": 100,
		"Google AI Blog": 100,
		"DeepMind Blog": 100,
		"Meta AI Blog": 100,
		"Microsoft AI Blog": 100,
		// Major tech media
		TechCrunch: 90,
		"The Verge": 90,
		"Ars Technica": 90,
		Wired: 90,
		"MIT Technology Review": 90,
		VentureBeat: 85,
		// Other tech media
		Engadget: 80,
		"The Next Web": 80,
		ZDNet: 80,
		CNET: 80,
		// Aggregators
		"Hacker News": 70,
	};

	return priorities[source] || 50;
}

/**
 * Main function to fetch RSS feeds with all options
 */
export async function fetchRssFeeds(
	options: RssFetchOptions = {}
): Promise<RssFetchResult> {
	const {
		languages = ["en"],
		categories,
		maxAgeHours = 48,
		maxItemsPerFeed,
		concurrency = 5,
	} = options;

	// Get filtered feeds
	const feeds = getFilteredFeeds(
		languages as NewsLanguage[],
		categories as RssCategory[]
	);

	log.info(`[RSS] Fetching ${feeds.length} feeds (languages: ${languages.join(", ")})`);

	// Fetch all feeds
	const { items, failed } = await fetchMultipleFeeds(feeds, concurrency);
	const totalItemsBefore = items.length;

	log.debug(`[RSS] Fetched ${items.length} raw items from ${feeds.length - failed} feeds`);

	// Filter by age
	let filteredItems = filterRecentItems(items, maxAgeHours);
	log.debug(`[RSS] After age filter (${maxAgeHours}h): ${filteredItems.length} items`);

	// Deduplicate
	filteredItems = deduplicateItems(filteredItems);
	log.debug(`[RSS] After deduplication: ${filteredItems.length} items`);

	// Sort by date (newest first)
	filteredItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

	// Apply max items per feed if specified
	if (maxItemsPerFeed) {
		const itemsBySource = new Map<string, ParsedRssItem[]>();
		for (const item of filteredItems) {
			const sourceItems = itemsBySource.get(item.source) || [];
			if (sourceItems.length < maxItemsPerFeed) {
				sourceItems.push(item);
				itemsBySource.set(item.source, sourceItems);
			}
		}
		filteredItems = Array.from(itemsBySource.values()).flat();
		// Re-sort after limiting
		filteredItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
	}

	log.info(`[RSS] Final result: ${filteredItems.length} items`);

	return {
		items: filteredItems,
		fetchedFeeds: feeds.length - failed,
		failedFeeds: failed,
		totalItemsBefore,
		totalItemsAfter: filteredItems.length,
	};
}
