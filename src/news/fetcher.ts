/**
 * News Fetcher
 * Fetches news articles using RSS feeds with two-stage AI processing
 * Falls back to Claude CLI with WebSearch if RSS fails
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { ROOT_DIR } from "../config/paths.js";
import { log } from "../utils/log.js";
import { fetchRssFeeds, type NewsLanguage, type RssCategory, type NewsCategory } from "./rss/index.js";
import { selectRelevantArticles } from "./processing/selector.js";
import { summarizeArticles, type EnhancedNewsItem } from "./processing/summarizer.js";

// Base news item (backward compatible)
export interface NewsItem {
	title: string;
	url: string;
	source: string;
	summary?: string;
	category?: NewsCategory;
	pubDate?: string;
}

// Options for fetching news
export interface FetchNewsOptions {
	useTwoStageProcessing?: boolean;
	preferRss?: boolean;
	languages?: NewsLanguage[];
	categories?: RssCategory[];
	maxItems?: number;
	maxAgeHours?: number;
	fallbackToWebSearch?: boolean;
}

// Default options
const DEFAULT_OPTIONS: FetchNewsOptions = {
	useTwoStageProcessing: true,
	preferRss: true,
	languages: ["en"],
	maxItems: 10,
	maxAgeHours: 24,
	fallbackToWebSearch: false,
};

// Major news sources to prioritize (for WebSearch fallback)
const MAJOR_NEWS_SOURCES = [
	"Reuters", "AP News", "BBC", "CNN", "The New York Times", "The Washington Post",
	"The Guardian", "Bloomberg", "CNBC", "Financial Times", "Wall Street Journal",
	"TechCrunch", "The Verge", "Wired", "Ars Technica", "MIT Technology Review",
	"VentureBeat", "ZDNet", "Engadget", "The Information", "Axios"
];

/**
 * Fetch news via RSS feeds with two-stage AI processing
 */
export async function fetchNewsViaRss(
	topic: string,
	options: FetchNewsOptions = {}
): Promise<NewsItem[]> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	log.info(`[News] Fetching news via RSS for "${topic}"`);

	try {
		// Step 1: Fetch RSS feeds
		const rssResult = await fetchRssFeeds({
			languages: opts.languages,
			categories: opts.categories,
			maxAgeHours: opts.maxAgeHours,
			concurrency: 5,
		});

		if (rssResult.items.length === 0) {
			log.warn(`[News] No RSS items found`);
			return [];
		}

		log.info(`[News] RSS fetched ${rssResult.items.length} items from ${rssResult.fetchedFeeds} feeds`);

		// Step 2: Two-stage processing if enabled
		if (opts.useTwoStageProcessing) {
			// Stage 1: Select best articles
			const selectedItems = await selectRelevantArticles(
				rssResult.items,
				topic,
				(opts.maxItems || 10) + 5 // Select a few extra for summarization
			);

			if (selectedItems.length === 0) {
				log.warn(`[News] No relevant articles found for "${topic}"`);
				return [];
			}

			// Stage 2: Summarize and categorize
			const enhancedItems = await summarizeArticles(selectedItems, topic);

			// Convert to NewsItem format
			return enhancedItems.slice(0, opts.maxItems).map(toNewsItem);
		}

		// Without two-stage processing, return raw items
		return rssResult.items.slice(0, opts.maxItems).map((item) => ({
			title: item.title,
			url: item.url,
			source: item.source,
			summary: item.snippet.substring(0, 150) + "...",
			pubDate: item.pubDate.toISOString(),
		}));
	} catch (error) {
		log.error(`[News] RSS fetch failed:`, error);
		return [];
	}
}

/**
 * Convert EnhancedNewsItem to NewsItem
 */
function toNewsItem(item: EnhancedNewsItem): NewsItem {
	return {
		title: item.title,
		url: item.url,
		source: item.source,
		summary: item.summary,
		category: item.category,
		pubDate: item.pubDate,
	};
}

/**
 * Fetch news using Claude CLI with WebSearch (original method)
 */
export async function fetchNewsViaWebSearch(topic: string, limit: number = 10): Promise<NewsItem[]> {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	const formatDate = (d: Date) => d.toISOString().split('T')[0];
	const todayStr = formatDate(today);
	const yesterdayStr = formatDate(yesterday);

	const prompt = `Search for news on "${topic}" using WebSearch.

DO MULTIPLE SEARCHES to get more results:
1. Search: "${topic} news today"
2. Search: "${topic} breaking news"
3. Search: "${topic} latest announcements"

Combine results from ALL searches. Aim for 8-10 unique articles.

CRITICAL DATE FILTER:
- Today's date is: ${todayStr}
- Yesterday's date is: ${yesterdayStr}
- ONLY include articles published on ${todayStr} or ${yesterdayStr}
- CHECK the publication date shown in search results
- REJECT any article older than yesterday
- If an article doesn't show a date, SKIP it

SOURCE FILTER:
- ONLY from major news sources: ${MAJOR_NEWS_SOURCES.join(", ")}
- REJECT blogs, press releases, prediction articles, and opinion pieces
- REJECT "trends for 2026" or "what to expect" articles - these are NOT news

NO DUPLICATES:
- Each article should be unique (different URL)
- If same story from multiple sources, pick the most reputable source

Return ONLY a valid JSON array. No headers, no explanation, no markdown, no text before or after.

Format:
[{"title":"Headline","url":"https://...","source":"Source Name","summary":"One sentence"}]

If NO recent articles are found, return exactly: []`;

	return new Promise((resolve) => {
		const args = [
			"-p",
			prompt,
			"--model",
			"sonnet",
			"--output-format",
			"text",
			"--mcp-config",
			pathResolve(ROOT_DIR, ".mcp.json"),
			"--dangerously-skip-permissions",
			pathResolve(ROOT_DIR, ".env"),
		];

		log.debug(`[News] Fetching news via WebSearch for topic: ${topic}`);

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

		// Timeout after 60 seconds
		const timeout = setTimeout(() => {
			log.warn(`[News] Timeout fetching news for "${topic}"`);
			childProcess.kill();
			resolve([]);
		}, 60000);

		childProcess.on("close", (code) => {
			clearTimeout(timeout);

			if (code !== 0) {
				log.error(`[News] Claude CLI exited with code ${code}`);
				if (stderr) log.verbose(`[News] stderr: ${stderr}`);
				resolve([]);
				return;
			}

			try {
				// Try to extract JSON from the response
				const jsonMatch = stdout.match(/\[[\s\S]*\]/);
				if (!jsonMatch) {
					log.warn(`[News] No JSON array found in response`);
					log.verbose(`[News] Raw response: ${stdout.substring(0, 500)}`);
					resolve([]);
					return;
				}

				const newsItems = JSON.parse(jsonMatch[0]) as NewsItem[];
				log.info(`[News] Fetched ${newsItems.length} news items for "${topic}"`);
				resolve(newsItems);
			} catch (error) {
				log.error(`[News] Failed to parse news response:`, error);
				log.verbose(`[News] Raw response: ${stdout.substring(0, 500)}`);
				resolve([]);
			}
		});

		childProcess.on("error", (error) => {
			clearTimeout(timeout);
			log.error(`[News] Failed to spawn Claude CLI:`, error);
			resolve([]);
		});
	});
}

/**
 * Fetch news for a topic (main entry point)
 * Uses RSS with two-stage processing by default, falls back to WebSearch
 */
export async function fetchNews(
	topic: string,
	limitOrOptions?: number | FetchNewsOptions
): Promise<NewsItem[]> {
	// Handle backward compatibility with old signature
	const options: FetchNewsOptions =
		typeof limitOrOptions === "number"
			? { ...DEFAULT_OPTIONS, maxItems: limitOrOptions }
			: { ...DEFAULT_OPTIONS, ...limitOrOptions };

	// Try RSS first if preferred
	if (options.preferRss) {
		const rssNews = await fetchNewsViaRss(topic, options);

		if (rssNews.length > 0) {
			return rssNews;
		}

		log.warn(`[News] RSS returned no results, trying WebSearch fallback`);
	}

	// Fallback to WebSearch
	if (options.fallbackToWebSearch) {
		return fetchNewsViaWebSearch(topic, options.maxItems);
	}

	return [];
}
