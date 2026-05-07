/**
 * Prompt Templates
 * AI prompts for two-stage news processing
 */

import type { ParsedRssItem } from "../rss/types.js";
import type { NewsCategory } from "../rss/types.js";

/**
 * Build prompt for Stage 1: Article Selection
 * AI selects the most relevant and interesting articles
 */
export function buildSelectionPrompt(
	items: ParsedRssItem[],
	topic: string,
	maxItems: number = 20
): string {
	const today = new Date();
	const dateStr = today.toISOString().split("T")[0];

	// Format items for the prompt
	const itemsList = items
		.map((item, index) => {
			const pubDateStr = item.pubDate.toISOString().split("T")[0];
			return `[${index}] ${item.title}
   Source: ${item.source} | Date: ${pubDateStr}
   Snippet: ${item.snippet.substring(0, 200)}...`;
		})
		.join("\n\n");

	return `You are a news editor selecting the most relevant articles about "${topic}" for a professional audience.

Today's date: ${dateStr}

PRIORITY - AI MODEL NEWS (MUST select at least 3-4 of these):
- News mentioning: Claude/Anthropic, GPT/OpenAI, Gemini/DeepMind/Google
- Chinese models: Qwen, DeepSeek, Kimi, GLM
- Open source: LocalLLaMA, Hugging Face models
- Model releases, updates, integrations, benchmarks
- Companies integrating AI models into products
IMPORTANT: Always include at least 3-4 AI model news if available

CRITICAL RULE - NO DUPLICATE STORIES:
Multiple sources often cover the same story. You MUST select only ONE article per news story.
Example: If 5 articles discuss "Apple adds Claude to Xcode", pick ONLY the best one.
DO NOT include multiple articles about the same announcement.

Below are ${items.length} articles. Select up to ${maxItems} articles covering DIFFERENT stories:

1. **Priority**: AI model news first (Claude, GPT, Gemini, LLM, model releases)
2. **No Duplicates**: ONE article per story
3. **Relevance**: How closely related to "${topic}"

AVOID:
- Multiple articles about the same story (CRITICAL)
- Opinion pieces or editorials
- "Prediction" or "trends" articles
- Service outages, downtime, "is back up" news

ARTICLES:
${itemsList}

Return ONLY a valid JSON array of selected article indices (0-based).
Example: [0, 3, 5, 7, 12, 15]

No explanation, no headers, no markdown - just the JSON array.`;
}

/**
 * Build prompt for Stage 2: Article Summarization
 * AI creates summaries and categorizes articles
 */
export function buildSummarizationPrompt(
	items: ParsedRssItem[],
	topic: string
): string {
	const categoryDescriptions: Record<NewsCategory, string> = {
		ai_models: "AI model news: Claude/Anthropic, GPT/OpenAI, Gemini/DeepMind/Google, Qwen, DeepSeek, Kimi, GLM, LocalLLaMA",
		ai_products: "AI product launches, features, apps (NOT about specific models)",
		ai_research: "Research papers, scientific breakthroughs, academic work",
		ai_business: "Funding, acquisitions, partnerships, business deals",
		general_tech: "General technology news not fitting other categories",
	};

	const categoryList = Object.entries(categoryDescriptions)
		.map(([key, desc]) => `- ${key}: ${desc}`)
		.join("\n");

	// Format items for the prompt
	const itemsList = items
		.map((item, index) => {
			return `[${index}] ${item.title}
   Source: ${item.source}
   URL: ${item.url}
   Snippet: ${item.snippet}`;
		})
		.join("\n\n");

	return `You are a news summarizer creating concise summaries for articles about "${topic}".

For each article below, create:
1. A 1-2 sentence summary capturing the key news
2. Assign the most appropriate category

CATEGORIES:
${categoryList}

ARTICLES:
${itemsList}

Return ONLY a valid JSON array with this structure:
[
  {
    "index": 0,
    "title": "Article title",
    "url": "https://...",
    "source": "Source Name",
    "summary": "One or two sentence summary of the key news.",
    "category": "ai_models"
  }
]

RULES:
- Keep summaries factual and informative
- Use active voice
- Don't start with "The article discusses..." - just state the news
- Choose the MOST specific category that fits
- If unsure, use "general_tech"

No explanation, no headers, no markdown - just the JSON array.`;
}

/**
 * Build a simple prompt for topic relevance filtering
 */
export function buildRelevanceFilterPrompt(
	items: ParsedRssItem[],
	topic: string
): string {
	const itemsList = items
		.map((item, index) => `[${index}] ${item.title}`)
		.join("\n");

	return `Filter these article titles to only those related to "${topic}".

TITLES:
${itemsList}

Return ONLY a JSON array of indices that are relevant to "${topic}".
Example: [0, 2, 5, 8]

No explanation, just the JSON array.`;
}

/**
 * Build prompt to deduplicate stories (keep best article per story)
 */
export function buildDeduplicationPrompt(
	items: { index: number; title: string; source: string }[]
): string {
	const itemsList = items
		.map((item) => `[${item.index}] ${item.source}: ${item.title}`)
		.join("\n");

	return `Deduplicate: if multiple articles cover the SAME story, keep only ONE index.

ARTICLES:
${itemsList}

OUTPUT FORMAT: Return ONLY a raw JSON array, nothing else.
CORRECT: [0, 3, 7, 12]
WRONG: Any text before or after the array

JSON array of indices to keep:`;
}
