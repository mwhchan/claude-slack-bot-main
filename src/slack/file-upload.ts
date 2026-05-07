import { existsSync, lstatSync, statSync, createReadStream } from "fs";
import { basename, resolve as pathResolve } from "path";
import { log } from "../utils/log.js";
import { ROOT_DIR } from "../config/paths.js";
import { broadcastMonitorEvent } from "../monitor/websocket.js";

// Pattern for file upload tags: [FILE_UPLOAD:/path/to/file.ext]
const FILE_UPLOAD_PATTERN = /\[FILE_UPLOAD:([^\]]+)\]/g;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Process [FILE_UPLOAD:path] tags in response text.
 * Uploads each referenced file to the Slack thread and strips tags from the response.
 */
export async function processFileUploadTags(
	response: string,
	channelId: string,
	threadTs: string,
	client: any
): Promise<string> {
	let cleanedResponse = response;

	FILE_UPLOAD_PATTERN.lastIndex = 0;
	const matches = [...response.matchAll(FILE_UPLOAD_PATTERN)];

	if (matches.length === 0) {
		return response;
	}

	for (const match of matches) {
		const [fullMatch, rawPath] = match;
		const filePath = rawPath.trim();

		// Security: resolve to absolute and ensure it's under ROOT_DIR
		const resolvedPath = pathResolve(filePath);
		const resolvedRoot = pathResolve(ROOT_DIR);

		if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
			log.warn(`[FileUpload] Path outside ROOT_DIR, skipping: ${filePath}`);
			cleanedResponse = cleanedResponse.replace(fullMatch, "");
			continue;
		}

		// Check file exists
		if (!existsSync(resolvedPath)) {
			log.warn(`[FileUpload] File not found, skipping: ${resolvedPath}`);
			cleanedResponse = cleanedResponse.replace(fullMatch, "");
			continue;
		}

		// Reject symlinks
		const lstats = lstatSync(resolvedPath);
		if (lstats.isSymbolicLink()) {
			log.warn(`[FileUpload] Symlink rejected, skipping: ${resolvedPath}`);
			cleanedResponse = cleanedResponse.replace(fullMatch, "");
			continue;
		}

		// Check file size
		const stats = statSync(resolvedPath);
		if (stats.size > MAX_FILE_SIZE) {
			log.warn(`[FileUpload] File too large (${stats.size} bytes), skipping: ${resolvedPath}`);
			cleanedResponse = cleanedResponse.replace(fullMatch, "");
			continue;
		}

		// Upload to Slack
		try {
			const filename = basename(resolvedPath);
			const result = await client.filesUploadV2({
				channel_id: channelId,
				file: createReadStream(resolvedPath),
				filename,
				thread_ts: threadTs,
			});

			// Get file message timestamp for monitor deletion support
			let fileMessageTs: string | undefined;
			try {
				const fileId = (result as any)?.files?.[0]?.id;
				if (fileId) {
					const fileInfo = await client.files.info({ file: fileId });
					const shares = fileInfo?.file?.shares;
					const channelShares = shares?.public?.[channelId] || shares?.private?.[channelId];
					fileMessageTs = channelShares?.[0]?.ts;
				}
			} catch {
				// Best effort — if we can't get ts, file won't be deletable from monitor
			}

			const msgRef = fileMessageTs ? ` {${channelId}:${fileMessageTs}}` : "";
			log.info(`[FileUpload] Uploaded ${filename}${msgRef}`);

			if (fileMessageTs) {
				broadcastMonitorEvent("aiReply", { channel: channelId, messageTs: fileMessageTs });
			}
		} catch (error: any) {
			log.error(`[FileUpload] Upload failed for ${resolvedPath}: ${error?.message || error}`);
		}

		// Strip tag from response regardless of upload success
		cleanedResponse = cleanedResponse.replace(fullMatch, "");
	}

	// Clean up extra newlines left by tag removal
	cleanedResponse = cleanedResponse.replace(/\n{3,}/g, "\n\n").trim();

	return cleanedResponse;
}
