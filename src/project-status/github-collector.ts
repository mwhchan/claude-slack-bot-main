import { writeFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { execSync } from "child_process";
import { log } from "../utils/log.js";

// GitHub collector — uses `gh` CLI (already authenticated) to collect
// PR, issue, and CI/CD data, then writes results to the report folder.
export async function collectGitHubData(
	repos: string[],
	reportDir: string
): Promise<void> {
	if (!repos.length) {
		log.info(`[StatusCollector:GitHub] No repos configured, skipping`);
		return;
	}

	// Verify gh CLI is available and authenticated
	try {
		execSync("gh auth status", { timeout: 10000, stdio: "pipe" });
	} catch {
		log.info(`[StatusCollector:GitHub] gh CLI not authenticated, skipping`);
		return;
	}

	const sections: string[] = [];

	for (const raw of repos) {
		// Support both "owner/repo" slugs and full GitHub URLs
		const repoSlug = raw.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
		log.info(`[StatusCollector:GitHub] Collecting data for ${repoSlug}`);

		try {
			const [prs, issues, workflows] = await Promise.allSettled([
				collectPRs(repoSlug),
				collectIssues(repoSlug),
				collectWorkflows(repoSlug),
			]);

			const repoSections: string[] = [`## ${repoSlug}`];

			if (prs.status === "fulfilled" && prs.value) {
				repoSections.push(prs.value);
			}
			if (issues.status === "fulfilled" && issues.value) {
				repoSections.push(issues.value);
			}
			if (workflows.status === "fulfilled" && workflows.value) {
				repoSections.push(workflows.value);
			}

			sections.push(repoSections.join("\n\n"));
		} catch (error: any) {
			log.error(`[StatusCollector:GitHub] Failed for ${repoSlug}:`, error);
			sections.push(`## ${repoSlug}\n\n_Error: ${error.message}_`);
		}
	}

	if (sections.length === 0) return;

	const output = `# GitHub Data\n\n${sections.join("\n\n---\n\n")}\n`;
	writeFileSync(pathResolve(reportDir, "github.md"), output);
	log.info(`[StatusCollector:GitHub] Wrote github.md (${output.length} chars)`);
}

function gh(args: string, timeoutMs = 30000): string {
	return execSync(`gh ${args}`, {
		timeout: timeoutMs,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function ghJson<T = any>(args: string): T {
	const raw = gh(args);
	return JSON.parse(raw) as T;
}

interface GhPR {
	number: number;
	title: string;
	author: { login: string };
	updatedAt: string;
	createdAt: string;
	mergedAt: string | null;
	reviewRequests: { totalCount: number };
}

async function collectPRs(repoSlug: string): Promise<string> {
	// Open PRs
	const openPRs = ghJson<GhPR[]>(
		`pr list -R ${repoSlug} --state open --limit 20 --json number,title,author,updatedAt,createdAt,reviewRequests`
	);

	// Recently merged (last 7 days)
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const mergedPRs = ghJson<GhPR[]>(
		`pr list -R ${repoSlug} --state merged --limit 20 --json number,title,author,updatedAt,createdAt,mergedAt`
	);
	const mergedRecently = mergedPRs.filter(
		(pr) => pr.mergedAt && new Date(pr.mergedAt) >= sevenDaysAgo
	);

	// Stale PRs (open, not updated in 7+ days)
	const stalePRs = openPRs.filter(
		(pr) => new Date(pr.updatedAt) < sevenDaysAgo
	);

	// Calculate cycle time for merged PRs
	let avgCycleHours = 0;
	if (mergedRecently.length > 0) {
		const totalHours = mergedRecently.reduce((sum, pr) => {
			const created = new Date(pr.createdAt).getTime();
			const merged = new Date(pr.mergedAt!).getTime();
			return sum + (merged - created) / (1000 * 60 * 60);
		}, 0);
		avgCycleHours = Math.round(totalHours / mergedRecently.length);
	}

	const lines: string[] = ["### Pull Requests"];
	lines.push(`**${openPRs.length} open**, **${mergedRecently.length} merged** (last 7d), **${stalePRs.length} stale**`);

	if (avgCycleHours > 0) {
		const cycleDays = Math.round(avgCycleHours / 24 * 10) / 10;
		lines.push(`Avg cycle time: ${cycleDays}d (${avgCycleHours}h)`);
	}

	if (openPRs.length > 0) {
		lines.push("\n**Open PRs:**");
		lines.push("| PR | Author | Updated | Reviews |");
		lines.push("|---|---|---|---|");
		for (const pr of openPRs.slice(0, 10)) {
			const updated = new Date(pr.updatedAt).toLocaleDateString();
			const reviews = pr.reviewRequests?.totalCount || 0;
			lines.push(`| #${pr.number} ${pr.title} | ${pr.author?.login} | ${updated} | ${reviews} pending |`);
		}
	}

	if (mergedRecently.length > 0) {
		lines.push("\n**Merged (last 7d):**");
		lines.push("| PR | Author | Merged |");
		lines.push("|---|---|---|");
		for (const pr of mergedRecently.slice(0, 10)) {
			const merged = new Date(pr.mergedAt!).toLocaleDateString();
			lines.push(`| #${pr.number} ${pr.title} | ${pr.author?.login} | ${merged} |`);
		}
	}

	if (stalePRs.length > 0) {
		lines.push("\n**Stale PRs (no activity >7d):**");
		for (const pr of stalePRs.slice(0, 5)) {
			lines.push(`• #${pr.number} ${pr.title} — ${pr.author?.login} (last updated: ${new Date(pr.updatedAt).toLocaleDateString()})`);
		}
	}

	return lines.join("\n");
}

interface GhIssue {
	number: number;
	title: string;
	labels: { name: string }[];
	updatedAt: string;
}

async function collectIssues(repoSlug: string): Promise<string> {
	// Open issues
	const openIssues = ghJson<GhIssue[]>(
		`issue list -R ${repoSlug} --state open --limit 30 --json number,title,labels,updatedAt`
	);

	// Recently closed (last 7 days)
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const closedIssues = ghJson<GhIssue[]>(
		`issue list -R ${repoSlug} --state closed --limit 20 --json number,title,labels,updatedAt`
	);
	const recentlyClosed = closedIssues.filter(
		(i) => new Date(i.updatedAt) >= sevenDaysAgo
	);

	const lines: string[] = ["### Issues"];
	lines.push(`**${openIssues.length} open**, **${recentlyClosed.length} closed** (last 7d)`);

	// Group by labels
	const labelCounts: Record<string, number> = {};
	for (const issue of openIssues) {
		for (const label of issue.labels || []) {
			if (label.name) {
				labelCounts[label.name] = (labelCounts[label.name] || 0) + 1;
			}
		}
	}

	if (Object.keys(labelCounts).length > 0) {
		lines.push("\n**By label:**");
		const sorted = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]);
		for (const [label, count] of sorted.slice(0, 8)) {
			lines.push(`• \`${label}\`: ${count}`);
		}
	}

	if (openIssues.length > 0) {
		lines.push("\n**Recent open issues:**");
		lines.push("| # | Title | Labels | Updated |");
		lines.push("|---|---|---|---|");
		for (const issue of openIssues.slice(0, 10)) {
			const labels = (issue.labels || []).map((l) => l.name).join(", ");
			const updated = new Date(issue.updatedAt).toLocaleDateString();
			lines.push(`| #${issue.number} | ${issue.title} | ${labels} | ${updated} |`);
		}
	}

	return lines.join("\n");
}

interface GhRun {
	name: string;
	headBranch: string;
	conclusion: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	startedAt: string;
}

async function collectWorkflows(repoSlug: string): Promise<string> {
	const runs = ghJson<GhRun[]>(
		`run list -R ${repoSlug} --limit 10 --status completed --json name,headBranch,conclusion,status,createdAt,updatedAt,startedAt`
	);

	if (runs.length === 0) {
		return "### CI/CD\n\nNo recent workflow runs.";
	}

	// Count by conclusion
	const conclusions: Record<string, number> = {};
	for (const run of runs) {
		const c = run.conclusion || "unknown";
		conclusions[c] = (conclusions[c] || 0) + 1;
	}

	const lines: string[] = ["### CI/CD"];
	const statusParts = Object.entries(conclusions).map(([k, v]) => `${v} ${k}`);
	lines.push(`Last ${runs.length} runs: ${statusParts.join(", ")}`);

	lines.push("\n| Workflow | Branch | Status | Duration | Date |");
	lines.push("|---|---|---|---|---|");

	for (const run of runs.slice(0, 8)) {
		const duration = run.startedAt && run.updatedAt
			? `${Math.round((new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime()) / 60000)}m`
			: "—";
		const date = new Date(run.createdAt).toLocaleDateString();
		const status = run.conclusion === "success" ? "✅" : run.conclusion === "failure" ? "❌" : "⚠️";
		lines.push(`| ${run.name} | ${run.headBranch} | ${status} ${run.conclusion} | ${duration} | ${date} |`);
	}

	return lines.join("\n");
}
