#!/usr/bin/env python3
"""
Runner script for Atlassian skills (Jira, Confluence).
Usage: python3 scripts/run.py <script_name> [args...]

Uses the shared virtual environment from Google skills.
"""

import subprocess
import sys
from pathlib import Path

SKILLS_DIR = Path(__file__).parent.parent.parent
GOOGLE_VENV = SKILLS_DIR / "google" / ".venv"
SCRIPTS_DIR = Path(__file__).parent


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/run.py <script_name> [args...]")
        print("\nAvailable scripts:")
        print("  get_page.py --url <atlassian_url>  - Fetch Jira/Confluence page content")
        print("  auth_setup.py --url <site_url>     - Set up Atlassian authentication")
        sys.exit(1)

    script_name = sys.argv[1]
    script_path = SCRIPTS_DIR / script_name

    if not script_path.exists():
        print(f"Script not found: {script_name}")
        sys.exit(1)

    # Use Google skills venv if available
    if GOOGLE_VENV.exists():
        python = GOOGLE_VENV / "bin" / "python3"
    else:
        python = sys.executable

    # Run the script
    cmd = [str(python), str(script_path)] + sys.argv[2:]
    result = subprocess.run(cmd, cwd=str(SCRIPTS_DIR))
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
