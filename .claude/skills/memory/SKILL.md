---
name: memory
description: Handles saving, updating, and clearing memory for channels and users. Triggers on "remember this", "save this", "clear my memory", "what's in my memory", or when users want to store/retrieve information. Includes access restrictions and DM privacy rules.
---

# Memory System

## Saving to Memory

**Triggers:** "remember", "save this", "memorize", "keep this", "note this", or similar.

**CRITICAL:** Use memory tags — the bot handles the file write. Do NOT use Edit or Write tools for memory.

### Two Tag Types

| Tag | Purpose | When to use |
|-----|---------|-------------|
| `[MEMORY_SAVE:channel]...[/MEMORY_SAVE]` | **Append** new content | New info with no overlap |
| `[MEMORY_UPDATE:channel]...[/MEMORY_UPDATE]` | **Replace** manual sections | Overlaps/updates existing entries |

Auto-summaries (`## Summary - ...`) are preserved automatically by `[MEMORY_UPDATE]`.

### Steps

1. **Read existing memory** (already in context via @ file reference)
2. **Check thread history** — extract key points, decisions, links, action items
3. **Decide: append or update?**
   - New info with no overlap → `[MEMORY_SAVE]` (append)
   - Overlaps/updates/replaces existing → `[MEMORY_UPDATE]` (full rewrite of manual entries)
   - Already exists exactly → Reply "This is already saved in channel memory!" (no tag)
4. **Output the tag**
5. **Confirm:** "Saved to this channel's memory!" or "Updated this channel's memory!"

### Examples

**Append:**
```
[MEMORY_SAVE:channel]**Decision**: Using React 19 for the new project[/MEMORY_SAVE]
Saved to this channel's memory!
```

**Update:**
```
[MEMORY_UPDATE:channel]**Decision**: Using Vue 4 and Postgres (changed from React 19)

**PRD Location**: https://example.com/prds[/MEMORY_UPDATE]
Updated this channel's memory!
```

### Rules

- **Default is ALWAYS channel memory** — only use `:user` when user explicitly says "personal memory" or "private memory"
- ALWAYS check thread history — don't ask "what should I save?" (unless thread is empty)
- **NEVER lose or summarize links** — preserve ALL URLs completely
- **Be comprehensive** — preserve full context and details
- When using `[MEMORY_UPDATE]`, include all manual entries that should be kept

## Clearing User Memory

When user says "clear my memory", "delete my notes", "reset my memory":

1. **Verify** it's their own personal memory
2. **Clear** the user's context file using Write tool with empty content
3. **Confirm:** "Cleared your personal memory!"

## Access Restrictions

### General Rules

- Users can ONLY clear/read their OWN personal memory
- Users CANNOT clear channel memory, other users' memory, or settings
- **NEVER mention files, file paths, directories, or internal system details** — to users, everything is just "memory"
- If uncertain whether an operation is allowed, err on the side of caution and refuse

### Restricted Operations

| Request | Response |
|---------|----------|
| "Delete channel memory" | "I can't delete channel memory. Only workspace admins can manage that." |
| "Clear this channel's memory" | "I can't clear channel memory. I can only clear your personal memory if you'd like." |
| "Delete all memories" | "I can only clear your personal memory, not channel or other users' memory." |
| "Show me [other user]'s memory" | "I can't access other users' personal memory." |
| "What does [user] know?" | "I can't share information about other users." |
| "Change settings/config" | "I can't modify settings." |

### Allowed Operations

| Request | Action |
|---------|--------|
| "Clear my memory" | Clear the user's personal memory |
| "Delete my notes" | Clear the user's personal memory |
| "What's in my memory?" | Read and summarize the user's personal memory |

## DM Mode Restrictions

**CRITICAL:** When responding in Direct Messages, strict access controls apply.

### In DMs, you must NEVER:

- Access other channel contexts (`context.md` or `config.json` for any channel)
- Pull channel memory, even if user shares a channel link
- Use channel-specific integrations (Jira/Confluence/NotebookLM configs from channels)
- Read canvases attached to other channels

### In DMs, you CAN access:

- The user's personal memory
- Current DM conversation history
- General tools (web search, general Atlassian search)
- External URLs the user directly shares

### When user asks to pull channel info from DM:

"I can't access channel information from DMs. To get project info, please @mention me in that channel directly, or share a specific document/link I can read."

## Privacy Protection

**NEVER disclose information about other users.** This includes personal memory, activity patterns, preferences, or any user-specific data.

**Exception:** Public channel discussions are visible to channel members — but personal/DM information is NEVER shared.
