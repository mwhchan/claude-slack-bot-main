/**
 * RSS Types
 * Type definitions for RSS feed parsing and processing
 */

// Supported languages
export type NewsLanguage =
	| "en"
	| "zh"
	| "ja"
	| "fr"
	| "es"
	| "de"
	| "ko"
	| "pt"
	| "it"
	| "ru"
	| "nl"
	| "ar"
	| "hi";

// RSS source categories
export type RssCategory =
	| "tech_media"
	| "ai_official_blog"
	| "industry_vertical";

// News categories for output
export type NewsCategory =
	| "ai_models"
	| "ai_products"
	| "ai_research"
	| "ai_business"
	| "general_tech";

// RSS feed source configuration
export interface RssSource {
	name: string;
	url: string;
	category: RssCategory;
	language: NewsLanguage;
}

// Raw item from RSS parser
export interface RawRssItem {
	title?: string;
	link?: string;
	pubDate?: string;
	isoDate?: string;
	contentSnippet?: string;
	content?: string;
	creator?: string;
	"dc:creator"?: string;
	categories?: string[];
	guid?: string;
}

// Parsed RSS item (cleaned and normalized)
export interface ParsedRssItem {
	title: string;
	url: string;
	source: string;
	pubDate: Date;
	snippet: string;
	language: NewsLanguage;
	sourceCategory: RssCategory;
}

// Options for fetching RSS feeds
export interface RssFetchOptions {
	languages?: NewsLanguage[];
	categories?: RssCategory[];
	maxAgeHours?: number;
	maxItemsPerFeed?: number;
	concurrency?: number;
}

// Result of RSS fetching
export interface RssFetchResult {
	items: ParsedRssItem[];
	fetchedFeeds: number;
	failedFeeds: number;
	totalItemsBefore: number;
	totalItemsAfter: number;
}
