#!/usr/bin/env python3
"""
Google Drive Manager
Lists folders and files, searches Drive content
"""

import json
import time
import argparse
import sys
import re
from pathlib import Path
from typing import Dict, Any, List, Optional

from patchright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).parent))

from config import DATA_DIR, DRIVE_URL, DRIVE_HOME_URL
from browser_utils import BrowserFactory, StealthUtils
from auth_manager import AuthManager


class DriveManager:
    """Manages Google Drive file listing and search operations"""

    def __init__(self):
        self.auth = AuthManager()
        self.stealth = StealthUtils()

    def list_files(self, folder_id: Optional[str] = None, show_browser: bool = False) -> Dict[str, Any]:
        """
        List files and folders in Google Drive

        Args:
            folder_id: Optional folder ID to list (None for root)
            show_browser: Show browser window for debugging

        Returns:
            Dict with status, files list
        """
        if not self.auth.is_authenticated():
            return {
                "status": "error",
                "error": "Not authenticated. Run: python scripts/run.py auth_manager.py setup"
            }

        playwright = None
        context = None

        try:
            playwright = sync_playwright().start()
            context = BrowserFactory.launch_persistent_context(
                playwright,
                headless=not show_browser
            )

            page = context.new_page()

            # Navigate to Drive folder
            if folder_id:
                url = f"https://drive.google.com/drive/folders/{folder_id}"
            else:
                url = DRIVE_URL

            print(f"📂 Navigating to: {url}")
            page.goto(url, wait_until="domcontentloaded", timeout=30000)

            # Check if logged in
            if "accounts.google.com" in page.url:
                return {
                    "status": "error",
                    "error": "Session expired. Run: python scripts/run.py auth_manager.py setup"
                }

            # Wait for Drive to load
            time.sleep(2)  # Allow Drive UI to render

            # Add human-like behavior
            self.stealth.random_mouse_movement(page)

            # Extract file list
            files = self._extract_file_list(page)

            return {
                "status": "success",
                "folder_id": folder_id or "root",
                "files": files,
                "count": len(files)
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
                except Exception:
                    pass
            if playwright:
                try:
                    playwright.stop()
                except Exception:
                    pass

    def _extract_file_list(self, page: Page) -> List[Dict[str, Any]]:
        """Extract file/folder list from Google Drive page"""
        files = []

        try:
            # Wait for main content area to load
            page.wait_for_selector('[role="main"]', timeout=10000)
            time.sleep(2)  # Extra wait for file list to render

            # Try multiple selectors for Drive file items (div elements only, not scripts)
            # Google Drive uses div[data-id] for file/folder items
            items = page.query_selector_all('div[data-id]:not(script)')

            # If no items, try the row-based selector
            if not items or len(items) == 0:
                items = page.query_selector_all('[role="row"][data-id]')

            for item in items:
                try:
                    data_id = item.get_attribute('data-id')
                    if not data_id or data_id == 'null':
                        continue

                    # Try to get file name
                    name_element = item.query_selector('[data-tooltip]')
                    name = name_element.get_attribute('data-tooltip') if name_element else None

                    if not name:
                        # Alternative: look for aria-label
                        name = item.get_attribute('aria-label')

                    if not name:
                        # Try inner text
                        name = item.inner_text().split('\n')[0] if item.inner_text() else None

                    if not name or len(name) > 200:  # Skip invalid names
                        continue

                    # Determine if folder or file
                    is_folder = 'folder' in (item.get_attribute('data-type') or '').lower()
                    if not is_folder:
                        # Check by icon or aria-label
                        aria = item.get_attribute('aria-label') or ''
                        is_folder = 'folder' in aria.lower()

                    file_info = {
                        "id": data_id,
                        "name": name.strip(),
                        "type": "folder" if is_folder else "file"
                    }

                    # Avoid duplicates
                    if not any(f['id'] == data_id for f in files):
                        files.append(file_info)

                except Exception:
                    continue

            # If no items found with data-id, try alternative approach
            if not files:
                files = self._extract_file_list_alternative(page)

        except Exception as e:
            print(f"  ⚠️ Error extracting files: {e}")

        return files

    def _extract_file_list_alternative(self, page: Page) -> List[Dict[str, Any]]:
        """Alternative extraction method using different selectors"""
        files = []

        try:
            # Try getting visible text items in the main list area
            # Look for the main content area
            content = page.query_selector('[role="main"]')
            if not content:
                content = page

            # Get all clickable items that look like files
            items = content.query_selector_all('[role="row"], [role="gridcell"]')

            seen_names = set()
            for item in items:
                try:
                    text = item.inner_text().strip()
                    if text and '\n' in text:
                        name = text.split('\n')[0]
                    else:
                        name = text

                    if name and len(name) < 200 and name not in seen_names:
                        # Try to extract ID from href or data attribute
                        link = item.query_selector('a[href*="drive.google.com"]')
                        file_id = None
                        if link:
                            href = link.get_attribute('href') or ''
                            # Extract ID from URL patterns like /file/d/ID or /folders/ID
                            match = re.search(r'/(?:file/d|folders)/([a-zA-Z0-9_-]+)', href)
                            if match:
                                file_id = match.group(1)

                        files.append({
                            "id": file_id or f"unknown_{len(files)}",
                            "name": name,
                            "type": "unknown"
                        })
                        seen_names.add(name)

                except Exception:
                    continue

        except Exception as e:
            print(f"  ⚠️ Alternative extraction error: {e}")

        return files

    def search(self, query: str, show_browser: bool = False) -> Dict[str, Any]:
        """
        Search for files in Google Drive

        Args:
            query: Search query
            show_browser: Show browser window

        Returns:
            Dict with status, search results
        """
        if not self.auth.is_authenticated():
            return {
                "status": "error",
                "error": "Not authenticated. Run: python scripts/run.py auth_manager.py setup"
            }

        playwright = None
        context = None

        try:
            playwright = sync_playwright().start()
            context = BrowserFactory.launch_persistent_context(
                playwright,
                headless=not show_browser
            )

            page = context.new_page()

            # Navigate to Drive
            print(f"🔍 Searching for: {query}")
            page.goto(DRIVE_HOME_URL, wait_until="domcontentloaded", timeout=30000)

            if "accounts.google.com" in page.url:
                return {
                    "status": "error",
                    "error": "Session expired. Run: python scripts/run.py auth_manager.py setup"
                }

            time.sleep(2)

            # Find and use search box
            search_input = page.query_selector('input[aria-label="Search in Drive"]')
            if not search_input:
                search_input = page.query_selector('input[type="text"]')

            if search_input:
                self.stealth.realistic_click(page, 'input[aria-label="Search in Drive"]')
                self.stealth.human_type(page, 'input[aria-label="Search in Drive"]', query)
                page.keyboard.press('Enter')

                # Wait for results
                time.sleep(3)

                # Extract results
                files = self._extract_file_list(page)

                return {
                    "status": "success",
                    "query": query,
                    "results": files,
                    "count": len(files)
                }
            else:
                return {
                    "status": "error",
                    "error": "Could not find search input"
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
                except Exception:
                    pass
            if playwright:
                try:
                    playwright.stop()
                except Exception:
                    pass


def main():
    """CLI for Drive management"""
    parser = argparse.ArgumentParser(description='Manage Google Drive files')
    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # List command
    list_parser = subparsers.add_parser('list', help='List files and folders')
    list_parser.add_argument('--folder-id', help='Folder ID to list (omit for root)')
    list_parser.add_argument('--show-browser', action='store_true', help='Show browser')

    # Search command
    search_parser = subparsers.add_parser('search', help='Search Drive')
    search_parser.add_argument('--query', required=True, help='Search query')
    search_parser.add_argument('--show-browser', action='store_true', help='Show browser')

    args = parser.parse_args()

    manager = DriveManager()

    if args.command == 'list':
        result = manager.list_files(
            folder_id=args.folder_id,
            show_browser=args.show_browser
        )

        if result['status'] == 'success':
            print(f"\n📁 Found {result['count']} items:\n")
            for f in result['files']:
                icon = "📁" if f['type'] == 'folder' else "📄"
                print(f"  {icon} {f['name']}")
                print(f"     ID: {f['id']}")
        else:
            print(f"❌ Error: {result['error']}")

    elif args.command == 'search':
        result = manager.search(
            query=args.query,
            show_browser=args.show_browser
        )

        if result['status'] == 'success':
            print(f"\n🔍 Found {result['count']} results for '{result['query']}':\n")
            for f in result['results']:
                icon = "📁" if f['type'] == 'folder' else "📄"
                print(f"  {icon} {f['name']}")
                print(f"     ID: {f['id']}")
        else:
            print(f"❌ Error: {result['error']}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
