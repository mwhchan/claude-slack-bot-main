import { log } from "../utils/log.js";
import type { CanvasInfo } from "../types/index.js";

// Extract Canvas IDs from message text and file attachments
// Canvas URLs look like: https://app.slack.com/docs/TXXXXXXXX/FXXXXXXXX or https://WORKSPACE.slack.com/docs/FXXXXXXXX
export function extractCanvasIds(text: string, files?: any[]): string[] {
	const canvasIds: string[] = [];

	log.verbose(`[Canvas] extractCanvasIds input: "${text.substring(0, 300)}"`);

	// Pattern 1: Canvas URLs like https://app.slack.com/docs/TXXXXXX/FXXXXXXXX
	// Matches both app.slack.com and workspace.slack.com formats with team ID
	const canvasUrlPattern1 = /slack\.com\/docs\/[A-Z0-9]+\/([A-Z][A-Z0-9]+)/gi;
	let match;
	let matchCount = 0;
	while ((match = canvasUrlPattern1.exec(text)) !== null) {
		matchCount++;
		const captured = match[1].toUpperCase();
		log.verbose(`[Canvas] Pattern1 match ${matchCount}: "${match[0]}" -> captured: "${captured}"`);
		if (captured.startsWith('F') && !canvasIds.includes(captured)) {
			log.verbose(`[Canvas] Extracted ID from URL: ${captured}`);
			canvasIds.push(captured);
		} else if (!captured.startsWith('F')) {
			log.verbose(`[Canvas] Skipped - doesn't start with F: ${captured}`);
		}
	}
	if (matchCount === 0) {
		log.verbose(`[Canvas] Pattern1 no matches`);
	}

	// Pattern 2: Canvas URLs like https://WORKSPACE.slack.com/docs/FXXXXXXXX (without team ID)
	const canvasUrlPattern2 = /slack\.com\/docs\/([F][A-Z0-9]+)/gi;
	while ((match = canvasUrlPattern2.exec(text)) !== null) {
		const captured = match[1].toUpperCase();
		if (!canvasIds.includes(captured)) {
			log.verbose(`[Canvas] Extracted ID from short URL: ${captured}`);
			canvasIds.push(captured);
		}
	}

	// Pattern 3: Canvas file attachments (filetype: "quip" or mode: "quip")
	if (files && Array.isArray(files)) {
		for (const file of files) {
			if ((file.filetype === 'quip' || file.mode === 'quip') && file.id && !canvasIds.includes(file.id)) {
				log.verbose(`[Canvas] Extracted ID from file attachment: ${file.id}`);
				canvasIds.push(file.id);
			}
		}
	}

	if (canvasIds.length === 0 && text.includes('slack.com/docs')) {
		log.verbose(`[Canvas] URL contains slack.com/docs but no canvas ID extracted. Text: "${text.substring(0, 200)}"`);
	}

	return canvasIds;
}

// Convert HTML to plain text/markdown for Claude
function htmlToMarkdown(htmlContent: string): string {
	return htmlContent
		// Remove style and script tags
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		// Convert headers
		.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
		.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
		.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
		// Convert lists
		.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
		.replace(/<\/ul>/gi, '\n')
		.replace(/<\/ol>/gi, '\n')
		// Convert paragraphs and divs
		.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
		.replace(/<div[^>]*>(.*?)<\/div>/gi, '$1\n')
		// Convert line breaks
		.replace(/<br\s*\/?>/gi, '\n')
		// Convert bold and italic
		.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '*$2*')
		.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '_$2_')
		// Convert links
		.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
		// Convert code blocks
		.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '\n```\n$1\n```\n')
		.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
		// Remove remaining HTML tags
		.replace(/<[^>]+>/g, '')
		// Decode HTML entities
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		// Clean up whitespace
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// Fetch canvas content using Slack API
export async function fetchCanvasContent(client: any, canvasId: string, botToken: string): Promise<CanvasInfo | null> {
	try {
		// Get file info for the canvas
		const result = await client.files.info({ file: canvasId });
		if (!result.ok || !result.file) {
			log.warn(`[Canvas] Could not get info for canvas ${canvasId}`);
			return null;
		}

		const file = result.file;

		// Verify it's a canvas (quip type)
		if (file.filetype !== 'quip' && file.mode !== 'quip') {
			log.verbose(`[Canvas] File ${canvasId} is not a canvas (filetype: ${file.filetype}, mode: ${file.mode})`);
			return null;
		}

		const title = file.title || file.name || 'Untitled Canvas';
		const permalink = file.permalink;

		// Try to get content via url_private_download (returns HTML)
		const downloadUrl = file.url_private_download || file.url_private;
		if (!downloadUrl) {
			log.warn(`[Canvas] No download URL for canvas ${canvasId}`);
			return {
				id: canvasId,
				title,
				content: `[Canvas: ${title}]\n(Content could not be retrieved - no download URL available)`,
				permalink
			};
		}

		// Download canvas content with bot token auth
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

		try {
			const response = await fetch(downloadUrl, {
				headers: {
					'Authorization': `Bearer ${botToken}`
				},
				signal: controller.signal
			});

			clearTimeout(timeout);

			if (!response.ok) {
				log.warn(`[Canvas] Failed to download canvas ${canvasId}: ${response.status}`);
				return {
					id: canvasId,
					title,
					content: `[Canvas: ${title}]\n(Content could not be retrieved - HTTP ${response.status})`,
					permalink
				};
			}

			const htmlContent = await response.text();
			const textContent = htmlToMarkdown(htmlContent);

			log.info(`[Canvas] Fetched: "${title}" (${textContent.length} chars)`);

			return {
				id: canvasId,
				title,
				content: textContent,
				permalink
			};
		} catch (fetchError: any) {
			clearTimeout(timeout);
			if (fetchError.name === 'AbortError') {
				log.warn(`[Canvas] Download timeout for canvas ${canvasId}`);
			} else {
				log.error(`[Canvas] Fetch error for ${canvasId}: ${fetchError.message}`);
			}
			return {
				id: canvasId,
				title,
				content: `[Canvas: ${title}]\n(Content could not be retrieved - ${fetchError.name === 'AbortError' ? 'timeout' : 'fetch error'})`,
				permalink
			};
		}
	} catch (error: any) {
		log.error(`[Canvas] Error fetching canvas ${canvasId}: ${error?.message}`);
		return null;
	}
}

// Get all canvas IDs attached to a channel (supports multiple canvas tabs)
export async function getChannelCanvasIds(client: any, channelId: string): Promise<string[]> {
	const canvasIds: string[] = [];

	try {
		// Skip for DM channels (start with D)
		if (channelId.startsWith('D')) {
			return canvasIds;
		}

		const result = await client.conversations.info({ channel: channelId });
		if (!result.ok || !result.channel) {
			log.verbose(`[Canvas] conversations.info failed for ${channelId}`);
			return canvasIds;
		}

		// Channel canvases can be in properties.tabs[] with type "canvas"
		const tabs = result.channel?.properties?.tabs;
		if (Array.isArray(tabs)) {
			for (const tab of tabs) {
				if (tab.type === 'canvas' && tab.data?.file_id) {
					const fileId = tab.data.file_id;
					if (!canvasIds.includes(fileId)) {
						log.verbose(`[Canvas] Found channel canvas in tabs: ${fileId}`);
						canvasIds.push(fileId);
					}
				}
			}
		}

		// Also check properties.canvas.file_id (older format) - add if not already found
		const canvasFileId = result.channel?.properties?.canvas?.file_id;
		if (canvasFileId && !canvasIds.includes(canvasFileId)) {
			log.verbose(`[Canvas] Found channel canvas (legacy format): ${canvasFileId}`);
			canvasIds.push(canvasFileId);
		}

		if (canvasIds.length === 0) {
			log.verbose(`[Canvas] No canvas attached to channel ${channelId}`);
		} else {
			log.verbose(`[Canvas] Found ${canvasIds.length} canvas(es) attached to channel ${channelId}`);
		}

		return canvasIds;
	} catch (error: any) {
		log.verbose(`[Canvas] Could not get channel canvases for ${channelId}: ${error?.message}`);
		return canvasIds;
	}
}

// Fetch all canvases from a message (in parallel), including the channel's canvas if it exists
export async function fetchCanvases(
	client: any,
	text: string,
	botToken: string,
	files?: any[],
	channelId?: string,
	includeChannelCanvas: boolean = false
): Promise<CanvasInfo[]> {
	log.verbose(`[Canvas] fetchCanvases called - text length: ${text.length}, hasFiles: ${!!(files?.length)}, channelId: ${channelId}, includeChannelCanvas: ${includeChannelCanvas}`);

	const canvasIds = extractCanvasIds(text, files);
	log.verbose(`[Canvas] extractCanvasIds returned: ${canvasIds.length} IDs: [${canvasIds.join(', ')}]`);

	// Optionally include all channel canvases (supports multiple canvas tabs)
	if (includeChannelCanvas && channelId) {
		const channelCanvasIds = await getChannelCanvasIds(client, channelId);
		for (const channelCanvasId of channelCanvasIds) {
			if (!canvasIds.includes(channelCanvasId)) {
				log.verbose(`[Canvas] Including channel canvas: ${channelCanvasId}`);
				canvasIds.unshift(channelCanvasId); // Add channel canvases first
			}
		}
	}

	if (canvasIds.length === 0) return [];

	log.verbose(`[Canvas] Found ${canvasIds.length} canvas(es) to fetch`);

	// Fetch canvases in parallel
	const results = await Promise.allSettled(
		canvasIds.map(canvasId => fetchCanvasContent(client, canvasId, botToken))
	);

	// Filter successful fetches
	const canvases: CanvasInfo[] = [];
	for (const result of results) {
		if (result.status === 'fulfilled' && result.value) {
			canvases.push(result.value);
		}
	}

	return canvases;
}
