#!/usr/bin/env python3
"""
Atlassian/Confluence Authentication Setup
Opens a browser window for the user to log in to Atlassian.
Uses shared browser profile with Google skills.
"""

import sys
import time
from pathlib import Path

# Add google skills to path for shared browser utilities
SKILLS_DIR = Path(__file__).parent.parent.parent
sys.path.insert(0, str(SKILLS_DIR / "google" / "scripts"))

from patchright.sync_api import sync_playwright
from config import BROWSER_PROFILE_DIR, BROWSER_ARGS, USER_AGENT, STATE_FILE
from auth_manager import AuthManager


def setup_atlassian_auth(site_url: str = None):
    """
    Open browser for Atlassian authentication.

    Args:
        site_url: Optional Atlassian site URL to navigate to
    """
    print("🔐 Opening browser for Atlassian authentication...")
    print("   Please log in to your Atlassian account in the browser window.")
    print("   The browser will close automatically after 60 seconds, or you can close it manually when done.")
    print()

    playwright = None
    context = None

    try:
        playwright = sync_playwright().start()

        BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_PROFILE_DIR),
            channel="chrome",
            headless=False,  # Must show browser for user to log in
            no_viewport=True,
            ignore_default_args=["--enable-automation"],
            user_agent=USER_AGENT,
            args=BROWSER_ARGS
        )

        page = context.new_page()

        # Navigate to Atlassian login or the provided site
        if site_url:
            url = site_url
        else:
            url = "https://id.atlassian.com"

        print(f"📄 Navigating to: {url}")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)

        # Wait for user to complete login (up to 60 seconds)
        print("\n⏳ Waiting for login (60 seconds max)...")
        for i in range(60):
            time.sleep(1)
            # Check if we're no longer on a login page
            current_url = page.url.lower()
            if not any(x in current_url for x in ["login", "id.atlassian.com/login", "/login.action"]):
                if "atlassian" in current_url or "jira" in current_url or "confluence" in current_url:
                    print("\n✅ Login detected! Saving session...")
                    break

        # Save cookies/state
        auth = AuthManager()
        auth._save_browser_state(context)

        print("✅ Authentication state saved!")
        print("   You can now use Atlassian skills (Jira, Confluence, etc.).")

    except Exception as e:
        print(f"❌ Error: {e}")
        return False

    finally:
        if context:
            try:
                context.close()
            except:
                pass
        if playwright:
            try:
                playwright.stop()
            except:
                pass

    return True


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Set up Atlassian authentication')
    parser.add_argument('--url', help='Atlassian site URL to authenticate with')

    args = parser.parse_args()

    success = setup_atlassian_auth(args.url)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
