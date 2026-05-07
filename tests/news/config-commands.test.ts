import { describe, it, expect } from "vitest";
import { isConfigCommand } from "../../src/utils/config-commands.js";

const BOT_ID = "U123BOT";

describe("isConfigCommand — news patterns", () => {
	const shouldMatch = [
		"news now AI",
		"news on AI",
		"news about crypto",
		"news subscribe AI daily 9am",
		"news unsubscribe AI",
		"news list",
		"latest news on AI",
		"recent news about blockchain",
		"what's the news on AI",
		"whats the news about crypto",
		"what's happening with Apple",
		"whats happening in tech",
		"any news on AI",
		"any news about crypto",
		"any news for healthcare",
		"current events on AI",
		"current event about climate",
	];

	const shouldNotMatch = [
		// Project queries — must NOT be caught as news
		"updates on the deployment",
		"updates about the sprint",
		"what's the project status",
		"what are the milestones",
		// General conversation
		"hello",
		"help me with code",
		"remember this",
		// Ambiguous — should go to Claude CLI for skill routing
		"tell me the news",
		"give me news on AI",
		// No topic — should not match
		"latest news",
		"recent news",
	];

	for (const text of shouldMatch) {
		it(`should match: "${text}"`, () => {
			expect(isConfigCommand(text, BOT_ID)).toBe(true);
		});

		// Also test with bot mention prefix
		it(`should match with mention: "<@${BOT_ID}> ${text}"`, () => {
			expect(isConfigCommand(`<@${BOT_ID}> ${text}`, BOT_ID)).toBe(true);
		});
	}

	for (const text of shouldNotMatch) {
		it(`should NOT match: "${text}"`, () => {
			expect(isConfigCommand(text, BOT_ID)).toBe(false);
		});
	}
});
