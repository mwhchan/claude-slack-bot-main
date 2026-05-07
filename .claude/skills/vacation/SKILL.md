---
name: vacation
description: Detect when users say they will be off, on PTO, on vacation, taking time off, or away and save it. Also handles listing who is on vacation and removing time off.
---

# Vacation Tracking Skill

Vacations are managed via the `vacation.py` script which reads/writes `vacations.md` per channel.

## Vacation Detection (CRITICAL - Act Immediately)

**When someone mentions time off, run the script IMMEDIATELY.**

### Trigger Phrases

- "I'll be off [date]" / "I'm off [date]"
- "I'll be on vacation [date]"
- "taking PTO [date]"
- "out of office [date]" / "OOO [date]"
- "I'll be away [date]"
- "[name] is off [date]"

### How to Save Vacation

Run:
```bash
python3 .claude/skills/vacation/scripts/vacation.py add \
  --channel {channel_id} \
  --name "Person Name" \
  --user-id U6GJSMG20 \
  --start 2026-02-13 \
  --end 2026-02-13 \
  --note "optional note"
```

Then add `[REACT:palm_tree]` in your response and confirm.

**DO NOT output `[VACATION_ADD:...]` tags. Use the script.**

### Date Conversion (Today is shown in context)

| Pattern | Interpretation |
|---------|---------------|
| "tomorrow" | Today + 1 day |
| "next week" | Monday-Friday of next week |
| "Monday" / "next Monday" | The upcoming Monday |
| "Jan 30" / "January 30" | That specific date |
| "Jan 27-31" | Range: Jan 27 to Jan 31 |

### Examples

**Message:** "I'll be off tomorrow" (today is 2026-02-12, user is Chen Ding, userId U6GJSMG20, channel C0A7U1W8WR4)
**Action:**
```bash
python3 .claude/skills/vacation/scripts/vacation.py add --channel C0A7U1W8WR4 --name "Chen Ding" --user-id U6GJSMG20 --start 2026-02-13 --end 2026-02-13
```
**Response:**
```
[REACT:palm_tree]Got it! Added your time off (Fri, Feb 13) to the vacation calendar.
```

## Checking Vacations

**Trigger:** "who's on vacation", "vacations this week", "who's off"

Run:
```bash
python3 .claude/skills/vacation/scripts/vacation.py list --channel {channel_id}
```

Format the output for Slack:
```
:palm_tree: *Vacations:*

• *John*: Mon, Jan 27 - Fri, Jan 31
• *Sarah*: Wed, Jan 29 _(doctor)_
```

If none: `:palm_tree: No one is on vacation!`

## Removing Vacations

**Trigger:** "cancel my time off", "remove vacation for [date]"

Run:
```bash
python3 .claude/skills/vacation/scripts/vacation.py remove \
  --channel {channel_id} \
  --name "Person Name" \
  --start 2026-02-13
```

## Config Commands (Handled by Bot)

These are handled directly by the bot, not by you:
- `@bot vacations now` - Post vacation info immediately
- `@bot vacations enable weekly monday 9am` - Enable broadcast
- `@bot vacations disable` - Disable broadcast
- `@bot vacations status` - Check settings

## Important Rules

1. **Use the script** - Always use `vacation.py` to add/remove/list
2. **Convert dates to YYYY-MM-DD** - Always use this format
3. **Include userId when available** - Extract from @mentions or context
4. **React with :palm_tree:** - Add `[REACT:palm_tree]` in your response
5. **NEVER output `[VACATION_ADD:...]` or `[VACATION_REMOVE:...]` tags**
