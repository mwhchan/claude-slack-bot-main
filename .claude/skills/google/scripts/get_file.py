#!/usr/bin/env python3
"""
Google Drive File Reader
Gets content from Google Drive files (Docs, Sheets, Slides) using export URLs
"""

import json
import time
import argparse
import sys
import re
from pathlib import Path
from typing import Dict, Any, Optional

from patchright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).parent))

from config import DATA_DIR, DOWNLOADS_DIR
from browser_utils import BrowserFactory
from auth_manager import AuthManager


class FileReader:
    """Reads content from Google Drive files using export URLs"""

    def __init__(self):
        self.auth = AuthManager()

    def get_file(
        self,
        file_id: Optional[str] = None,
        file_url: Optional[str] = None,
        show_browser: bool = False
    ) -> Dict[str, Any]:
        """
        Get content from a Google Drive file using export URLs

        Args:
            file_id: Google Drive file ID
            file_url: Full URL to the file
            show_browser: Show browser window

        Returns:
            Dict with status, content
        """
        if not file_id and not file_url:
            return {
                "status": "error",
                "error": "Must provide either --file-id or --file-url"
            }

        if not self.auth.is_authenticated():
            return {
                "status": "error",
                "error": "Not authenticated. Run: python scripts/run.py auth_manager.py setup"
            }

        # Extract file ID, gid, and file type from URL if provided
        gid = None
        file_type = None
        if file_url and not file_id:
            file_id = self._extract_file_id(file_url)
            gid = self._extract_gid(file_url)
            file_type = self._detect_file_type(file_url)
            if not file_id:
                return {
                    "status": "error",
                    "error": f"Could not extract file ID from URL: {file_url}"
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

            # Get content using export URLs (file_type detected from URL if available)
            result = self._get_file_content(page, file_id, gid=gid, file_type=file_type)

            return result

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

    def _extract_file_id(self, url: str) -> Optional[str]:
        """Extract file ID from various Google Drive URL formats"""
        patterns = [
            r'/file/d/([a-zA-Z0-9_-]+)',
            r'/document/d/([a-zA-Z0-9_-]+)',
            r'/spreadsheets/d/([a-zA-Z0-9_-]+)',
            r'/presentation/d/([a-zA-Z0-9_-]+)',
            r'id=([a-zA-Z0-9_-]+)',
            r'/folders/([a-zA-Z0-9_-]+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)

        return None

    def _detect_file_type(self, url: str) -> Optional[str]:
        """Detect file type from URL pattern"""
        if '/document/d/' in url:
            return 'doc'
        elif '/spreadsheets/d/' in url:
            return 'sheet'
        elif '/presentation/d/' in url:
            return 'slides'
        return None

    def _extract_gid(self, url: str) -> Optional[str]:
        """Extract gid (sheet tab ID) from URL"""
        match = re.search(r'gid=(\d+)', url)
        if match:
            return match.group(1)
        return None

    def _get_file_content(self, page: Page, file_id: str, gid: Optional[str] = None, file_type: Optional[str] = None) -> Dict[str, Any]:
        """Get content from file using direct export URLs"""

        # Ensure downloads directory exists
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

        # If file type is known from URL, go directly to the right export method
        if file_type == 'sheet' or gid:
            return self._export_sheet(page, file_id, gid)
        elif file_type == 'doc':
            return self._export_doc(page, file_id)
        elif file_type == 'slides':
            return self._export_slides(page, file_id)

        # Unknown file type - try each export method
        # Try Google Doc first
        result = self._export_doc(page, file_id)
        if result['status'] == 'success':
            return result

        # Try Google Sheet
        result = self._export_sheet(page, file_id, gid)
        if result['status'] == 'success':
            return result

        # Try Google Slides
        result = self._export_slides(page, file_id)
        if result['status'] == 'success':
            return result

        return {
            "status": "error",
            "error": "Could not export file. File may be inaccessible or unsupported format.",
            "file_id": file_id
        }

    def _export_doc(self, page: Page, file_id: str) -> Dict[str, Any]:
        """Export Google Doc as text using export URL"""
        export_url = f"https://docs.google.com/document/d/{file_id}/export?format=txt"
        print(f"📄 Trying Google Docs: {export_url}")

        try:
            # First go to a page in the google.com domain to have cookies
            page.goto("https://docs.google.com", wait_until="domcontentloaded", timeout=15000)
            time.sleep(1)

            # Trigger download via JavaScript - create and click a link
            with page.expect_download(timeout=30000) as download_info:
                page.evaluate(f'''() => {{
                    const a = document.createElement('a');
                    a.href = "{export_url}";
                    a.download = "file.txt";
                    document.body.appendChild(a);
                    a.click();
                }}''')

            download = download_info.value
            file_path = DOWNLOADS_DIR / f"{file_id}_doc.txt"
            download.save_as(str(file_path))

            # Read content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()

            # Clean up
            try:
                file_path.unlink()
            except:
                pass

            if content and len(content) > 0:
                return {
                    "status": "success",
                    "file_id": file_id,
                    "type": "google_doc",
                    "format": "txt",
                    "content": content
                }
        except Exception as e:
            print(f"  ⚠️ Not a Google Doc or export failed: {e}")

        return {"status": "error", "error": "Not a Google Doc"}

    def _export_sheet(self, page: Page, file_id: str, gid: Optional[str] = None) -> Dict[str, Any]:
        """Export Google Sheet as CSV using export URL"""
        export_url = f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=csv"
        if gid:
            export_url += f"&gid={gid}"
        print(f"📊 Trying Google Sheets: {export_url}")

        try:
            # First navigate to the sheet to establish auth
            sheet_url = f"https://docs.google.com/spreadsheets/d/{file_id}/edit"
            page.goto(sheet_url, timeout=10000)
            time.sleep(1)

            # Check if authenticated
            if "accounts.google.com" in page.url:
                return {"status": "error", "error": "Not authenticated"}

            # Now trigger export via JavaScript
            with page.expect_download(timeout=20000) as download_info:
                page.evaluate(f'''() => {{
                    window.location.href = "{export_url}";
                }}''')

            download = download_info.value
            file_path = DOWNLOADS_DIR / f"{file_id}_sheet.csv"
            download.save_as(str(file_path))

            # Read content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()

            # Clean up
            try:
                file_path.unlink()
            except:
                pass

            if content and len(content) > 0:
                return {
                    "status": "success",
                    "file_id": file_id,
                    "type": "google_sheet",
                    "format": "csv",
                    "content": content
                }
        except Exception as e:
            print(f"  ⚠️ Not a Google Sheet or export failed: {e}")

        return {"status": "error", "error": "Not a Google Sheet"}

    def _export_slides(self, page: Page, file_id: str) -> Dict[str, Any]:
        """Export Google Slides as text using export URL"""
        export_url = f"https://docs.google.com/presentation/d/{file_id}/export?format=txt"
        print(f"📽️ Trying Google Slides: {export_url}")

        try:
            # First go to a page in the google.com domain to have cookies
            page.goto("https://docs.google.com", wait_until="domcontentloaded", timeout=15000)
            time.sleep(1)

            # Trigger download via JavaScript - create and click a link
            with page.expect_download(timeout=30000) as download_info:
                page.evaluate(f'''() => {{
                    const a = document.createElement('a');
                    a.href = "{export_url}";
                    a.download = "file.txt";
                    document.body.appendChild(a);
                    a.click();
                }}''')

            download = download_info.value
            file_path = DOWNLOADS_DIR / f"{file_id}_slides.txt"
            download.save_as(str(file_path))

            # Read content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()

            # Clean up
            try:
                file_path.unlink()
            except:
                pass

            if content and len(content) > 0:
                return {
                    "status": "success",
                    "file_id": file_id,
                    "type": "google_slides",
                    "format": "txt",
                    "content": content
                }
        except Exception as e:
            print(f"  ⚠️ Not a Google Slides or export failed: {e}")

        return {"status": "error", "error": "Not a Google Slides"}


def main():
    """CLI for file reading"""
    parser = argparse.ArgumentParser(description='Get content from Google Drive files')

    parser.add_argument('--file-id', help='Google Drive file ID')
    parser.add_argument('--file-url', help='Full URL to the file')
    parser.add_argument('--show-browser', action='store_true', help='Show browser')
    parser.add_argument('--json', action='store_true', help='Output as JSON')

    args = parser.parse_args()

    if not args.file_id and not args.file_url:
        parser.print_help()
        print("\n❌ Error: Must provide either --file-id or --file-url")
        exit(1)

    reader = FileReader()
    result = reader.get_file(
        file_id=args.file_id,
        file_url=args.file_url,
        show_browser=args.show_browser
    )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result['status'] == 'success':
            print(f"\n✅ File retrieved successfully")
            print(f"   Type: {result['type']}")
            print(f"   Format: {result.get('format', 'unknown')}")
            print(f"   ID: {result['file_id']}")
            print(f"\n{'='*50}")
            print(f"CONTENT:")
            print(f"{'='*50}\n")
            print(result['content'])
        else:
            print(f"❌ Error: {result['error']}")


if __name__ == "__main__":
    main()
