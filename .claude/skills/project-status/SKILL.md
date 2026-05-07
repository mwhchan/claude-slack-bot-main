---
name: project-status
description: Generate project status reports from Jira, Confluence, Slack memory, and Google Docs. Triggers on "project status", "status update", "status report", "weekly status", "project health", "generate status", "how is the project going".
---

# Project Status Report

## When to Use

Trigger when the user asks for a project status report, weekly update, project health check, or status summary.

**Example triggers:**
- "Generate a project status report"
- "What's the project status?" / "How is the project going?"
- "Weekly status update" / "Status report please"
- "Project health check"

## Prerequisites

Read the channel's `config.json` (auto-provided via @ file reference). You need:
- `jira` — for sprint/ticket data
- `confluence` — for wiki/documentation activity
- `notebookLm` — for project scope/requirements context
- `projectStatus` — for extra config (Google Docs URLs, custom context)

**Gracefully skip any source that is not configured.** If only Jira is configured, generate a report from Jira data only.

## Data Collection

Collect data from each configured source sequentially. Keep queries focused to manage context.

### 1. Slack Context (instant — already in prompt)

Review channel `memory.md` and `context.md` for:
- Recent decisions and announcements
- Blockers mentioned in conversation
- Key topics from the past week
- Team updates and milestones

### 2. Jira (if configured)

Use `searchJiraIssuesUsingJql` MCP tool. For each configured Jira project, run these queries:

**Sprint issues:**
```
project = {KEY} AND sprint in openSprints() ORDER BY status
```
Fields: `summary, status, assignee, priority, story_points, created, duedate`

**Blocked items:**
```
project = {KEY} AND status = Blocked ORDER BY priority DESC
```

**Completed last 7 days:**
```
project = {KEY} AND status = Done AND resolved >= -7d
```

**Overdue:**
```
project = {KEY} AND duedate < now() AND status != Done ORDER BY duedate
```

Use `cloudId` from the channel's Jira site config. Use `getAccessibleAtlassianResources` if cloudId is not cached.

### 3. Confluence (if configured)

Use `searchConfluenceUsingCql` MCP tool:

**Recently updated pages:**
```
space = {SPACE_KEY} AND lastModified >= now("-7d") ORDER BY lastModified DESC
```

Fetch the top 3-5 most relevant pages with `getConfluencePage` for summaries.

### 4. Google Docs (if `projectStatus.googleDocs` configured)

For each URL in `projectStatus.googleDocs`:
```bash
cd .claude/skills/google && python3 scripts/run.py get_file.py --file-url "URL"
```

Extract key status information, milestones, and updates.

### 5. NotebookLM (if configured)

Query for project context:
```bash
cd .claude/skills/google && python3 scripts/run.py ask_question.py --question "What are the current project milestones and status?" --notebook-url "URL"
```

### 6. GitHub (if `projectStatus.githubRepos` configured)

GitHub data is collected automatically by the pipeline and written to `github.md`. It includes:
- Open/merged/stale PRs with cycle time metrics
- Open/closed issues grouped by label
- CI/CD workflow run status (pass/fail rates)

When synthesizing, incorporate GitHub signals into:
- **Platform summary**: PR velocity, CI health
- **Sprint report**: PRs merged, code review throughput
- **Risks & blockers**: Stale PRs, failing CI, open bug issues

## Health Assessment

Score the project as *Green*, *Yellow*, or *Red* based on:

| Signal | Green | Yellow | Red |
|--------|-------|--------|-----|
| Sprint completion | >70% on track | 50-70% | <50% |
| Critical blockers | 0 | 1-2 | 3+ |
| Overdue items | 0 | 1-3 | 4+ |
| Documentation | Updated this week | Updated this month | Stale (>30d) |
| Slack signals | Normal activity | Some escalation keywords | Frequent blockers/escalations |
| CI/CD (if GitHub) | All passing | Some failures | Persistent failures |
| PR health (if GitHub) | No stale PRs | 1-2 stale | 3+ stale or long cycle time |

## Output Format

Output your report using `[STATUS_SECTION:name]` tags. Each tag becomes a separate Slack message in the thread.

**IMPORTANT:** Output ALL sections wrapped in tags. Any text outside tags becomes the intro message.

If `projectStatus.reportSections` is configured, only include those sections. Otherwise include all 5.

### Section 1: Executive Summary
```
[STATUS_SECTION:executive_summary]
:bar_chart: *Project Status — {date}*

*Overall Health:* :large_green_circle: Green / :large_yellow_circle: Yellow / :red_circle: Red

*Key Highlights:*
• [Top milestone or achievement]
• [Second highlight]

*Critical Blockers:*
• [Blocker 1 — owner, impact]
• None :white_check_mark:

*What's Next:*
• [Next major milestone or deliverable]
[/STATUS_SECTION]
```

### Section 2: Platform Summary
```
[STATUS_SECTION:platform_summary]
:mag: *Source Health Signals*

*Jira:*
• Sprint: {X} of {Y} items completed ({Z}%)
• {N} items in progress, {M} blocked
• Velocity trend: [stable/improving/declining]

*Confluence:*
• {N} pages updated this week
• Key updates: [page names]

*Slack:*
• Key topics: [from memory]
• Recent decisions: [from context]

*Google Docs:*
• [Summary of doc status]
[/STATUS_SECTION]
```

### Section 3: Low-Level Updates
```
[STATUS_SECTION:low_level_updates]
:clipboard: *Detailed Updates*

*Focus This Week:*
• [Current sprint goal or focus area]
• [Key deliverable in progress]

*Completed Last Week:*
• [Item 1 — owner]
• [Item 2 — owner]
(max 6 items)

*Upcoming This Week:*
• [Item 1 — owner, due date]
• [Item 2 — owner, due date]
(max 6 items)

*Platform Updates:*
• [Any infrastructure, tooling, or process changes]
[/STATUS_SECTION]
```

### Section 4: Sprint Report
```
[STATUS_SECTION:sprint_report]
:dart: *Sprint Report*

*Sprint:* {Sprint Name}
*Goal:* {Sprint goal if available}

*Progress:*
• Committed: {X} points / {Y} items
• Completed: {A} points / {B} items ({Z}%)
• In Progress: {C} items
• Not Started: {D} items

*Carry-Over from Last Sprint:*
• [Item — reason]

*Key Metrics:*
• Cycle time: {avg days}
• Blocked items: {count}
[/STATUS_SECTION]
```

### Section 5: Risks & Blockers
```
[STATUS_SECTION:risk_blockers]
:warning: *Risks & Blockers*

*Active Blockers:*
1. *{Blocker title}* — {owner} — Impact: {High/Medium/Low}
   Mitigation: {action being taken}

*Risk Register:*
| Risk | Likelihood | Impact | Status |
• {Risk 1} — {L} x {I} — {Monitoring/Mitigating/Escalated}

*Overdue Items:*
• {Item} — due {date} — {owner}

*Trends:*
• [Improving/stable/declining signals]
[/STATUS_SECTION]
```

## Trend Analysis

If a `trends.md` file exists in the report folder, it contains executive summaries from previous reports. Use these to:
- Identify improving, stable, or declining trends per metric
- Note velocity changes (sprint completion trending up/down)
- Flag recurring blockers that appear in multiple reports
- Mention trend direction in the executive summary and risk sections

## Custom Context

If `projectStatus.customContext` is set in config, use it to focus the synthesis:
- Example: "Focus on Record OTT platform delivery" → emphasize OTT-related items in all sections

## Bot Commands

Users can manage status reports with these commands (handled by the bot, not you):
- `@bot status now` — Generate a report immediately
- `@bot status enable weekly monday 9am` — Schedule automatic reports
- `@bot status disable` — Stop scheduled reports
- `@bot status settings` — Show current schedule

## Formatting Reminders

- Use Slack mrkdwn: `*bold*` not `**bold**`, `<URL|label>` not `[label](URL)`
- Use `•` for bullet points
- Keep each section under 3500 characters (Slack block limit)
- Use emojis sparingly for visual structure
