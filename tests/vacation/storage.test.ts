import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "fs";
import {
	getVacationsFilePath,
	loadVacations,
	parseMarkdownTable,
	generateMarkdownTable,
	getVacationsThisWeek,
	cleanupOldVacations,
} from "../../src/vacation/storage.js";

vi.mock("fs", () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	existsSync: vi.fn(),
}));

vi.mock("../../src/config/paths.js", () => ({
	CHANNEL_CONTEXT_DIR: "/mock/channels",
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

const CHANNEL = "C_TEST";

// ── getVacationsFilePath ─────────────────────────────────────

describe("getVacationsFilePath", () => {
	it("returns .md path for channel", () => {
		const path = getVacationsFilePath("C123");
		expect(path).toMatch(/\/mock\/channels\/C123\/vacations\.md$/);
	});
});

// ── parseMarkdownTable ───────────────────────────────────────

describe("parseMarkdownTable", () => {
	it("parses a well-formed table", () => {
		const md = `# Vacations

| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | U123 | 2026-02-16 | 2026-02-20 | Beach trip |
| Bob | | 2026-03-01 | 2026-03-05 | |
`;
		const entries = parseMarkdownTable(md);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual({
			user: "Alice",
			userId: "U123",
			start: "2026-02-16",
			end: "2026-02-20",
			note: "Beach trip",
		});
		expect(entries[1]).toEqual({
			user: "Bob",
			userId: undefined,
			start: "2026-03-01",
			end: "2026-03-05",
			note: undefined,
		});
	});

	it("skips header row", () => {
		const md = `| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | U123 | 2026-02-16 | 2026-02-20 | |
`;
		const entries = parseMarkdownTable(md);
		expect(entries).toHaveLength(1);
		expect(entries[0].user).toBe("Alice");
	});

	it("skips rows with invalid dates", () => {
		const md = `| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | U123 | Feb-16 | Feb-20 | |
| Bob | U456 | 2026-03-01 | 2026-03-05 | |
`;
		const entries = parseMarkdownTable(md);
		expect(entries).toHaveLength(1);
		expect(entries[0].user).toBe("Bob");
	});

	it("skips rows with fewer than 4 columns", () => {
		const md = `| Name | User ID | Start |
|------|---------|-------|
| Alice | U123 | 2026-02-16 |
`;
		expect(parseMarkdownTable(md)).toHaveLength(0);
	});

	it("returns empty array for empty content", () => {
		expect(parseMarkdownTable("")).toEqual([]);
	});

	it("returns empty array for non-table content", () => {
		expect(parseMarkdownTable("# Vacations\n\nNo vacations yet.")).toEqual([]);
	});
});

// ── generateMarkdownTable ────────────────────────────────────

describe("generateMarkdownTable", () => {
	it("generates a valid markdown table", () => {
		const entries = [
			{ user: "Alice", userId: "U123", start: "2026-02-16", end: "2026-02-20", note: "trip" },
			{ user: "Bob", start: "2026-03-01", end: "2026-03-05" },
		];
		const md = generateMarkdownTable(entries);
		expect(md).toContain("# Vacations");
		expect(md).toContain("| Name | User ID | Start | End | Note |");
		expect(md).toContain("| Alice | U123 | 2026-02-16 | 2026-02-20 | trip |");
		expect(md).toContain("| Bob |  | 2026-03-01 | 2026-03-05 |  |");
	});

	it("generates table with empty entries", () => {
		const md = generateMarkdownTable([]);
		expect(md).toContain("# Vacations");
		expect(md).toContain("| Name | User ID | Start | End | Note |");
		// No data rows beyond header and separator
		const lines = md.trim().split("\n");
		expect(lines).toHaveLength(4); // title, blank, header, separator
	});

	it("roundtrips through parse", () => {
		const entries = [
			{ user: "Alice", userId: "U123", start: "2026-02-16", end: "2026-02-20", note: "trip" },
			{ user: "Bob", start: "2026-03-01", end: "2026-03-05" },
		];
		const md = generateMarkdownTable(entries);
		const parsed = parseMarkdownTable(md);
		expect(parsed).toHaveLength(2);
		expect(parsed[0].user).toBe("Alice");
		expect(parsed[0].userId).toBe("U123");
		expect(parsed[1].user).toBe("Bob");
		expect(parsed[1].userId).toBeUndefined();
	});
});

// ── loadVacations ────────────────────────────────────────────

describe("loadVacations", () => {
	it("loads vacations from existing .md file", () => {
		const md = `# Vacations

| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | U123 | 2026-02-16 | 2026-02-20 | |
`;
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readFileSync).mockReturnValue(md);

		const result = loadVacations(CHANNEL);
		expect(result).toHaveLength(1);
		expect(result[0].user).toBe("Alice");
	});

	it("returns empty array when file does not exist", () => {
		vi.mocked(existsSync).mockReturnValue(false);
		expect(loadVacations(CHANNEL)).toEqual([]);
	});

	it("returns empty array for unreadable file", () => {
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readFileSync).mockImplementation(() => {
			throw new Error("read error");
		});
		expect(loadVacations(CHANNEL)).toEqual([]);
	});
});

// ── getVacationsThisWeek ─────────────────────────────────────

describe("getVacationsThisWeek", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-12T12:00:00"));
		vi.mocked(existsSync).mockReturnValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns vacations overlapping with current week", () => {
		const md = `# Vacations

| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | | 2026-02-10 | 2026-02-12 | |
| Bob | | 2026-02-20 | 2026-02-25 | |
| Carol | | 2026-02-01 | 2026-02-05 | |
| Dave | | 2026-02-14 | 2026-02-16 | |
`;
		vi.mocked(readFileSync).mockReturnValue(md);

		const result = getVacationsThisWeek(CHANNEL);
		const names = result.map((v) => v.user);
		expect(names).toContain("Alice");
		expect(names).toContain("Dave");
		expect(names).not.toContain("Bob");
		expect(names).not.toContain("Carol");
	});

	it("returns empty array when no vacations overlap", () => {
		const md = `# Vacations

| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | | 2026-03-01 | 2026-03-05 | |
`;
		vi.mocked(readFileSync).mockReturnValue(md);

		expect(getVacationsThisWeek(CHANNEL)).toEqual([]);
	});
});

// ── cleanupOldVacations ──────────────────────────────────────

describe("cleanupOldVacations", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-12T12:00:00"));
		vi.mocked(existsSync).mockReturnValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("removes entries with end date before today", () => {
		const md = `# Vacations

| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | | 2026-02-01 | 2026-02-05 | |
| Bob | | 2026-02-10 | 2026-02-15 | |
`;
		vi.mocked(readFileSync).mockReturnValue(md);

		const removed = cleanupOldVacations(CHANNEL);
		expect(removed).toBe(1);
		expect(writeFileSync).toHaveBeenCalledOnce();

		const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
		expect(written).toContain("Bob");
		expect(written).not.toContain("Alice");
	});

	it("returns 0 and does not write when nothing to clean", () => {
		const md = `# Vacations

| Name | User ID | Start | End | Note |
|------|---------|-------|-----|------|
| Alice | | 2026-02-12 | 2026-02-15 | |
`;
		vi.mocked(readFileSync).mockReturnValue(md);

		expect(cleanupOldVacations(CHANNEL)).toBe(0);
		expect(writeFileSync).not.toHaveBeenCalled();
	});
});
