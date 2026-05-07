import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { log } from "./log.js";

// Initialize git repo in directory if needed and commit all changes
export function commitContextChange(contextDir: string, contextId: string, action: string): void {
	try {
		const gitDir = pathResolve(contextDir, ".git");
		if (!existsSync(gitDir)) {
			execSync("git init", { cwd: contextDir, stdio: "ignore" });
			log.info(`[Git] Initialized repo in ${contextId}`);
		}
		execSync("git add .", { cwd: contextDir, stdio: "ignore" });

		// Check if there are staged changes to commit
		try {
			execSync("git diff --cached --quiet", { cwd: contextDir, stdio: "ignore" });
			// No changes staged, skip commit
			return;
		} catch {
			// Non-zero exit means there are staged changes — proceed with commit
		}

		const timestamp = new Date().toISOString();
		const msg = `${action} - ${timestamp}`;
		execSync(`git commit -m "${msg}"`, { cwd: contextDir, stdio: "ignore" });
		log.info(`[Git] Committed: ${action} for ${contextId}`);
	} catch (error) {
		log.warn(`[Git] Commit failed for ${contextId}:`, error);
	}
}
