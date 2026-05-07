/**
 * News Module
 * Exports all news-related functionality
 */

// Core functionality
export {
	fetchNews,
	fetchNewsViaRss,
	fetchNewsViaWebSearch,
	type NewsItem,
	type FetchNewsOptions,
} from "./fetcher.js";

export {
	formatNewsForSlack,
	formatNewsWithCategories,
	formatScheduleDescription,
	parseSchedule,
} from "./formatter.js";

export {
	initializeNewsScheduler,
	setNewsSlackClient,
	addSubscription,
	removeSubscription,
	listSubscriptions,
	fetchNewsNow,
	stopAllNewsJobs,
	type NewsSubscription,
} from "./scheduler.js";

// RSS module
export {
	// Types
	type NewsLanguage,
	type RssCategory,
	type NewsCategory,
	type RssSource,
	type ParsedRssItem,
	type RssFetchOptions,
	type RssFetchResult,
	// Feed management
	RSS_FEEDS,
	getFilteredFeeds,
	getAvailableLanguages,
	getAvailableCategories,
	// RSS parsing
	fetchRssFeed,
	fetchMultipleFeeds,
	fetchRssFeeds,
	filterRecentItems,
	deduplicateItems,
	cleanHtml,
} from "./rss/index.js";

// Processing module
export {
	// Prompts
	buildSelectionPrompt,
	buildSummarizationPrompt,
	buildRelevanceFilterPrompt,
	// Selection
	runClaudeForJson,
	filterByRelevance,
	selectBestArticles,
	selectRelevantArticles,
	type ClaudeModel,
	// Summarization
	summarizeArticles,
	groupByCategory,
	getCategoryDisplayName,
	getCategoryEmoji,
	type SummarizedArticle,
	type EnhancedNewsItem,
} from "./processing/index.js";
