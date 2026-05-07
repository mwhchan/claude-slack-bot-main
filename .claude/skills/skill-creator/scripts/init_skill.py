#!/usr/bin/env python3
"""
Skill Initializer - Creates a new skill template with standard structure

Usage:
    python init_skill.py <skill-name> --path <path>

Example:
    python init_skill.py my-awesome-skill --path .claude/skills
"""

import argparse
import sys
from pathlib import Path

SKILL_MD_TEMPLATE = '''---
name: {skill_name}
description: TODO - Write a clear description of what this skill does and when it should be triggered. Max 1024 characters.
---

# {skill_title}

<!--
Choose your skill structure from one of these patterns:
1. Workflow-based: Sequential processes with clear steps
2. Task-based: Tool collections without strict ordering
3. Reference/Guidelines: Standards and best practices
4. Capabilities-based: Integrated systems with multiple features

Delete this comment and the unused sections below after choosing.
-->

## Overview

TODO: Describe what this skill does and its primary use cases.

## When to Use

This skill triggers when:
- TODO: List trigger conditions
- TODO: Add more conditions

## Workflow

<!-- For sequential processes -->

1. **Step 1**: Description
2. **Step 2**: Description
3. **Step 3**: Description

## Available Operations

<!-- For task-based skills -->

- **Operation A**: Description of what it does
- **Operation B**: Description of what it does

## Guidelines

<!-- For reference/standards skills -->

### Category 1
- Guideline 1
- Guideline 2

### Category 2
- Guideline 1
- Guideline 2

## Resources

<!-- List any bundled resources -->

| Resource | Purpose |
|----------|---------|
| `scripts/example.py` | Example script (delete if unused) |
| `references/guide.md` | Reference documentation (delete if unused) |

## Notes

- Scripts may be executed without loading into context
- References are detailed information Claude should reference while working
- Assets are non-context files like templates (delete `assets/` if unused)

**Remember:** Not every skill requires all three types of resources. Delete what you don't need.
'''

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
Example script - Delete this file if your skill doesn't need scripts

Scripts are for deterministic, frequently-rewritten tasks that benefit
from consistent execution rather than LLM interpretation.
"""

def main():
    print("Hello from your skill script!")
    # Add your script logic here


if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = '''# Example Reference

Delete this file if your skill doesn't need reference documentation.

References are detailed information that Claude should reference while working.
They are loaded on-demand to keep the context window efficient.

## When to Use References

- API documentation
- Schema definitions
- Policy documents
- Style guides
- Complex specifications

## Organization Tips

For complex skills, organize references by domain:
- `references/api.md` - API documentation
- `references/schema.md` - Data schemas
- `references/policies.md` - Business rules
'''


def create_skill(skill_name: str, base_path: str) -> bool:
    """Create a new skill with the standard directory structure."""

    # Validate skill name
    if not skill_name.replace('-', '').isalnum():
        print(f"❌ Error: Skill name '{skill_name}' should only contain lowercase letters, digits, and hyphens")
        return False

    if skill_name.startswith('-') or skill_name.endswith('-') or '--' in skill_name:
        print(f"❌ Error: Skill name '{skill_name}' cannot start/end with hyphen or contain consecutive hyphens")
        return False

    if len(skill_name) > 64:
        print(f"❌ Error: Skill name is too long ({len(skill_name)} chars). Maximum is 64 characters.")
        return False

    # Create paths
    base = Path(base_path).resolve()
    skill_path = base / skill_name

    if skill_path.exists():
        print(f"❌ Error: Skill directory already exists: {skill_path}")
        return False

    # Create directory structure
    try:
        skill_path.mkdir(parents=True)
        (skill_path / "scripts").mkdir()
        (skill_path / "references").mkdir()
        (skill_path / "assets").mkdir()

        # Create SKILL.md
        skill_title = skill_name.replace('-', ' ').title()
        skill_md_content = SKILL_MD_TEMPLATE.format(
            skill_name=skill_name,
            skill_title=skill_title
        )
        (skill_path / "SKILL.md").write_text(skill_md_content)

        # Create example files
        (skill_path / "scripts" / "example.py").write_text(EXAMPLE_SCRIPT)
        (skill_path / "references" / "guide.md").write_text(EXAMPLE_REFERENCE)

        print(f"✅ Created skill: {skill_path}")
        print(f"\nStructure:")
        print(f"  {skill_name}/")
        print(f"  ├── SKILL.md          (main skill definition)")
        print(f"  ├── scripts/")
        print(f"  │   └── example.py    (delete if unused)")
        print(f"  ├── references/")
        print(f"  │   └── guide.md      (delete if unused)")
        print(f"  └── assets/           (delete if unused)")
        print(f"\nNext steps:")
        print(f"  1. Edit SKILL.md with your skill's content")
        print(f"  2. Add scripts, references, or assets as needed")
        print(f"  3. Delete unused example files and directories")
        print(f"  4. Validate with: python quick_validate.py {skill_path}")

        return True

    except Exception as e:
        print(f"❌ Error creating skill: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Initialize a new Claude Code skill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python init_skill.py my-skill --path .claude/skills
  python init_skill.py api-helper --path ./skills
        """
    )
    parser.add_argument("skill_name", help="Name of the skill (hyphen-case)")
    parser.add_argument("--path", required=True, help="Base path for skills directory")

    args = parser.parse_args()

    print(f"🎯 Initializing skill: {args.skill_name}")
    print(f"   Path: {args.path}\n")

    success = create_skill(args.skill_name, args.path)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
