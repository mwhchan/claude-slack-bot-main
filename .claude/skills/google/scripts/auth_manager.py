#!/usr/bin/env python3
"""
Authentication Manager for Google Services
Handles Google login and browser state persistence for NotebookLM and Drive
"""

import json
import time
import argparse
import shutil
import re
import sys
from pathlib import Path
from typing import Optional, Dict, Any

from patchright.sync_api import sync_playwright, BrowserContext

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    BROWSER_STATE_DIR, STATE_FILE, AUTH_INFO_FILE, DATA_DIR,
    NOTEBOOKLM_URL, DRIVE_URL
)
from browser_utils import BrowserFactory


class AuthManager:
    """
    Manages authentication and browser state for Google services
    Single auth works for both NotebookLM and Google Drive
    """

    def __init__(self):
        """Initialize the authentication manager"""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        BROWSER_STATE_DIR.mkdir(parents=True, exist_ok=True)

        self.state_file = STATE_FILE
        self.auth_info_file = AUTH_INFO_FILE
        self.browser_state_dir = BROWSER_STATE_DIR

    def is_authenticated(self) -> bool:
        """Check if valid authentication exists"""
        if not self.state_file.exists():
            return False

        # Check if state file is not too old (7 days)
        age_days = (time.time() - self.state_file.stat().st_mtime) / 86400
        if age_days > 7:
            print(f"Warning: Browser state is {age_days:.1f} days old, may need re-authentication")

        return True

    def get_auth_info(self) -> Dict[str, Any]:
        """Get authentication information"""
        info = {
            'authenticated': self.is_authenticated(),
            'state_file': str(self.state_file),
            'state_exists': self.state_file.exists()
        }

        if self.auth_info_file.exists():
            try:
                with open(self.auth_info_file, 'r') as f:
                    saved_info = json.load(f)
                    info.update(saved_info)
            except Exception:
                pass

        if info['state_exists']:
            age_hours = (time.time() - self.state_file.stat().st_mtime) / 3600
            info['state_age_hours'] = age_hours

        return info

    def setup_auth(self, headless: bool = False, timeout_minutes: int = 10, service: str = "drive") -> bool:
        """
        Perform interactive authentication setup

        Args:
            headless: Run browser in headless mode (False for login)
            timeout_minutes: Maximum time to wait for login
            service: Which service to authenticate with ("drive" or "notebooklm")
        """
        # Choose URL based on service
        if service == "notebooklm":
            auth_url = NOTEBOOKLM_URL
            success_pattern = r"^https://notebooklm\.google\.com/"
        else:
            auth_url = DRIVE_URL
            success_pattern = r"^https://drive\.google\.com/"

        print(f"Starting Google authentication setup ({service})...")
        print(f"  Timeout: {timeout_minutes} minutes")

        playwright = None
        context = None

        try:
            playwright = sync_playwright().start()
            context = BrowserFactory.launch_persistent_context(
                playwright,
                headless=headless
            )

            page = context.new_page()
            page.goto(auth_url, wait_until="domcontentloaded")

            # Check if already authenticated
            if re.match(success_pattern, page.url) and "accounts.google.com" not in page.url:
                print("  Already authenticated!")
                self._save_browser_state(context)
                return True

            # Wait for manual login
            print("\n  Please log in to your Google account...")
            print(f"  Waiting up to {timeout_minutes} minutes for login...")

            try:
                timeout_ms = int(timeout_minutes * 60 * 1000)
                page.wait_for_url(re.compile(success_pattern), timeout=timeout_ms)

                print("  Login successful!")
                self._save_browser_state(context)
                self._save_auth_info(service)
                return True

            except Exception as e:
                print(f"  Authentication timeout: {e}")
                return False

        except Exception as e:
            print(f"  Error: {e}")
            return False

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

    def _save_browser_state(self, context: BrowserContext):
        """Save browser state to disk"""
        try:
            context.storage_state(path=str(self.state_file))
            print(f"  Saved browser state to: {self.state_file}")
        except Exception as e:
            print(f"  Failed to save browser state: {e}")
            raise

    def _save_auth_info(self, service: str = "google"):
        """Save authentication metadata"""
        try:
            info = {
                'authenticated_at': time.time(),
                'authenticated_at_iso': time.strftime('%Y-%m-%d %H:%M:%S'),
                'service': service
            }
            with open(self.auth_info_file, 'w') as f:
                json.dump(info, f, indent=2)
        except Exception:
            pass

    def clear_auth(self) -> bool:
        """Clear all authentication data"""
        print("Clearing authentication data...")

        try:
            if self.state_file.exists():
                self.state_file.unlink()
                print("  Removed browser state")

            if self.auth_info_file.exists():
                self.auth_info_file.unlink()
                print("  Removed auth info")

            if self.browser_state_dir.exists():
                shutil.rmtree(self.browser_state_dir)
                self.browser_state_dir.mkdir(parents=True, exist_ok=True)
                print("  Cleared browser data")

            return True

        except Exception as e:
            print(f"  Error clearing auth: {e}")
            return False

    def re_auth(self, headless: bool = False, timeout_minutes: int = 10, service: str = "drive") -> bool:
        """Perform re-authentication (clear and setup)"""
        print("Starting re-authentication...")
        self.clear_auth()
        return self.setup_auth(headless, timeout_minutes, service)

    def validate_auth(self, service: str = "drive") -> bool:
        """Validate that stored authentication works"""
        if not self.is_authenticated():
            return False

        if service == "notebooklm":
            check_url = NOTEBOOKLM_URL
            success_pattern = "notebooklm.google.com"
        else:
            check_url = DRIVE_URL
            success_pattern = "drive.google.com"

        print(f"Validating authentication ({service})...")

        playwright = None
        context = None

        try:
            playwright = sync_playwright().start()
            context = BrowserFactory.launch_persistent_context(
                playwright,
                headless=True
            )

            page = context.new_page()
            page.goto(check_url, wait_until="domcontentloaded", timeout=30000)

            if success_pattern in page.url and "accounts.google.com" not in page.url:
                print("  Authentication is valid")
                return True
            else:
                print("  Authentication is invalid (redirected to login)")
                return False

        except Exception as e:
            print(f"  Validation failed: {e}")
            return False

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
    """Command-line interface for authentication management"""
    parser = argparse.ArgumentParser(description='Manage Google authentication')

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # Setup command
    setup_parser = subparsers.add_parser('setup', help='Setup authentication')
    setup_parser.add_argument('--headless', action='store_true', help='Run in headless mode')
    setup_parser.add_argument('--timeout', type=float, default=10, help='Login timeout in minutes')
    setup_parser.add_argument('--service', choices=['drive', 'notebooklm'], default='drive',
                             help='Which service to authenticate with')

    # Status command
    subparsers.add_parser('status', help='Check authentication status')

    # Validate command
    validate_parser = subparsers.add_parser('validate', help='Validate authentication')
    validate_parser.add_argument('--service', choices=['drive', 'notebooklm'], default='drive',
                                help='Which service to validate against')

    # Clear command
    subparsers.add_parser('clear', help='Clear authentication')

    # Re-auth command
    reauth_parser = subparsers.add_parser('reauth', help='Re-authenticate')
    reauth_parser.add_argument('--timeout', type=float, default=10, help='Login timeout in minutes')
    reauth_parser.add_argument('--service', choices=['drive', 'notebooklm'], default='drive',
                              help='Which service to authenticate with')

    args = parser.parse_args()
    auth = AuthManager()

    if args.command == 'setup':
        if auth.setup_auth(headless=args.headless, timeout_minutes=args.timeout, service=args.service):
            print("\nAuthentication setup complete!")
        else:
            print("\nAuthentication setup failed")
            exit(1)

    elif args.command == 'status':
        info = auth.get_auth_info()
        print("\nAuthentication Status:")
        print(f"  Authenticated: {'Yes' if info['authenticated'] else 'No'}")
        if info.get('state_age_hours'):
            print(f"  State age: {info['state_age_hours']:.1f} hours")
        if info.get('authenticated_at_iso'):
            print(f"  Last auth: {info['authenticated_at_iso']}")
        if info.get('service'):
            print(f"  Service: {info['service']}")
        print(f"  State file: {info['state_file']}")

    elif args.command == 'validate':
        if auth.validate_auth(service=args.service):
            print("Authentication is valid and working")
        else:
            print("Authentication is invalid or expired")
            print("Run: python scripts/run.py auth_manager.py setup")

    elif args.command == 'clear':
        if auth.clear_auth():
            print("Authentication cleared")

    elif args.command == 'reauth':
        if auth.re_auth(timeout_minutes=args.timeout, service=args.service):
            print("\nRe-authentication complete!")
        else:
            print("\nRe-authentication failed")
            exit(1)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
