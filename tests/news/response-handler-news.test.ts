import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("fs", () => ({
	existsSync: vi.fn(() => false),
	mkdirSync: vi.fn(),
	appendFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

vi.mock("../../src/utils/log.js", () => ({
	log: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		verbose: vi.fn(),
	},
}));

vi.mock("../../src/utils/detection.js", () => ({
	containsSystemReminder: vi.fn(() => false),
}));

vi.mock("../../src/utils/format.js", () => ({
	formatToolName: vi.fn((name: string) => name),
	truncateForSlack: vi.fn((text: string) => text),
	buildSectionBlocks: vi.fn((text: string) => [{ type: "section", text: { type: "mrkdwn", text } }]),
}));

vi.mock("../../src/monitor/websocket.js", () => ({
	broadcastMonitorEvent: vi.fn(),
}));

vi.mock("../../src/claude/stream-parser.js", () => ({
	parseErrorType: vi.fn(() => ({ errorType: "unknown", errorDetails: null })),
}));

vi.mock("../../src/config/paths.js", () => ({
	ROOT_DIR: "/mock/root",
	CHANNEL_CONTEXT_DIR: "/mock/channels",
	USER_CONTEXT_DIR: "/mock/users",
}));

vi.mock("../../src/slack/reactions.js", () => ({
	extractReaction: vi.fn(() => null),
	addReaction: vi.fn(),
}));

vi.mock("../../src/utils/retry.js", () => ({
	retryAsync: vi.fn(async (fn: () => Promise<any>) => fn()),
}));

vi.mock("../../src/utils/git-memory.js", () => ({
	commitContextChange: vi.fn(),
}));

vi.mock("../../src/slack/file-upload.js", () => ({
	processFileUploadTags: vi.fn(async (response: string) => response),
}));

const mockFetchNewsNow = vi.fn(async () => ({ success: true, message: "" }));
vi.mock("../../src/news/index.js", () => ({
	fetchNewsNow: (...args: any[]) => mockFetchNewsNow(...args),
}));

import { handleSuccessResponse, type ResponseContext } from "../../src/claude/response-handler.js";
import type { StreamState } from "../../src/claude/stream-parser.js";

function makeState(response: string): StreamState {
	return {
		finalResponse: response,
		streamedContent: "",
		inputTokens: 100,
		outputTokens: 50,
		costUsd: 0.01,
		lastErrorEvent: null,
		sessionId: null,
	} as StreamState;
}

function makeContext(): ResponseContext {
	return {
		channelId: "C123",
		threadTs: "1234567890.123456",
		userId: "U456",
		say: vi.fn(async () => ({ ts: "9999.9999" })),
		client: {},
		shouldThread: true,
		originalMessageTs: "1111.1111",
	};
}

describe("response-handler — [NEWS:topic] tag processing", () => {
	beforeEach(() => {
		mockFetchNewsNow.mockClear();
	});

	it("should strip [NEWS:topic] tag and trigger fetchNewsNow", async () => {
		const state = makeState("[NEWS:AI]\nFetching AI news for you :newspaper:");
		const ctx = makeContext();

		const result = await handleSuccessResponse(state, ctx, 5, "", "");

		expect(result.handled).toBe(true);
		expect(mockFetchNewsNow).toHaveBeenCalledWith("C123", "AI", "1234567890.123456");
		// Remaining text should be posted
		expect(ctx.say).toHaveBeenCalled();
		const callArg = (ctx.say as any).mock.calls[0][0];
		expect(callArg.text).toBe("Fetching AI news for you :newspaper:");
		expect(callArg.text).not.toContain("[NEWS:");
	});

	it("should handle news-only response (no text after tag) without error", async () => {
		const state = makeState("[NEWS:crypto]");
		const ctx = makeContext();

		const result = await handleSuccessResponse(state, ctx, 5, "", "");

		expect(result.handled).toBe(true);
		expect(mockFetchNewsNow).toHaveBeenCalledWith("C123", "crypto", "1234567890.123456");
		// Should NOT post any message (no error, no text)
		expect(ctx.say).not.toHaveBeenCalled();
	});

	it("should handle multi-word topics", async () => {
		const state = makeState("[NEWS:crypto and blockchain]");
		const ctx = makeContext();

		await handleSuccessResponse(state, ctx, 5, "", "");

		expect(mockFetchNewsNow).toHaveBeenCalledWith("C123", "crypto and blockchain", "1234567890.123456");
	});

	it("should not trigger fetchNewsNow for normal responses", async () => {
		const state = makeState("Here is some information about AI.");
		const ctx = makeContext();

		await handleSuccessResponse(state, ctx, 5, "", "");

		expect(mockFetchNewsNow).not.toHaveBeenCalled();
	});

	it("should not trigger on similar-looking but incorrect tags", async () => {
		const state = makeState("Check [NEWS] for more info.");
		const ctx = makeContext();

		await handleSuccessResponse(state, ctx, 5, "", "");

		// [NEWS] without :topic should not match [NEWS:topic] pattern
		expect(mockFetchNewsNow).not.toHaveBeenCalled();
	});
});
