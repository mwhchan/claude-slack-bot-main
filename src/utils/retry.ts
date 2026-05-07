import { log } from "./log.js";

interface RetryOptions {
	attempts?: number;        // Max attempts (default: 3)
	minDelayMs?: number;      // Initial delay (default: 500)
	maxDelayMs?: number;      // Max delay cap (default: 30000)
	jitter?: number;          // Random jitter factor 0-1 (default: 0.2)
	shouldRetry?: (error: any) => boolean;  // Custom retry predicate
}

// Default: retry on Slack rate limit errors (429) and temporary server errors (5xx)
function defaultShouldRetry(error: any): boolean {
	const code = error?.code;
	const statusCode = error?.status || error?.statusCode || error?.data?.status;

	// Slack rate limit
	if (code === "slack_webapi_platform_error" && error?.data?.error === "ratelimited") return true;
	if (statusCode === 429) return true;

	// Temporary server errors
	if (statusCode >= 500 && statusCode < 600) return true;

	// Network errors
	if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return true;

	return false;
}

// Extract Retry-After hint from error (Slack provides this on 429s)
function getRetryAfterMs(error: any): number | null {
	const retryAfter = error?.headers?.["retry-after"] || error?.data?.headers?.["retry-after"];
	if (retryAfter) {
		const seconds = parseFloat(retryAfter);
		if (!isNaN(seconds)) return seconds * 1000;
	}
	return null;
}

/**
 * Retry an async function with exponential backoff and jitter.
 * Respects Retry-After headers from Slack rate limits.
 */
export async function retryAsync<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {}
): Promise<T> {
	const {
		attempts = 3,
		minDelayMs = 500,
		maxDelayMs = 30000,
		jitter = 0.2,
		shouldRetry = defaultShouldRetry,
	} = options;

	let lastError: any;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await fn();
		} catch (error: any) {
			lastError = error;

			if (attempt >= attempts || !shouldRetry(error)) {
				throw error;
			}

			// Calculate delay: exponential backoff with jitter
			const retryAfter = getRetryAfterMs(error);
			const exponentialDelay = Math.min(minDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
			const baseDelay = retryAfter ?? exponentialDelay;
			const jitterAmount = baseDelay * jitter * (Math.random() * 2 - 1); // +/- jitter%
			const delay = Math.max(0, Math.round(baseDelay + jitterAmount));

			log.debug(`[Retry] Attempt ${attempt}/${attempts} failed, retrying in ${delay}ms: ${error?.message || error}`);
			await new Promise((r) => setTimeout(r, delay));
		}
	}

	throw lastError;
}
