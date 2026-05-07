import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "../utils/log.js";
import { SLACK_FILES_DIR } from "../config/paths.js";
import type { SlackFileInfo, DownloadedFile } from "../types/index.js";

// File types that Claude Code can read via the Read tool
const SUPPORTED_FILE_TYPES = new Set([
	// Documents
	'pdf', 'txt', 'text', 'md', 'markdown',
	// Code/config (text-based)
	'json', 'xml', 'yaml', 'yml', 'csv', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx',
	'py', 'java', 'c', 'cpp', 'h', 'hpp', 'swift', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'sql', 'kt', 'scala',
	// Images (Claude is multimodal)
	'png', 'jpg', 'jpeg', 'gif', 'webp',
	// Jupyter notebooks
	'ipynb',
]);

// Max file size to download (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Extract Slack file IDs from message text and file attachments
export function extractSlackFileIds(text: string, files?: any[]): string[] {
	const fileIds: string[] = [];

	// Pattern 1: Slack file URLs like <https://xxxxx.slack.com/files/USER/FILE_ID/filename>
	// More permissive pattern to handle various ID formats
	const urlPattern = /slack\.com\/files\/[A-Za-z0-9_]+\/([A-Za-z0-9_]+)/gi;
	let match;
	while ((match = urlPattern.exec(text)) !== null) {
		if (match[1] && !fileIds.includes(match[1])) {
			fileIds.push(match[1]);
		}
	}

	// Pattern 2: Direct file attachments in message
	if (files && Array.isArray(files)) {
		for (const file of files) {
			if (file.id && !fileIds.includes(file.id)) {
				fileIds.push(file.id);
			}
		}
	}

	return fileIds;
}

// Download a Slack file using the bot token
export async function downloadSlackFile(client: any, fileId: string, botToken: string): Promise<DownloadedFile | null> {
	try {
		// Get file info
		const result = await client.files.info({ file: fileId });
		if (!result.ok || !result.file) {
			log.warn(`[Slack Files] Could not get info for file ${fileId}`);
			return null;
		}

		const fileInfo: SlackFileInfo = result.file;

		// Check file type - skip unsupported types
		const fileExt = (fileInfo.filetype || fileInfo.name?.split('.').pop() || '').toLowerCase();
		if (!SUPPORTED_FILE_TYPES.has(fileExt)) {
			log.debug(`[Slack Files] Skipping unsupported file type: ${fileInfo.name} (${fileExt})`);
			return null;
		}

		// Check file size
		const fileSize = (result.file as any).size || 0;
		if (fileSize > MAX_FILE_SIZE) {
			log.warn(`[Slack Files] File too large: ${fileInfo.name} (${Math.round(fileSize / 1024 / 1024)}MB > 50MB limit)`);
			return null;
		}

		const downloadUrl = fileInfo.url_private_download || fileInfo.url_private;
		if (!downloadUrl) {
			log.warn(`[Slack Files] No download URL for file ${fileId}`);
			return null;
		}

		// Download file with bot token auth and timeout
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

		try {
			const response = await fetch(downloadUrl, {
				headers: {
					'Authorization': `Bearer ${botToken}`
				},
				signal: controller.signal
			});

			clearTimeout(timeout);

			if (!response.ok) {
				log.warn(`[Slack Files] Failed to download file ${fileId}: ${response.status}`);
				return null;
			}

			// Save to local file
			const buffer = Buffer.from(await response.arrayBuffer());
			const safeFilename = fileInfo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
			const localPath = pathResolve(SLACK_FILES_DIR, `${fileId}_${safeFilename}`);
			writeFileSync(localPath, buffer);

			log.info(`[Slack Files] Downloaded: ${fileInfo.name} (${fileInfo.filetype}) -> ${localPath}`);

			return {
				id: fileId,
				name: fileInfo.name,
				localPath,
				mimetype: fileInfo.mimetype
			};
		} catch (fetchError: any) {
			clearTimeout(timeout);
			if (fetchError.name === 'AbortError') {
				log.warn(`[Slack Files] Download timeout for file ${fileId}`);
			} else {
				throw fetchError;
			}
			return null;
		}
	} catch (error: any) {
		log.error(`[Slack Files] Error downloading file ${fileId}: ${error?.message}`);
		return null;
	}
}

// Download all Slack files from a message (in parallel)
export async function downloadSlackFiles(client: any, text: string, botToken: string, files?: any[]): Promise<DownloadedFile[]> {
	const fileIds = extractSlackFileIds(text, files);
	if (fileIds.length === 0) return [];

	log.debug(`[Slack Files] Found ${fileIds.length} file(s) to download`);

	// Download files in parallel
	const results = await Promise.allSettled(
		fileIds.map(fileId => downloadSlackFile(client, fileId, botToken))
	);

	// Filter successful downloads
	const downloadedFiles: DownloadedFile[] = [];
	for (const result of results) {
		if (result.status === 'fulfilled' && result.value) {
			downloadedFiles.push(result.value);
		}
	}

	return downloadedFiles;
}

// Clean up old Slack files (older than 1 hour)
export function cleanupOldSlackFiles(): void {
	try {
		if (!existsSync(SLACK_FILES_DIR)) return;
		const files = readdirSync(SLACK_FILES_DIR);
		const oneHourAgo = Date.now() - (60 * 60 * 1000);
		let cleaned = 0;

		for (const file of files) {
			const filePath = pathResolve(SLACK_FILES_DIR, file);
			try {
				const stats = statSync(filePath);
				if (stats.mtimeMs < oneHourAgo) {
					unlinkSync(filePath);
					cleaned++;
				}
			} catch {
				// Ignore errors for individual files
			}
		}

		if (cleaned > 0) {
			log.debug(`[Slack Files] Cleaned up ${cleaned} old file(s)`);
		}
	} catch {
		// Ignore cleanup errors
	}
}

// Start periodic cleanup (call this once at app startup)
export function startFileCleanupInterval(): void {
	// Run cleanup periodically (every 30 minutes)
	setInterval(cleanupOldSlackFiles, 30 * 60 * 1000);
}
