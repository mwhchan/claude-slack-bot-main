#!/usr/bin/env python3
"""
Atlassian Page Reader
Fetches content from any Atlassian URL (Jira issues, Confluence pages, etc.) using Chrome browser.
Uses shared authentication state with Google skills.
"""

import argparse
import sys
import time
import re
from pathlib import Path
from enum import Enum
from typing import Tuple

# Add google skills to path for shared browser utilities
SKILLS_DIR = Path(__file__).parent.parent.parent
sys.path.insert(0, str(SKILLS_DIR / "google" / "scripts"))

from patchright.sync_api import sync_playwright
from config import BROWSER_PROFILE_DIR, BROWSER_ARGS, USER_AGENT
from auth_manager import AuthManager


class UrlType(Enum):
    JIRA_ISSUE = "jira_issue"
    JIRA_BOARD = "jira_board"
    JIRA_PROJECT = "jira_project"
    CONFLUENCE_PAGE = "confluence_page"
    CONFLUENCE_DATABASE = "confluence_database"
    CONFLUENCE_SPACE = "confluence_space"
    UNKNOWN = "unknown"


def detect_url_type(url: str) -> Tuple[UrlType, dict]:
    """
    Detect the type of Atlassian URL and extract relevant identifiers.

    Returns:
        Tuple of (UrlType, dict with extracted identifiers)
    """
    url_lower = url.lower()
    info = {"original_url": url}

    # Jira issue: /browse/PROJECT-123 or /jira/software/.../browse/PROJECT-123
    jira_issue_match = re.search(r'/browse/([A-Z]+-\d+)', url, re.IGNORECASE)
    if jira_issue_match:
        info["issue_key"] = jira_issue_match.group(1).upper()
        return UrlType.JIRA_ISSUE, info

    # Jira board: /jira/software/projects/PROJECT/boards/123
    if '/boards/' in url_lower and ('/jira/' in url_lower or 'jira.' in url_lower):
        board_match = re.search(r'/boards/(\d+)', url)
        if board_match:
            info["board_id"] = board_match.group(1)
        return UrlType.JIRA_BOARD, info

    # Jira project: /jira/software/projects/PROJECT or /projects/PROJECT
    project_match = re.search(r'/projects/([A-Z]+)', url, re.IGNORECASE)
    if project_match and ('/jira/' in url_lower or 'jira.' in url_lower):
        info["project_key"] = project_match.group(1).upper()
        return UrlType.JIRA_PROJECT, info

    # Confluence database: /wiki/spaces/.../database/...
    if '/database/' in url_lower:
        return UrlType.CONFLUENCE_DATABASE, info

    # Confluence page: /wiki/spaces/.../pages/...
    if '/wiki/' in url_lower or 'confluence' in url_lower:
        page_match = re.search(r'/pages/(\d+)', url)
        if page_match:
            info["page_id"] = page_match.group(1)
        space_match = re.search(r'/spaces/([^/]+)', url)
        if space_match:
            info["space_key"] = space_match.group(1)
        return UrlType.CONFLUENCE_PAGE, info

    # Confluence space home
    if '/wiki/spaces/' in url_lower and '/pages/' not in url_lower:
        space_match = re.search(r'/spaces/([^/]+)', url)
        if space_match:
            info["space_key"] = space_match.group(1)
        return UrlType.CONFLUENCE_SPACE, info

    return UrlType.UNKNOWN, info


def get_content_selectors(url_type: UrlType) -> list:
    """Get content selectors based on URL type."""

    if url_type == UrlType.JIRA_ISSUE:
        return [
            # Issue detail view
            '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
            '[data-testid="issue.views.issue-details.issue-layout.issue-panel"]',
            '#jira-issue-header',
            '.issue-header-content',
            # Description
            '[data-testid="issue.views.field.rich-text.description"]',
            '#description-val',
            '.user-content-block',
            # Full issue panel
            '[data-testid="issue.views.issue-base.foundation.issue-container"]',
            '.issue-view',
            '#issue-content',
            # Comments
            '[data-testid="issue-comment-base"]',
            '.issue-data-block.activity-comment',
        ]

    elif url_type == UrlType.JIRA_BOARD:
        return [
            # Board view
            '[data-testid="software-board.board"]',
            '.ghx-pool',
            '.js-swimlane',
            '[data-testid="platform-board-kit.ui.board.scroll-container"]',
            # Column headers
            '.ghx-column-headers',
            # Cards
            '.ghx-issue',
            '[data-testid="platform-board-kit.ui.card.card"]',
        ]

    elif url_type == UrlType.JIRA_PROJECT:
        return [
            # Project sidebar/summary
            '[data-testid="navigation-apps-sidebar-project-menu"]',
            '.project-summary',
            '#project-config-panel-container',
            # Backlog
            '[data-testid="software-backlog.backlog-content"]',
            '.ghx-backlog',
        ]

    elif url_type in (UrlType.CONFLUENCE_PAGE, UrlType.CONFLUENCE_SPACE):
        return [
            # Modern Confluence
            '[data-testid="content-body"]',
            '.ak-renderer-document',
            '#content-body',
            '.wiki-content',
            # Classic Confluence
            '#main-content',
            '.confluence-content-body',
            '.page-content',
            # Space home
            '[data-testid="space-overview"]',
            '.space-overview',
            # Fallback
            'main',
            '[role="main"]',
            '#content',
        ]

    # Default fallback selectors
    return [
        'main',
        '[role="main"]',
        '#content',
        '#main-content',
        'body',
    ]


def get_title_selectors(url_type: UrlType) -> list:
    """Get title selectors based on URL type."""

    if url_type == UrlType.JIRA_ISSUE:
        return [
            '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
            'h1[data-testid="issue.views.issue-base.foundation.summary.heading"]',
            '#summary-val',
            '.issue-header-content h1',
        ]

    elif url_type in (UrlType.JIRA_BOARD, UrlType.JIRA_PROJECT):
        return [
            '[data-testid="navigation.apps.sidebar.header.title"]',
            '.ghx-header-name',
            'h1',
        ]

    # Confluence and default
    return [
        '[data-testid="title-text"]',
        'h1',
        '.page-title',
        '#title-text',
    ]


def get_atlassian_page(url: str, show_browser: bool = False) -> dict:
    """
    Fetch content from any Atlassian URL using Chrome.

    Args:
        url: Atlassian URL (Jira issue, Confluence page, etc.)
        show_browser: Show browser window for debugging

    Returns:
        Dict with status and content
    """
    auth = AuthManager()

    if not auth.is_authenticated():
        return {
            "status": "error",
            "error": "Not authenticated. Run: cd .claude/skills/google && python3 scripts/run.py auth_manager.py setup"
        }

    # Detect URL type
    url_type, url_info = detect_url_type(url)

    # Handle database URLs early
    if url_type == UrlType.CONFLUENCE_DATABASE:
        return {
            "status": "error",
            "error": "Confluence databases use virtualized rendering that prevents content extraction. Please ask the user to share a regular Confluence page or export the database to CSV/PDF."
        }

    playwright = None
    context = None

    try:
        playwright = sync_playwright().start()

        # Use same browser profile as Google skills
        BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

        # Browser settings for Atlassian compatibility
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_PROFILE_DIR),
            channel="chrome",
            headless=not show_browser,
            viewport={"width": 1920, "height": 1080},
            ignore_default_args=["--enable-automation"],
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-infobars",
                "--window-size=1920,1080",
            ]
        )

        page = context.new_page()

        type_label = url_type.value.replace("_", " ").title()
        print(f"📄 Opening {type_label}: {url}")

        # Navigate to page
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)

        # Wait for content based on URL type
        if url_type == UrlType.JIRA_ISSUE:
            try:
                page.wait_for_selector('[data-testid="issue.views.issue-base.foundation.summary.heading"], #summary-val, .issue-header-content', timeout=15000)
                time.sleep(2)
            except:
                pass
        elif url_type == UrlType.JIRA_BOARD:
            try:
                page.wait_for_selector('[data-testid="software-board.board"], .ghx-pool', timeout=15000)
                time.sleep(3)  # Boards need more time to load cards
            except:
                pass

        # Check if we hit a login page
        current_url = page.url.lower()
        if any(x in current_url for x in ["login", "accounts.google.com", "id.atlassian.com", "/login.action"]):
            time.sleep(3)
            current_url = page.url.lower()
            if any(x in current_url for x in ["login", "accounts.google.com", "id.atlassian.com", "/login.action"]):
                return {
                    "status": "error",
                    "error": "Authentication required. Please log in to Atlassian in your Chrome browser first, then try again."
                }

        # Get title
        title = ""
        for selector in get_title_selectors(url_type):
            try:
                title_el = page.query_selector(selector)
                if title_el:
                    title = title_el.inner_text().strip()
                    if title:
                        break
            except:
                continue

        # For Jira issues, also get the issue key if not in title
        if url_type == UrlType.JIRA_ISSUE and url_info.get("issue_key"):
            if url_info["issue_key"] not in title:
                title = f"{url_info['issue_key']}: {title}" if title else url_info["issue_key"]

        # Extract main content
        content = ""
        for selector in get_content_selectors(url_type):
            try:
                el = page.query_selector(selector)
                if el:
                    text = el.inner_text().strip()
                    if text and len(text) > 50:
                        content = text
                        break
            except:
                continue

        # If still no content, get the body text
        if not content:
            try:
                body = page.query_selector('body')
                if body:
                    content = body.inner_text().strip()
            except:
                pass

        # Clean up content
        if content:
            content = re.sub(r'\n{3,}', '\n\n', content)
            content = re.sub(r' {2,}', ' ', content)

        if not content or len(content) < 50:
            return {
                "status": "error",
                "error": "Could not extract content from the page. The page may require additional permissions."
            }

        return {
            "status": "success",
            "type": url_type.value,
            "title": title,
            "url": url,
            "content": content,
            "info": url_info
        }

    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }

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


def main():
    parser = argparse.ArgumentParser(description='Fetch Atlassian page content via Chrome')
    parser.add_argument('--url', required=True, help='Atlassian URL (Jira issue, Confluence page, etc.)')
    parser.add_argument('--show-browser', action='store_true', help='Show browser window')

    args = parser.parse_args()

    result = get_atlassian_page(args.url, args.show_browser)

    if result['status'] == 'success':
        print(f"\n✅ Page retrieved successfully")
        if result.get('type'):
            print(f"   Type: {result['type']}")
        if result.get('title'):
            print(f"   Title: {result['title']}")
        print(f"   URL: {result['url']}")
        print(f"\n{'='*50}")
        print("CONTENT:")
        print(f"{'='*50}\n")
        print(result['content'])
    else:
        print(f"❌ Error: {result['error']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
