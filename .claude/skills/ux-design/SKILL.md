---
name: ux-design
description: Generate UX/UI designs using Google Stitch. Use this skill when the user asks to design a UI, create a mockup, wireframe, app screen, or UX layout. Triggers on "design a page", "create a mockup", "wireframe", "UI design", "UX layout", "app screen design", "design me a", "stitch design". Also triggers when a user uploads an image and asks to redesign, improve, or recreate it.
---

# UX Design Generation (Google Stitch)

Generate UI/UX designs from text descriptions using Google Stitch (stitch.withgoogle.com). The user's Slack message contains the design requirements — extract the description and pass it as the prompt.

## How It Works

1. User describes what they want designed in their Slack message
2. You extract the design description from their message
3. If the user attached an image (screenshot, wireframe, existing UI), download it as a reference
4. Google Stitch generates the UI/UX design via browser automation
5. The full-resolution design image is uploaded to Slack

## Step 1: Check Google Authentication

```bash
cd .claude/skills/google && python3 scripts/run.py auth_manager.py status
```

If not authenticated, tell the user:
> Google authentication is required. Please run the auth setup first — I'll need someone to log in via the browser.

Then run:
```bash
cd .claude/skills/google && python3 scripts/run.py auth_manager.py setup --service drive
```

## Step 2: Extract Design Description

From the user's Slack message, extract:
- **What to design** — the main UI/app/page description
- **Format** — "web" (default) or "mobile" (if user mentions mobile, phone, app, iOS, Android)
- **Reference image** — if the user attached an image file, it will be available as a downloaded file path in the context

If the user uploaded a reference image (screenshot, wireframe, existing design) and wants it redesigned/improved, compose the prompt to describe the desired changes (e.g., "Redesign this login screen with a dark theme and modern look").

Compose a clear, detailed prompt from their message. If the user is vague, fill in reasonable UX defaults (e.g., "clean, modern design with clear hierarchy").

## Step 3: Generate the Design

**Without reference image:**
```bash
cd .claude/skills/google && python3 scripts/run.py stitch_manager.py generate \
  --prompt "{design_description}" \
  --output {output_path} \
  --format {web|mobile}
```

**With reference image (redesign):**
```bash
cd .claude/skills/google && python3 scripts/run.py stitch_manager.py generate \
  --prompt "{design_description}" \
  --output {output_path} \
  --format {web|mobile} \
  --reference-image {image_path}
```

**Variable substitution:**
- `{design_description}` — the extracted/composed prompt from the user's message
- `{output_path}` — absolute path to `data/downloads/design-{timestamp}.png` in the project root
- `{web|mobile}` — "web" (default) or "mobile"
- `{image_path}` — absolute path to the downloaded reference image (from Slack file attachment)

Set a 700s timeout (generation can take several minutes).

## Step 4: Deliver the Result

Check the JSON output from stitch_manager.py:

**On success:**
```
[FILE_UPLOAD:{output_path}]Here's the UX design based on your description!
```

**On error (auth expired):**
Tell the user authentication needs to be refreshed and run auth setup.

**On error (other):**
Report what went wrong. If a debug screenshot was captured, upload it for context.

## Step 5: Refinement (if user asks for changes)

If the user wants modifications, run the generate command again with an updated prompt that incorporates their feedback. Each generation is independent — include the full design description plus the changes.

## Important Notes

- **NEVER** show local file paths to the user — always use `[FILE_UPLOAD:path]`
- Runs in headless mode by default (no browser window needed)
- The script downloads the full-resolution design image directly from Google's CDN
- Generation takes ~1-3 minutes typically, but can take longer
- Successful generation redirects to `https://stitch.withgoogle.com/projects/{id}` — the script detects this URL change
- Reference images support: PNG, JPEG, GIF, WebP formats
- If Stitch UI changes and selectors break, run the debug script: `python3 scripts/run.py stitch_debug.py`
