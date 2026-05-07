---
name: news-search
description: Handles news queries - fetching latest news via RSS pipeline. Triggers on "news about", "latest news", "what's happening with", "any updates on", "current events about". DO NOT use WebSearch for news — always output the [NEWS:topic] tag.
---

# News Search

## Trigger Phrases

- "What's the news on..."
- "News about..."
- "Latest news on..."
- "What's happening with..."
- "Any updates on..."
- "Current events about..."

## How to Handle (CRITICAL)

DO NOT use WebSearch for news. The bot has an internal RSS pipeline with 40+ curated sources that produces better results.

**Always output the `[NEWS:topic]` tag.** The bot processes this tag and fetches news via the RSS pipeline automatically.

### Steps

1. Extract the topic from the user's message
2. Output the `[NEWS:topic]` tag
3. Add a brief message so the user knows news is coming

### Example

User: "What's the news on AI?"

```
[NEWS:AI]
Fetching the latest AI news for you :newspaper:
```

User: "Any updates on crypto and blockchain?"

```
[NEWS:crypto and blockchain]
Getting the latest crypto news :newspaper:
```

### Rules

- NEVER use WebSearch for news queries
- One `[NEWS:topic]` tag per request
- Keep the topic concise but descriptive (e.g., "AI", "crypto", "Apple", "climate tech")
- The brief message after the tag is optional — if you only output the tag with no text, only the RSS results will appear
