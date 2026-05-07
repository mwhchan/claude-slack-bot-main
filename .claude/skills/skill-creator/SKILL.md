---
name: skill-creator
description: Create and develop new Claude Code skills. Use when developers want to scaffold a new skill, validate an existing skill, or package a skill for distribution. Triggers on requests like "create a new skill", "scaffold skill", "validate my skill", or "package skill".
---

# Skill Creator

Create modular skill packages that extend Claude's capabilities with specialized knowledge, workflows, and tool integrations.

## Core Principles

**Conciseness matters.** The context window is a public good—skills should only include information Claude truly needs. Each component must justify its token cost.

**Match specificity to task requirements:**
- Text-based instructions for flexible approaches
- Pseudocode for preferred patterns
- Specific scripts when operations are fragile or require consistency

## Skill Structure

Every skill requires a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: skill-name
description: Clear description of what it does and when to trigger it (max 1024 chars)
---
```

### Optional Bundled Resources

| Directory | Purpose |
|-----------|---------|
| `scripts/` | Executable code for deterministic, frequently-rewritten tasks |
| `references/` | Documentation loaded as needed (schemas, APIs, policies) |
| `assets/` | Output files like templates or boilerplate code |

## Progressive Disclosure Pattern

1. **Metadata** (~100 words) - Always loads
2. **Skill body** (<5k words) - Loads upon triggering
3. **Bundled resources** - Load as needed

For complex skills, organize references by domain to load only relevant content.

## Skill Structural Patterns

Choose the pattern that best fits your use case:

### 1. Workflow-Based
For sequential processes with clear steps:
```
## Workflow
1. Analyze input
2. Process data
3. Generate output
4. Verify results
```

### 2. Task-Based
For tool collections without strict ordering:
```
## Available Operations
- **Task A**: Description
- **Task B**: Description
```

### 3. Reference/Guidelines
For standards and best practices:
```
## Guidelines
### Category 1
- Rule 1
- Rule 2
```

### 4. Capabilities-Based
For integrated systems with multiple features:
```
## Core Capabilities
### Feature 1
Details...
### Feature 2
Details...
```

## Creation Workflow

1. **Understand** concrete usage examples
2. **Plan** reusable contents (scripts, references, assets)
3. **Initialize** with `init_skill.py`
4. **Implement** resources and write `SKILL.md`
5. **Validate** with `quick_validate.py`
6. **Package** with `package_skill.py`
7. **Iterate** based on real usage

## Available Scripts

### Initialize New Skill
```bash
python .claude/skills/skill-creator/scripts/init_skill.py <skill-name> --path <path>
```

### Validate Skill
```bash
python .claude/skills/skill-creator/scripts/quick_validate.py <skill-directory>
```

### Package Skill
```bash
python .claude/skills/skill-creator/scripts/package_skill.py <skill-directory> [output-dir]
```

## SKILL.md Frontmatter Rules

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | Hyphen-case, max 64 chars |
| `description` | Yes | Max 1024 chars, no angle brackets |
| `license` | No | License identifier |
| `allowed-tools` | No | Tool restrictions |
| `metadata` | No | Additional metadata |

## Best Practices

1. **Description is critical** - Primary triggering mechanism; clarify both what the skill does AND when to use it
2. **Delete unused resources** - Not every skill needs scripts, references, or assets
3. **Test with real scenarios** - Validate against actual use cases before packaging
4. **Keep it focused** - One skill per domain; compose multiple skills for complex workflows

## References

For additional patterns, see:
- `references/output-patterns.md` - Template and example patterns
- `references/workflows.md` - Sequential and conditional workflow patterns
