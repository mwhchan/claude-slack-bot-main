/**
 * RSS Feeds Configuration
 * 40+ RSS feed sources across tech media, AI blogs, and international sources
 */

import type { RssSource } from "./types.js";

export const RSS_FEEDS: RssSource[] = [
	// ============================================
	// Tech Media - English
	// ============================================
	{
		name: "TechCrunch",
		url: "https://techcrunch.com/feed/",
		category: "tech_media",
		language: "en",
	},
	{
		name: "The Verge",
		url: "https://www.theverge.com/rss/index.xml",
		category: "tech_media",
		language: "en",
	},
	{
		name: "Ars Technica",
		url: "https://feeds.arstechnica.com/arstechnica/index",
		category: "tech_media",
		language: "en",
	},
	{
		name: "Wired",
		url: "https://www.wired.com/feed/rss",
		category: "tech_media",
		language: "en",
	},
	{
		name: "VentureBeat",
		url: "https://venturebeat.com/feed/",
		category: "tech_media",
		language: "en",
	},
	{
		name: "MIT Technology Review",
		url: "https://www.technologyreview.com/feed/",
		category: "tech_media",
		language: "en",
	},
	{
		name: "Engadget",
		url: "https://www.engadget.com/rss.xml",
		category: "tech_media",
		language: "en",
	},
	{
		name: "The Next Web",
		url: "https://thenextweb.com/feed/",
		category: "tech_media",
		language: "en",
	},
	{
		name: "ZDNet",
		url: "https://www.zdnet.com/news/rss.xml",
		category: "tech_media",
		language: "en",
	},
	{
		name: "CNET",
		url: "https://www.cnet.com/rss/news/",
		category: "tech_media",
		language: "en",
	},
	{
		name: "The Information",
		url: "https://www.theinformation.com/feed",
		category: "tech_media",
		language: "en",
	},
	{
		name: "9to5Mac",
		url: "https://9to5mac.com/feed/",
		category: "tech_media",
		language: "en",
	},
	{
		name: "9to5Google",
		url: "https://9to5google.com/feed/",
		category: "tech_media",
		language: "en",
	},
	{
		name: "Hacker News",
		url: "https://hnrss.org/frontpage",
		category: "tech_media",
		language: "en",
	},

	// ============================================
	// AI Official Blogs
	// ============================================
	{
		name: "OpenAI Blog",
		url: "https://openai.com/blog/rss.xml",
		category: "ai_official_blog",
		language: "en",
	},
	{
		name: "Google AI Blog",
		url: "https://blog.google/technology/ai/rss/",
		category: "ai_official_blog",
		language: "en",
	},
	{
		name: "DeepMind Blog",
		url: "https://deepmind.google/blog/rss.xml",
		category: "ai_official_blog",
		language: "en",
	},
	{
		name: "Microsoft AI Blog",
		url: "https://blogs.microsoft.com/ai/feed/",
		category: "ai_official_blog",
		language: "en",
	},
	{
		name: "NVIDIA AI Blog",
		url: "https://blogs.nvidia.com/feed/",
		category: "ai_official_blog",
		language: "en",
	},
	{
		name: "Hugging Face Blog",
		url: "https://huggingface.co/blog/feed.xml",
		category: "ai_official_blog",
		language: "en",
	},

	// ============================================
	// Industry Vertical
	// ============================================
	{
		name: "Healthcare IT News",
		url: "https://www.healthcareitnews.com/feed",
		category: "industry_vertical",
		language: "en",
	},
	{
		name: "Robotics Business Review",
		url: "https://www.roboticsbusinessreview.com/feed/",
		category: "industry_vertical",
		language: "en",
	},
	{
		name: "The Robot Report",
		url: "https://www.therobotreport.com/feed/",
		category: "industry_vertical",
		language: "en",
	},

	// ============================================
	// International - Chinese
	// ============================================
	{
		name: "36Kr",
		url: "https://36kr.com/feed",
		category: "tech_media",
		language: "zh",
	},
	{
		name: "JiQiZhiXin",
		url: "https://www.jiqizhixin.com/rss",
		category: "tech_media",
		language: "zh",
	},
	{
		name: "Huxiu",
		url: "https://www.huxiu.com/rss/0.xml",
		category: "tech_media",
		language: "zh",
	},
	{
		name: "PingWest",
		url: "https://www.pingwest.com/feed",
		category: "tech_media",
		language: "zh",
	},

	// ============================================
	// International - Japanese
	// ============================================
	{
		name: "ITmedia",
		url: "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml",
		category: "tech_media",
		language: "ja",
	},
	{
		name: "GIGAZINE",
		url: "https://gigazine.net/news/rss_2.0/",
		category: "tech_media",
		language: "ja",
	},
	{
		name: "Impress Watch",
		url: "https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf",
		category: "tech_media",
		language: "ja",
	},

	// ============================================
	// International - French
	// ============================================
	{
		name: "L'Usine Digitale",
		url: "https://www.usine-digitale.fr/rss/",
		category: "tech_media",
		language: "fr",
	},
	{
		name: "Numerama",
		url: "https://www.numerama.com/feed/",
		category: "tech_media",
		language: "fr",
	},

	// ============================================
	// International - Spanish
	// ============================================
	{
		name: "Xataka",
		url: "https://www.xataka.com/feedburner.xml",
		category: "tech_media",
		language: "es",
	},
	{
		name: "Genbeta",
		url: "https://www.genbeta.com/feedburner.xml",
		category: "tech_media",
		language: "es",
	},

	// ============================================
	// International - German
	// ============================================
	{
		name: "Heise Online",
		url: "https://www.heise.de/rss/heise-atom.xml",
		category: "tech_media",
		language: "de",
	},
	{
		name: "Golem.de",
		url: "https://rss.golem.de/rss.php?feed=RSS2.0",
		category: "tech_media",
		language: "de",
	},

	// ============================================
	// International - Korean
	// ============================================
	{
		name: "ZDNet Korea",
		url: "https://zdnet.co.kr/rss/",
		category: "tech_media",
		language: "ko",
	},
	{
		name: "Bloter",
		url: "https://www.bloter.net/feed/",
		category: "tech_media",
		language: "ko",
	},

	// ============================================
	// International - Portuguese
	// ============================================
	{
		name: "Tecnoblog",
		url: "https://tecnoblog.net/feed/",
		category: "tech_media",
		language: "pt",
	},

	// ============================================
	// International - Italian
	// ============================================
	{
		name: "Tom's Hardware Italia",
		url: "https://www.tomshw.it/feed/",
		category: "tech_media",
		language: "it",
	},

	// ============================================
	// International - Dutch
	// ============================================
	{
		name: "Tweakers",
		url: "https://feeds.tweakers.net/mixed.xml",
		category: "tech_media",
		language: "nl",
	},

	// ============================================
	// International - Russian
	// ============================================
	{
		name: "Habr",
		url: "https://habr.com/rss/all/all/",
		category: "tech_media",
		language: "ru",
	},
];

/**
 * Get feeds filtered by language and/or category
 */
export function getFilteredFeeds(
	languages?: string[],
	categories?: string[]
): RssSource[] {
	return RSS_FEEDS.filter((feed) => {
		const languageMatch = !languages || languages.includes(feed.language);
		const categoryMatch = !categories || categories.includes(feed.category);
		return languageMatch && categoryMatch;
	});
}

/**
 * Get all unique languages in the feed list
 */
export function getAvailableLanguages(): string[] {
	return [...new Set(RSS_FEEDS.map((feed) => feed.language))];
}

/**
 * Get all unique categories in the feed list
 */
export function getAvailableCategories(): string[] {
	return [...new Set(RSS_FEEDS.map((feed) => feed.category))];
}
