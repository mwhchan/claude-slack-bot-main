import { log } from "../utils/log.js";

// Interface for extracted unfurl content
export interface UnfurlContent {
	url: string;
	title?: string;
	text?: string;
	authorName?: string;
	serviceName?: string;
}

/**
 * Extract unfurl content from Slack message attachments.
 * When users share URLs, Slack automatically fetches previews (unfurls)
 * and includes them in the message.attachments field.
 */
export function extractUnfurlContent(attachments: any[] | undefined): UnfurlContent[] {
	if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
		return [];
	}

	const unfurls: UnfurlContent[] = [];

	for (const attachment of attachments) {
		// Skip non-unfurl attachments (e.g., file attachments have different structure)
		if (!attachment.from_url && !attachment.original_url) {
			continue;
		}

		const url = attachment.from_url || attachment.original_url || "";
		const title = attachment.title || attachment.author_name || "";
		const text = attachment.text || attachment.fallback || "";
		const authorName = attachment.author_name || "";
		const serviceName = attachment.service_name || "";

		// Only include if we have meaningful content
		if (url && (title || text)) {
			unfurls.push({
				url,
				title: title || undefined,
				text: text || undefined,
				authorName: authorName || undefined,
				serviceName: serviceName || undefined,
			});
			log.debug(`[Unfurl] Extracted: ${serviceName || "link"} - "${title || "(no title)"}"`);
		}
	}

	if (unfurls.length > 0) {
		log.info(`[Unfurl] Extracted ${unfurls.length} URL preview(s)`);
	}

	return unfurls;
}

/**
 * Format unfurl content for inclusion in Claude prompt.
 */
export function formatUnfurlsForPrompt(unfurls: UnfurlContent[]): string {
	if (unfurls.length === 0) {
		return "";
	}

	const sections = unfurls.map((unfurl) => {
		const parts: string[] = [];

		if (unfurl.serviceName) {
			parts.push(`Source: ${unfurl.serviceName}`);
		}
		parts.push(`URL: ${unfurl.url}`);
		if (unfurl.title) {
			parts.push(`Title: ${unfurl.title}`);
		}
		if (unfurl.authorName && unfurl.authorName !== unfurl.title) {
			parts.push(`Author: ${unfurl.authorName}`);
		}
		if (unfurl.text) {
			parts.push(`Content:\n${unfurl.text}`);
		}

		return parts.join("\n");
	});

	return `## URL Previews (Slack Unfurls)

The following URL preview content was automatically fetched by Slack:

${sections.join("\n\n---\n\n")}

`;
}
