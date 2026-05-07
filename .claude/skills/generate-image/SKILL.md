---
name: generate-image
description: Generate images using Codex CLI. Use this skill when the user asks to create, generate, or draw an image, illustration, poster, piece of art, design, or other visual piece. Create original visual designs, never copying existing artists' work to avoid copyright violations.
license: Complete terms in LICENSE.txt
---

## How It Works

1. Write a clear prompt describing what the user wants
2. Send it to Codex CLI
3. Deliver the generated .png image to Slack

---

## Step 1: Write the Codex Prompt

Write a concise, descriptive prompt to `/tmp/generate-image-prompt.md` based on the user's request. Include:

1. **What to generate** — describe the image clearly
2. **Output path** — save to `{output_path}` (absolute path to the project's `data/downloads/` directory) as PNG
3. **"Do NOT ask any questions. Just generate the image."**

Keep the prompt focused. Match the level of detail to the request — a simple request gets a simple prompt, a detailed request gets a detailed prompt.

## Step 2: Execute Codex CLI

```bash
cat /tmp/generate-image-prompt.md | codex exec --full-auto -c model="gpt-5.3-codex" -C "{project_root}" -
```

**Variable substitution:**
- `{project_root}` = the project root directory (e.g., `/Users/accedo/Workspace/claude-slack-bot`)
- `{output_path}` = absolute path to `data/downloads/` in the project

Set a 600s timeout. After Codex completes:

**Capture the session ID** from the output (look for `session id: <UUID>`) for the passthrough and feedback loops. **NEVER show the session ID to the user** — store it silently.

Check the result:
- **Image produced** → deliver it (Step 3)
- **No image / Codex asked a question** → use CODEX PASSTHROUGH (see below)

## Step 3: Deliver

Upload the image to Slack:
```
[FILE_UPLOAD:/absolute/path/to/image.png]Here's your image!
```

**NEVER** tell the user a local file path. Always use the `[FILE_UPLOAD:path]` tag.

---

## CODEX PASSTHROUGH

If Codex does not produce an image and instead outputs questions, requests, or options — **forward them to the user verbatim**. Do not answer on the user's behalf. Do not assume or pre-decide.

1. **Read Codex output** — look for any questions or clarification requests
2. **Forward to the user exactly as Codex asked** — relay word-for-word to the Slack thread
3. **Wait for the user's reply**
4. **Resume the Codex session** with the user's answer:

```bash
codex exec resume --full-auto -c model="gpt-5.3-codex" {session_id} "{user_answer}"
```

5. **Check again** — image produced? Deliver it. Another question? Repeat the passthrough.
6. **Loop until done**

**Important:**
- Never reword or answer Codex's questions yourself — pass them through raw
- Always include the session ID to maintain continuity
- Fallback: `codex exec resume --full-auto -c model="gpt-5.3-codex" --last "{user_answer}"`

---

## FEEDBACK & REFINEMENT LOOP

When the user replies with feedback on the generated image (e.g., "make it darker", "add more detail"), resume the Codex session.

1. **Resume the session:**
```bash
codex exec resume --full-auto -c model="gpt-5.3-codex" {session_id} "User feedback: {user_feedback}. Update the image at {output_path} with these changes. Overwrite the existing file. Do NOT ask questions — just apply the changes."
```

2. **Fallback** (session ID lost):
```bash
codex exec resume --full-auto -c model="gpt-5.3-codex" --last "User feedback: {user_feedback}. Update the image at {output_path}. Overwrite the existing file."
```

3. **Upload the updated image:**
```
[FILE_UPLOAD:{output_path}]Here's the updated version.
```

4. **Multiple rounds** — each `resume` carries full session history. The `-i` flag can attach the current image for visual reference: `codex exec resume --full-auto -c model="gpt-5.3-codex" {session_id} -i {output_path} "feedback"`
