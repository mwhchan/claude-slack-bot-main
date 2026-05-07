---
name: google
description: Access Google services (NotebookLM + Drive) with shared authentication. Query notebooks for source-grounded answers, browse and read Drive files.
---

# Google Skills (NotebookLM + Drive)

Combined skill for Google services with **shared authentication** - log in once, access both services.

## When to Use This Skill

**NotebookLM** - Trigger when user:
- Mentions NotebookLM explicitly
- Shares NotebookLM URL (`https://notebooklm.google.com/notebook/...`)
- Asks to query their notebooks/documentation
- Uses phrases like "ask my NotebookLM", "check my docs", "query my notebook"

**Google Drive** - Trigger when user:
- Asks about files, documents, or mentions Google Drive
- Shares a Google Drive, Docs, or Sheets URL
- Wants to list, search, or read Drive files

## Critical: Always Use run.py Wrapper

**NEVER call scripts directly. ALWAYS use `python3 scripts/run.py [script]`:**

```bash
# CORRECT:
python3 scripts/run.py auth_manager.py status
python3 scripts/run.py notebook_manager.py list
python3 scripts/run.py drive_manager.py list

# WRONG:
python3 scripts/auth_manager.py status  # Fails without venv!
```

## Shared Authentication

Both services share the same Google authentication:

```bash
# Check auth status
python3 scripts/run.py auth_manager.py status

# Setup auth (opens browser for Google login)
python3 scripts/run.py auth_manager.py setup

# Validate auth works
python3 scripts/run.py auth_manager.py validate --service drive
python3 scripts/run.py auth_manager.py validate --service notebooklm
```

---

# NotebookLM Features

Query Google NotebookLM for source-grounded, citation-backed answers.

### Notebook Management

```bash
# List all notebooks
python3 scripts/run.py notebook_manager.py list

# Add notebook (discover content first)
python3 scripts/run.py ask_question.py --question "What is this notebook about?" --notebook-url "[URL]"
python3 scripts/run.py notebook_manager.py add --url "[URL]" --name "Name" --description "Description" --topics "topic1,topic2"

# Search notebooks
python3 scripts/run.py notebook_manager.py search --query "keyword"

# Activate notebook
python3 scripts/run.py notebook_manager.py activate --id notebook-id
```

### Ask Questions

```bash
# Query active notebook
python3 scripts/run.py ask_question.py --question "Your question here"

# Query specific notebook
python3 scripts/run.py ask_question.py --question "..." --notebook-id notebook-id

# Query with URL directly
python3 scripts/run.py ask_question.py --question "..." --notebook-url "https://..."

# Show browser for debugging
python3 scripts/run.py ask_question.py --question "..." --show-browser
```

### Follow-Up Mechanism

Every NotebookLM answer ends with: **"Is that ALL you need to know?"**

Required behavior:
1. **STOP** - Don't immediately respond to user
2. **ANALYZE** - Compare answer to user's original request
3. **IDENTIFY GAPS** - Determine if more information needed
4. **ASK FOLLOW-UP** - If gaps exist, query again with context
5. **SYNTHESIZE** - Combine all answers before responding

---

# Google Drive Features

Browse, search, and read files from Google Drive.

### List & Search Files

```bash
# List root Drive folder
python3 scripts/run.py drive_manager.py list

# List specific folder
python3 scripts/run.py drive_manager.py list --folder-id FOLDER_ID

# Search files
python3 scripts/run.py drive_manager.py search --query "search term"
```

### Read File Content

```bash
# Read by file ID
python3 scripts/run.py get_file.py --file-id FILE_ID

# Read by URL (Docs, Sheets, etc.)
python3 scripts/run.py get_file.py --file-url "https://docs.google.com/..."

# Show browser for debugging
python3 scripts/run.py get_file.py --file-url "..." --show-browser
```

**Supported file types:**
- Google Docs - extracts text content
- Google Sheets - downloads as CSV (supports specific sheet tabs via gid parameter)
- Google Slides - downloads as plain text
- Text files - reads content from Drive preview

---

## Data Storage

All data stored in `~/Library/Application Support/claude-google-skills/`:
- `browser_state/state.json` - Browser cookies and session
- `chrome_profile/` - Persistent browser profile
- `library.json` - NotebookLM notebook metadata
- `auth_info.json` - Authentication status
- `downloads/` - Temporary file downloads

## Troubleshooting

| Problem | Solution |
|---------|----------|
| ModuleNotFoundError | Use `run.py` wrapper |
| Authentication fails | Browser must be visible: `--show-browser` |
| Session expired | Run `auth_manager.py setup` |
| Notebook not found | Check with `notebook_manager.py list` |

## Decision Flow

```
User request about Google service
    |
Check auth -> python3 scripts/run.py auth_manager.py status
    |
If not authenticated -> python3 scripts/run.py auth_manager.py setup
    |
+-- NotebookLM request?
|   -> Check/Add notebook -> python3 scripts/run.py notebook_manager.py list/add
|   -> Ask question -> python3 scripts/run.py ask_question.py --question "..."
|   -> Follow up if needed
|
+-- Drive request?
    -> List/Search -> python3 scripts/run.py drive_manager.py list/search
    -> Read file -> python3 scripts/run.py get_file.py --file-url "..."
```
