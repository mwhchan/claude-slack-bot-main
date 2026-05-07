import { log } from "../utils/log.js";
import { formatToolName } from "../utils/format.js";
import { threadSessions } from "../state/index.js";

// Stream parsing state
export interface StreamState {
	finalResponse: string;
	lastErrorEvent: any;
	mcpResultPosted: boolean;
	currentMcpTool: string | null;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	streamedContent: string;
}

// Callbacks for stream events
export interface StreamCallbacks {
	onSessionInit: (sessionId: string) => void;
	onToolUse: (displayName: string) => void;
	onMcpResult: (result: string) => void;
	onStreamUpdate: (content: string) => void;
}

// Create initial stream state
export function createStreamState(): StreamState {
	return {
		finalResponse: "",
		lastErrorEvent: null,
		mcpResultPosted: false,
		currentMcpTool: null,
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		streamedContent: "",
	};
}

// Parse a JSON stream event and update state
export function parseStreamEvent(
	event: any,
	state: StreamState,
	sessionKey: string,
	initialSeenUserIds: string[],
	isDM: boolean,
	callbacks: StreamCallbacks
): void {
	// Debug: log event types to understand the stream format
	if (event.type) {
		log.verbose(`[stream] ${event.type}${event.subtype ? `:${event.subtype}` : ""}`);
	}

	// Capture session ID from init event (comes early)
	if (event.type === "system" && event.subtype === "init" && event.session_id) {
		threadSessions.set(sessionKey, {
			sessionId: event.session_id,
			lastUsed: Date.now(),
			seenUserIds: initialSeenUserIds,
		});
		log.debug(`Session initialized: ${event.session_id.slice(0, 8)}...`);
		callbacks.onSessionInit(event.session_id);
	}

	// Capture error events from JSON stream
	if (event.type === "error" || (event.type === "system" && event.subtype === "error")) {
		state.lastErrorEvent = event;
		log.error(`[Claude CLI] Error event: ${event.error?.message || event.message || JSON.stringify(event)}`);
		if (event.error?.type) {
			log.error(`[Claude CLI] Error type: ${event.error.type}`);
		}
	}

	// Detect tool use events (multiple possible formats)
	let toolName: string | undefined;
	let toolInput: any;

	if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
		toolName = event.content_block.name;
		toolInput = event.content_block.input;
	} else if (event.type === "tool_use") {
		toolName = event.name;
		toolInput = event.input;
	} else if (event.type === "assistant" && event.message?.content) {
		const toolBlock = event.message.content.find((b: any) => b.type === "tool_use");
		if (toolBlock) {
			toolName = toolBlock.name;
			toolInput = toolBlock.input;
		}
	}

	if (toolName) {
		const displayName = formatToolName(toolName, toolInput);
		log.debug(`Tool: ${displayName}`);
		log.verbose(`Tool raw name: ${toolName}`);
		callbacks.onToolUse(displayName);

		// Track if this is an MCP tool, clear if not
		if (toolName.startsWith("mcp__")) {
			state.currentMcpTool = toolName;
		} else {
			// Clear MCP tool tracking for non-MCP tools to prevent
			// their results from being treated as MCP results
			state.currentMcpTool = null;
		}
	}

	// MCP results are never posted directly - let Claude process and summarize them
	// This avoids posting raw data with pagination metadata like "[Showing results with pagination = limit: 30, offset: 0]"
	// The currentMcpTool tracking above is still used for timeout messages to show which tool is running

	// Capture the final result and session ID
	if (event.type === "result") {
		state.finalResponse = event.result || "";
		// Capture token usage
		if (event.usage) {
			state.inputTokens = event.usage.input_tokens || 0;
			state.outputTokens = event.usage.output_tokens || 0;
		}
		if (event.total_cost_usd) state.costUsd = event.total_cost_usd;
		// Capture session ID for future --resume calls (if not already captured from init)
		if (event.session_id && !threadSessions.has(sessionKey)) {
			threadSessions.set(sessionKey, {
				sessionId: event.session_id,
				lastUsed: Date.now(),
				seenUserIds: initialSeenUserIds,
			});
			log.debug(`Saved session ${event.session_id.slice(0, 8)}... for ${isDM ? "DM" : "thread"}`);
		}
	}

	// Also capture from message stop events
	if (event.type === "message" && event.message?.content) {
		const textBlocks = event.message.content.filter((block: any) => block.type === "text");
		if (textBlocks.length > 0) {
			state.finalResponse = textBlocks.map((b: any) => b.text).join("\n");
		}
	}

	// Stream text content as it's generated
	if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta?.text) {
		state.streamedContent += event.delta.text;
		callbacks.onStreamUpdate(state.streamedContent);
	}

	// Also capture text from assistant messages (full blocks)
	if (event.type === "assistant" && event.message?.content) {
		const textBlocks = event.message.content.filter((b: any) => b.type === "text");
		if (textBlocks.length > 0) {
			const fullText = textBlocks.map((b: any) => b.text).join("\n");
			if (fullText.length > state.streamedContent.length) {
				state.streamedContent = fullText;
				callbacks.onStreamUpdate(state.streamedContent);
			}
		}
	}
}

// Process buffer of incoming data and parse JSON lines
export function processStreamBuffer(
	buffer: string,
	state: StreamState,
	sessionKey: string,
	initialSeenUserIds: string[],
	isDM: boolean,
	callbacks: StreamCallbacks
): string {
	const lines = buffer.split("\n");
	const remainingBuffer = lines.pop() || ""; // Keep incomplete line in buffer

	for (const line of lines) {
		if (!line.trim()) continue;

		try {
			const event = JSON.parse(line);
			parseStreamEvent(event, state, sessionKey, initialSeenUserIds, isDM, callbacks);
		} catch (e) {
			// Not valid JSON, skip
		}
	}

	return remainingBuffer;
}

// Parse error type from stderr and error events
export function parseErrorType(stderr: string, lastErrorEvent: any): { errorType: string; errorDetails: string } {
	// Combine stderr and JSON error for parsing
	const allErrorText = stderr + (lastErrorEvent?.error?.message || lastErrorEvent?.message || "");

	let errorType = "Unknown error";
	let errorDetails = "";

	if (lastErrorEvent?.error?.type) {
		errorType = lastErrorEvent.error.type;
		errorDetails = lastErrorEvent.error.message || "";
	} else if (allErrorText.includes("rate_limit") || allErrorText.includes("rate-limit")) {
		errorType = "Rate limit exceeded";
	} else if (allErrorText.includes("authentication") || allErrorText.includes("unauthorized") || allErrorText.includes("invalid_api_key")) {
		errorType = "Authentication error";
	} else if (allErrorText.includes("timeout") || allErrorText.includes("ETIMEDOUT")) {
		errorType = "Connection timeout";
	} else if (allErrorText.includes("ECONNREFUSED") || allErrorText.includes("ENOTFOUND")) {
		errorType = "Connection refused";
	} else if (allErrorText.includes("socket") || allErrorText.includes("Socket")) {
		errorType = "Socket error";
	} else if (allErrorText.includes("overloaded") || allErrorText.includes("529")) {
		errorType = "API overloaded";
	}

	return { errorType, errorDetails };
}
