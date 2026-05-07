import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "../utils/log.js";

export interface Skill {
	name: string;
	description: string;
	location: string;
}

/**
 * Parse YAML frontmatter from a SKILL.md file
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) {
		return {};
	}

	const frontmatter = frontmatterMatch[1];
	const lines = frontmatter.split("\n");
	const result: { name?: string; description?: string } = {};

	for (const line of lines) {
		const match = line.match(/^(\w+):\s*(.+)$/);
		if (match) {
			const [, key, value] = match;
			if (key === "name") {
				result.name = value.trim();
			} else if (key === "description") {
				result.description = value.trim();
			}
		}
	}

	return result;
}

/**
 * Load all skills from .claude/skills directory
 */
export function loadSkills(skillsDir: string): Skill[] {
	const skills: Skill[] = [];

	if (!existsSync(skillsDir)) {
		log.warn(`[Skills] Skills directory not found: ${skillsDir}`);
		return skills;
	}

	try {
		const entries = readdirSync(skillsDir);

		for (const entry of entries) {
			const skillPath = join(skillsDir, entry);
			const skillMdPath = join(skillPath, "SKILL.md");

			// Check if this is a skill directory with SKILL.md
			if (!statSync(skillPath).isDirectory() || !existsSync(skillMdPath)) {
				continue;
			}

			try {
				const content = readFileSync(skillMdPath, "utf-8");
				const { name, description } = parseFrontmatter(content);

				if (name && description) {
					skills.push({
						name,
						description,
						location: skillMdPath,
					});
				} else {
					log.warn(`[Skills] Missing name or description in ${skillMdPath}`);
				}
			} catch (error) {
				log.error(`[Skills] Error reading ${skillMdPath}:`, error);
			}
		}

		log.debug(`[Skills] Loaded ${skills.length} skills from ${skillsDir}`);
	} catch (error) {
		log.error(`[Skills] Error scanning skills directory:`, error);
	}

	return skills;
}

/**
 * Format skills as XML for the prompt
 */
export function formatSkillsAsXML(skills: Skill[]): string {
	if (skills.length === 0) {
		return "";
	}

	const skillEntries = skills
		.map(
			(skill) => `  <skill>
    <name>${escapeXML(skill.name)}</name>
    <description>${escapeXML(skill.description)}</description>
    <location>${escapeXML(skill.location)}</location>
  </skill>`,
		)
		.join("\n");

	return `<available_skills>
${skillEntries}
</available_skills>`;
}

/**
 * Escape XML special characters
 */
function escapeXML(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Build the skills section for the prompt
 */
export function buildSkillsPromptSection(skillsDir: string): string {
	const skills = loadSkills(skillsDir);
	const skillsXML = formatSkillsAsXML(skills);

	if (!skillsXML) {
		return "";
	}

	return `## Skills (Auto-Detection)

Before replying, scan the message and check if any skill clearly applies:

${skillsXML}

**Instructions:**
- If exactly one skill description matches the message content → Read its SKILL.md at <location> and follow it
- If multiple skills could apply → Choose the most specific one, read and follow it
- If no skill clearly applies → Proceed with normal response (do not read any SKILL.md)

**Constraint:** Only read ONE skill file maximum. Select first, then read.

`;
}
