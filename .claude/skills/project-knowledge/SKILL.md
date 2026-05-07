---
name: project-knowledge
description: Multi-source project knowledge search and integrations. Triggers on project plans, milestones, status, timelines, Jira tickets, Confluence wiki, Google Docs/Sheets, NotebookLM queries, or when Atlassian/Google URLs appear. Searches memory, canvas, NotebookLM, Confluence, and Jira progressively.
---

# Project Knowledge (Multi-Source Search)

## When to Use

Trigger on questions about project plans, milestones, timelines, status, roadmap, meetings, retros, vacations, Jira tickets, wiki/documentation, Google Docs, or general project information.

**Example triggers:**
- "What's the project plan?" / "What's the project status?"
- "Show me the milestones" / "What are we working on?"
- "What bugs are blocking release?" / "Show me PROJ-123"
- "Check the wiki for..." / "What's in Confluence?"
- "Open this Google Doc" / "Ask NotebookLM about..."

## Progressive Streaming (CRITICAL)

**You MUST output results progressively as each source completes. Do NOT wait for all sources before responding.**

After each source is searched:
1. Output the results immediately
2. Then continue to the next source

**NEVER say "Let me search..." and go silent. Output what you have, then continue searching.**

**Do NOT ask which source to search** — automatically check all relevant sources.

## Channel Configuration

Each channel has `data/context/channels/{channel_id}/config.json` (auto-provided via @ file reference):

```json
{
  "jira": [{ "project": "RECORD", "site": "company.atlassian.net" }],
  "confluence": [{ "space": "Record", "spaceId": "5235638291", "cloudId": "uuid", "homepageId": "123" }],
  "notebookLm": [{ "url": "https://notebooklm.google.com/...", "name": "SOW", "description": "Project requirements" }]
}
```

## Search Sources

| Priority | Source | Type | When to Use |
|----------|--------|------|-------------|
| 1 | Channel Memory | Instant (in context) | Always |
| 2 | Channel Canvas | Instant (in context) | Always |
| 3 | NotebookLM | API call | If configured in `config.json` |
| 4 | Confluence | API call | If configured in `config.json` |
| 5 | Jira | API call | **Only for bug/ticket/issue queries** |
| 6 | Unfetched Links | Fallback | Only if sources 1-5 didn't answer |

### Flow

1. **Output instant sources** (memory + canvas) immediately
2. **Launch parallel API calls** for NotebookLM, Confluence, Jira (if applicable)
3. **Output each result** as it completes
4. **Add final summary** after all sources return

### Source 1: Channel Memory (instant)

Already in context via `@context.md` file reference.

```
*From saved memory:*
[Relevant memory content here]
```

### Source 2: Channel Canvas (instant)

Check "## Slack Canvases" section in your prompt. Auto-fetched from channel canvases, shared canvas URLs, and canvas file attachments.

```
*From channel canvas:*
[Relevant canvas content here]
```

### Source 3: NotebookLM (API call, if configured)

Check `config.json` for `notebookLm` configuration.

```bash
cd .claude/skills/google && python3 scripts/run.py ask_question.py --question "Your question" --notebook-url "URL"
cd .claude/skills/google && python3 scripts/run.py notebook_manager.py list
```

```
*From NotebookLM:*
[Notebook answers here]
```

### Source 4: Confluence (API call, if configured)

Check `config.json` for `confluence` configuration. Key fields: `space` (key), `spaceId` (numerical — **required** for `getPagesInConfluenceSpace`), `cloudId`, `homepageId`.

**MCP tools:**

| Tool | Purpose |
|------|---------|
| `getConfluencePage` | Get page by ID |
| `getPagesInConfluenceSpace` | List pages (**requires numerical `spaceId`**) |
| `searchConfluenceUsingCql` | CQL search |
| `search` | General search across Jira and Confluence |

**Chrome fallback** (if MCP fails with 404/permission errors):
```bash
cd .claude/skills/atlassian && python3 scripts/run.py get_page.py --url "ATLASSIAN_URL"
```

Note: Confluence database URLs (`/database/`) cannot be read — ask users to share a regular page or export to CSV/PDF.

```
*From Confluence:*
[Wiki content here]
```

### Source 5: Jira (API call, ONLY for bugs/tickets)

**Only search Jira when the query is about bugs, issues, tickets, or defects.** Skip for general project status.

Use `searchJiraIssuesUsingJql` or `search` MCP tools with the project from config.

```
*From Jira:*
[Bug/issue summaries here]
```

### Source 6: Unfetched Links (FALLBACK — LAST RESORT)

Only search if Sources 1-5 did NOT provide the answer.

1. Review links found in Sources 1-5 results
2. For Google URLs → use Google skills
3. For Atlassian URLs → use MCP or Chrome fallback
4. For other external URLs → use `WebFetch` tool

**Prevent duplicates** — Track which URLs you've already fetched.

## Google Integration (Drive + NotebookLM)

### Proactive Link Detection (IMPORTANT)

When you see Google Docs/Sheets/Slides URLs in the conversation, **proactively fetch them**:

```bash
cd .claude/skills/google && python3 scripts/run.py get_file.py --file-url "URL"
cd .claude/skills/google && python3 scripts/run.py drive_manager.py search --query "search term"
```

## Final Summary (REQUIRED)

After streaming results from all sources, add a final summary:

```
---

*Summary:*
[2-4 sentences synthesizing key findings]
```

The summary should:
- Be concise (not repeat everything)
- Connect information across sources
- Highlight: current status, blockers, next steps, key dates
- Directly answer the user's original question
