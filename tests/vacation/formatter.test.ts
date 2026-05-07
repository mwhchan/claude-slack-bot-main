import { describe, it, expect } from "vitest";
import { formatVacationMessage } from "../../src/vacation/formatter.js";

describe("formatVacationMessage", () => {
	it("returns empty string for empty array", () => {
		expect(formatVacationMessage([])).toBe("");
	});

	it("formats single-day vacation", () => {
		const result = formatVacationMessage([
			{ user: "Alice", start: "2026-02-16", end: "2026-02-16" },
		]);
		expect(result).toContain(":palm_tree:");
		expect(result).toContain("*Alice*");
		// Single day — should not have a dash range
		expect(result).not.toMatch(/Alice\*:.*-.*\w{3}/);
	});

	it("formats multi-day vacation with date range", () => {
		const result = formatVacationMessage([
			{ user: "Bob", start: "2026-02-16", end: "2026-02-20" },
		]);
		expect(result).toContain("*Bob*");
		// Should have a range with " - "
		expect(result).toMatch(/Bob\*:.*-/);
	});

	it("includes note in italics", () => {
		const result = formatVacationMessage([
			{ user: "Carol", start: "2026-02-16", end: "2026-02-18", note: "Family trip" },
		]);
		expect(result).toContain("_(Family trip)_");
	});

	it("omits note when not provided", () => {
		const result = formatVacationMessage([
			{ user: "Dave", start: "2026-02-16", end: "2026-02-16" },
		]);
		expect(result).not.toContain("_(");
	});

	it("formats multiple vacations", () => {
		const result = formatVacationMessage([
			{ user: "Alice", start: "2026-02-16", end: "2026-02-16" },
			{ user: "Bob", start: "2026-02-17", end: "2026-02-20" },
			{ user: "Carol", start: "2026-02-18", end: "2026-02-18", note: "dentist" },
		]);
		expect(result).toContain("*Alice*");
		expect(result).toContain("*Bob*");
		expect(result).toContain("*Carol*");
		expect(result).toContain("_(dentist)_");
		expect(result).toContain("_Have a great week everyone!_");
	});
});
