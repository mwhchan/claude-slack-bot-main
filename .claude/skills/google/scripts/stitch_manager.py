#!/usr/bin/env python3
"""
Google Stitch Manager - UX/UI Design Generation
Automates Google Stitch (stitch.withgoogle.com) to generate UI/UX designs from text prompts.
Uses shared Google authentication via persistent browser profile.

KEY ARCHITECTURE: Stitch renders its entire UI inside a full-page <iframe>
(src=app-companion-430619.appspot.com). All interactions MUST go through
page.frame_locator('iframe') to reach the actual app elements.
"""

import argparse
import base64
import json
import sys
import time
import random
from pathlib import Path

from patchright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))

from auth_manager import AuthManager
from config import STITCH_URL, STITCH_GENERATION_TIMEOUT
from browser_utils import BrowserFactory, StealthUtils


def generate_design(prompt: str, output_path: str, format_type: str = "web",
                    headless: bool = True, reference_image: str = None) -> dict:
    """
    Generate a UX/UI design using Google Stitch.

    Args:
        prompt: Design description/prompt
        output_path: Path to save the screenshot PNG
        format_type: Design format - "web" or "mobile"
        headless: Run browser in headless mode
        reference_image: Optional path to a reference image to upload as context

    Returns:
        Dict with status, output_path, and details
    """
    auth = AuthManager()
    if not auth.is_authenticated():
        print("Not authenticated. Run: python3 scripts/run.py auth_manager.py setup")
        return {"status": "error", "error": "Not authenticated"}

    print(f"Prompt: {prompt}")
    print(f"Format: {format_type}")
    print(f"Output: {output_path}")

    playwright = None
    context = None

    try:
        playwright = sync_playwright().start()
        context = BrowserFactory.launch_persistent_context(
            playwright,
            headless=headless
        )

        page = context.new_page()

        # Navigate to Stitch
        print("  Opening Google Stitch...")
        page.goto(STITCH_URL, wait_until="networkidle", timeout=60000)
        StealthUtils.random_delay(3000, 5000)

        # Check if we got redirected to login
        if "accounts.google.com" in page.url:
            print("  Redirected to Google login - authentication may have expired")
            return {"status": "error", "error": "Authentication expired. Run: python3 scripts/run.py auth_manager.py setup"}

        print(f"  Page loaded: {page.url}")

        # Get the iframe frame_locator - ALL Stitch UI is inside this iframe
        fl = page.frame_locator('iframe').first
        print("  Got iframe frame_locator")

        # Step 1: Select format (Mobile/Web) if available
        # The screenshot shows "App" chip for mobile format
        print(f"  Selecting format: {format_type}...")
        _select_format(fl, format_type)
        StealthUtils.random_delay(1000, 2000)

        # Step 2: Upload reference image if provided
        if reference_image:
            ref_path = Path(reference_image)
            if ref_path.exists():
                print(f"  Uploading reference image: {ref_path.name}...")
                _upload_reference_image(fl, page, str(ref_path))
                StealthUtils.random_delay(1000, 2000)
            else:
                print(f"  Warning: Reference image not found: {reference_image}")

        # Step 3: Find and fill the prompt input
        print("  Entering design prompt...")
        prompt_entered = _enter_prompt(fl, page, prompt)
        if not prompt_entered:
            debug_path = str(Path(output_path).parent / "stitch-debug.png")
            page.screenshot(path=debug_path, full_page=True)
            print(f"  Debug screenshot saved: {debug_path}")
            return {"status": "error", "error": "Could not find prompt input field",
                    "debug_screenshot": debug_path}

        StealthUtils.random_delay(500, 1000)

        # Step 3: Submit the prompt
        print("  Submitting prompt...")
        _click_generate(fl, page)

        # Step 4: Wait for generation to complete
        print(f"  Waiting for design generation (timeout: {STITCH_GENERATION_TIMEOUT}s)...")
        generation_complete = _wait_for_generation(fl, page, STITCH_GENERATION_TIMEOUT)

        if not generation_complete:
            print("  Generation may not have completed, capturing current state...")

        StealthUtils.random_delay(3000, 5000)

        # Step 5: Capture the design image
        print("  Capturing design image...")
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        # Try methods in order: direct download (full-res) → element screenshot (fallback)
        captured = False

        print("  Method 1: Download design image from URL...")
        captured = _download_design_image(page, str(output_file))

        if not captured:
            print("  Method 2: Element screenshot (fallback)...")
            captured = _capture_design(fl, page, str(output_file))

        if captured and output_file.exists() and output_file.stat().st_size > 0:
            print(f"  Design saved to: {output_path}")
            result = {
                "status": "success",
                "output_path": str(output_file),
                "format": format_type,
                "file_size": output_file.stat().st_size
            }

            # Try to download archive if available
            download_path = _try_download_archive(fl, page, str(output_file.parent))
            if download_path:
                result["archive_path"] = download_path

            return result
        else:
            # Full page screenshot as fallback
            page.screenshot(path=str(output_file), full_page=True)
            if output_file.exists() and output_file.stat().st_size > 0:
                print(f"  Full page screenshot saved: {output_path}")
                return {
                    "status": "success",
                    "output_path": str(output_file),
                    "format": format_type,
                    "note": "Full page capture (design area not isolated)",
                    "file_size": output_file.stat().st_size
                }
            return {"status": "error", "error": "Failed to capture screenshot"}

    except Exception as e:
        print(f"  Error: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "error": str(e)}

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


def _select_format(fl, format_type: str) -> bool:
    """Select the design format (web or mobile) inside the iframe.

    In Stitch's dashboard, 'Start a new' has 'App' and 'Web' buttons.
    Clicking one of these is REQUIRED to start a new design.
    """
    if format_type == "mobile":
        labels = ["App", "Mobile", "Phone"]
    else:
        labels = ["Web", "Desktop"]

    for label in labels:
        try:
            # Use exact text match to avoid matching long FAQ strings
            loc = fl.locator(f'button >> text="{label}"').first
            if loc.is_visible(timeout=3000):
                print(f"    Selected format button: {label}")
                loc.click()
                StealthUtils.random_delay(2000, 3000)
                return True
        except Exception:
            pass
        try:
            # Also try as a link/chip
            loc = fl.locator(f'a >> text="{label}"').first
            if loc.is_visible(timeout=1000):
                print(f"    Selected format link: {label}")
                loc.click()
                StealthUtils.random_delay(2000, 3000)
                return True
        except Exception:
            pass
        try:
            # Try general text locator
            loc = fl.locator(f'text="{label}"').first
            if loc.is_visible(timeout=1000):
                # Only click if it's a short element (not a paragraph)
                text_content = loc.inner_text().strip()
                if len(text_content) < 20:
                    print(f"    Selected format: {label}")
                    loc.click()
                    StealthUtils.random_delay(2000, 3000)
                    return True
        except Exception:
            continue

    # Try "design" button as fallback (Start a new → design)
    try:
        loc = fl.locator('text="design"').first
        if loc.is_visible(timeout=1000):
            text_content = loc.inner_text().strip()
            if len(text_content) < 20:
                print("    Clicked 'design' entry point")
                loc.click()
                StealthUtils.random_delay(2000, 3000)
                return True
    except Exception:
        pass

    print("    Format selector not found, proceeding with default")
    return False


def _upload_reference_image(fl, page, image_path: str) -> bool:
    """Upload a reference image to Stitch via the hidden file input.

    Stitch has an <input type="file"> that accepts images. We set the file
    on it directly using Playwright's set_input_files API.
    """
    # Find the file input in the iframe
    iframe_frame = None
    for frame in page.frames:
        if 'appspot' in frame.url:
            iframe_frame = frame
            break

    if not iframe_frame:
        print("    Could not find iframe frame for upload")
        return False

    try:
        file_input = iframe_frame.locator('input[type="file"]').first
        file_input.set_input_files(image_path)
        print(f"    Reference image uploaded: {Path(image_path).name}")

        # Wait for the upload to be processed (thumbnail or preview should appear)
        time.sleep(3)
        return True
    except Exception as e:
        print(f"    Failed to upload reference image: {e}")
        return False


def _enter_prompt(fl, page, prompt: str) -> bool:
    """Find the prompt input inside the iframe and type the design description.

    Args:
        fl: frame_locator for the Stitch iframe
        page: the main page (for keyboard fallbacks)
        prompt: the design description to type
    """
    # Strategy 1: Use frame_locator to find contenteditable/textbox (confirmed working in debug)
    print("    Strategy 1: frame_locator contenteditable/textbox...")
    for selector in ['[role="textbox"]', '[contenteditable="true"]', 'textarea', 'input[type="text"]']:
        try:
            loc = fl.locator(selector).first
            if loc.is_visible(timeout=3000):
                print(f"    Found input: {selector}")
                loc.click()
                StealthUtils.random_delay(300, 600)

                # Type character by character for human-like behavior
                for char in prompt:
                    loc.type(char, delay=random.randint(25, 55))

                print(f"    Typed {len(prompt)} chars")
                return True
        except Exception as e:
            print(f"    {selector} failed: {e}")
            continue

    # Strategy 2: Click on "Describe your design" text then type
    print("    Strategy 2: Click 'Describe your design' placeholder...")
    try:
        desc_loc = fl.locator('text="Describe your design"').first
        if desc_loc.is_visible(timeout=2000):
            print("    Found placeholder text, clicking...")
            desc_loc.click()
            StealthUtils.random_delay(500, 1000)

            # Now try to find the activated input
            for selector in ['[role="textbox"]', '[contenteditable="true"]', 'textarea']:
                try:
                    loc = fl.locator(selector).first
                    if loc.is_visible(timeout=2000):
                        print(f"    Input activated: {selector}")
                        for char in prompt:
                            loc.type(char, delay=random.randint(25, 55))
                        return True
                except Exception:
                    continue

            # Fallback: type via keyboard (the click should have focused the input)
            print("    Typing via keyboard after placeholder click...")
            page.keyboard.type(prompt, delay=35)
            return True
    except Exception as e:
        print(f"    Placeholder click failed: {e}")

    # Strategy 3: Positional click inside the iframe area
    print("    Strategy 3: Positional click at prompt area...")
    try:
        viewport = page.viewport_size
        if viewport:
            x = viewport['width'] // 2
            y = int(viewport['height'] * 0.75)
            print(f"    Clicking at ({x}, {y})...")
            page.mouse.click(x, y)
            StealthUtils.random_delay(500, 1000)
            page.keyboard.type(prompt, delay=35)
            print("    Typed via positional click")
            return True
    except Exception as e:
        print(f"    Positional click failed: {e}")

    return False


def _click_generate(fl, page) -> bool:
    """Submit the prompt - press Enter first (chat-like input), then try buttons."""
    # Primary: Press Enter (most chat-like interfaces submit on Enter)
    print("    Pressing Enter to submit...")
    page.keyboard.press("Enter")
    StealthUtils.random_delay(1000, 2000)

    # Check if something happened (URL change or loading indicator)
    # If Enter didn't work, try finding a submit/send button
    try:
        # Look for small icon buttons (send arrow) near the input, not text-heavy FAQ items
        loc = fl.locator('button[aria-label="Send"], button[aria-label="Submit"], button[aria-label="Generate"]').first
        if loc.is_visible(timeout=2000):
            print("    Also clicking send/submit icon button")
            loc.click()
            return True
    except Exception:
        pass

    # Try submit-type button
    try:
        loc = fl.locator('button[type="submit"]').first
        if loc.is_visible(timeout=1000):
            print("    Clicked submit button")
            loc.click()
            return True
    except Exception:
        pass

    # Try exact text match buttons (avoids FAQ items with long text)
    for text in ["Generate", "Create", "Submit"]:
        try:
            loc = fl.locator(f'button >> text="{text}"').first
            if loc.is_visible(timeout=1000):
                btn_text = loc.inner_text().strip()
                # Only click short button labels, not FAQ questions
                if len(btn_text) < 30:
                    print(f"    Clicked button: '{btn_text}'")
                    loc.click()
                    return True
        except Exception:
            continue

    print("    Enter was pressed (primary submit method)")
    return True


def _wait_for_generation(fl, page, timeout_seconds: int) -> bool:
    """Wait for design generation to complete."""
    deadline = time.time() + timeout_seconds
    generation_started = False

    loading_selectors = [
        '[class*="loading"]',
        '[class*="spinner"]',
        '[class*="progress"]',
        '[role="progressbar"]',
        '[class*="generating"]',
        '[aria-busy="true"]',
        'lottie-player',
        '[class*="skeleton"]',
    ]

    # Wait for generation to start (up to 20s)
    start_wait = time.time() + 20
    while time.time() < start_wait:
        for selector in loading_selectors:
            try:
                loc = fl.locator(selector).first
                if loc.is_visible(timeout=500):
                    print(f"    Generation started (indicator: {selector})")
                    generation_started = True
                    break
            except Exception:
                continue

        # Also check if URL changed
        current_url = page.url
        if current_url != STITCH_URL and "stitch" in current_url:
            print(f"    URL changed to: {current_url}")
            generation_started = True

        if generation_started:
            break
        time.sleep(1)

    if not generation_started:
        print("    No loading indicator detected, waiting for content to load...")
        # Even without loading indicators, wait a minimum time for generation
        time.sleep(30)

    # Wait for either: loading to finish, OR design images to appear
    design_appeared = False
    stable_count = 0
    min_wait = time.time() + 30  # Minimum 30s wait after generation starts

    while time.time() < deadline:
        any_loading = False
        for selector in loading_selectors:
            try:
                loc = fl.locator(selector).first
                if loc.is_visible(timeout=500):
                    any_loading = True
                    break
            except Exception:
                continue

        # Check if design output images/canvases appeared
        if not design_appeared:
            for selector in ['img[src*="blob"]', 'img[src*="data:"]', 'canvas', '[class*="preview"]', '[class*="design-card"]', '[class*="generated"]']:
                try:
                    loc = fl.locator(selector).first
                    if loc.is_visible(timeout=500):
                        box = loc.bounding_box()
                        if box and box['width'] > 100 and box['height'] > 100:
                            print(f"    Design output appeared: {selector}")
                            design_appeared = True
                            break
                except Exception:
                    continue

        if not any_loading and time.time() > min_wait:
            stable_count += 1
            if stable_count >= 3:
                if design_appeared:
                    print("    Generation complete (design visible)")
                else:
                    print("    Generation appears complete (no loading, min wait passed)")
                return True
        else:
            stable_count = 0

        time.sleep(2)

    print("    Generation timeout reached")
    return design_appeared


def _download_design_image(page, output_path: str) -> bool:
    """Download the full-resolution design image directly from its URL.

    Stitch renders designs as <img> elements inside React Flow nodes, with src
    pointing to Google's image CDN (lh3.googleusercontent.com). We find the image
    URL in the iframe DOM and download it at native resolution via fetch().
    """
    # Find the iframe frame (content is on appspot.com)
    iframe_frame = None
    for frame in page.frames:
        if 'appspot' in frame.url:
            iframe_frame = frame
            break

    if not iframe_frame:
        print("    Could not find iframe frame")
        return False

    # Get design image URLs from React Flow nodes
    try:
        img_list = iframe_frame.evaluate('''
            () => {
                const nodes = document.querySelectorAll('.react-flow__node img');
                const results = [];
                for (const img of nodes) {
                    if (img.naturalWidth > 100 && img.naturalHeight > 100) {
                        results.push({
                            src: img.src,
                            naturalWidth: img.naturalWidth,
                            naturalHeight: img.naturalHeight
                        });
                    }
                }
                return results;
            }
        ''')
    except Exception as e:
        print(f"    Failed to query iframe DOM: {e}")
        return False

    if not img_list:
        print("    No design images found in React Flow nodes")
        return False

    # Pick the largest image (highest resolution)
    img_list.sort(key=lambda x: x['naturalWidth'] * x['naturalHeight'], reverse=True)
    best = img_list[0]
    print(f"    Found design image: {best['naturalWidth']}x{best['naturalHeight']}")
    print(f"    URL: {best['src'][:100]}...")

    # Download the image using fetch() inside the iframe context
    try:
        data_url = iframe_frame.evaluate('''
            async (url) => {
                const response = await fetch(url);
                const blob = await response.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
            }
        ''', best['src'])
    except Exception as e:
        print(f"    fetch() failed: {e}")
        return False

    if not data_url or ',' not in data_url:
        print("    fetch() returned no data")
        return False

    # Decode and save
    try:
        _, encoded = data_url.split(',', 1)
        image_bytes = base64.b64decode(encoded)
        with open(output_path, 'wb') as f:
            f.write(image_bytes)

        if Path(output_path).exists() and Path(output_path).stat().st_size > 0:
            file_size = Path(output_path).stat().st_size
            print(f"    Full-res image downloaded: {file_size} bytes ({best['naturalWidth']}x{best['naturalHeight']})")
            return True
    except Exception as e:
        print(f"    Failed to save image: {e}")

    return False


def _capture_design(fl, page, output_path: str) -> bool:
    """Capture a screenshot of the design canvas/output area (fallback method)."""
    canvas_selectors = [
        'canvas',
        '[class*="canvas"]',
        '[class*="design-area"]',
        '[class*="preview"]',
        '[class*="output"]',
        '[class*="result"]',
        '[class*="generated"]',
        '[role="img"]',
        'img[src*="blob"]',
        'img[src*="data:"]',
        'main',
        '[class*="workspace"]',
        '[class*="artboard"]',
    ]

    for selector in canvas_selectors:
        try:
            loc = fl.locator(selector).first
            if loc.is_visible(timeout=1500):
                box = loc.bounding_box()
                if box and box['width'] > 200 and box['height'] > 200:
                    print(f"    Capturing design area: {selector} ({box['width']:.0f}x{box['height']:.0f})")
                    loc.screenshot(path=output_path)
                    return True
        except Exception:
            continue

    # Fallback: full page screenshot
    print("    No specific design area found, taking full page screenshot")
    page.screenshot(path=output_path, full_page=True)
    return Path(output_path).exists()


def _try_download_archive(fl, page, download_dir: str) -> str:
    """Try to download the design archive if a download/export button exists."""
    for text in ["Download", "Export"]:
        try:
            loc = fl.locator(f'button:has-text("{text}")').first
            if loc.is_visible(timeout=2000):
                print(f"    Found download button: {text}")
                with page.expect_download(timeout=30000) as download_info:
                    loc.click()
                download = download_info.value
                save_path = str(Path(download_dir) / download.suggested_filename)
                download.save_as(save_path)
                print(f"    Archive downloaded: {save_path}")
                return save_path
        except Exception:
            continue

    return None


def main():
    """Command-line interface for Stitch design generation."""
    parser = argparse.ArgumentParser(description='Generate UX/UI designs with Google Stitch')
    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # Generate command
    gen_parser = subparsers.add_parser('generate', help='Generate a new design')
    gen_parser.add_argument('--prompt', required=True, help='Design description/prompt')
    gen_parser.add_argument('--output', required=True, help='Output path for screenshot PNG')
    gen_parser.add_argument('--format', choices=['web', 'mobile'], default='web',
                           help='Design format (default: web)')
    gen_parser.add_argument('--show-browser', action='store_true', help='Show browser window')
    gen_parser.add_argument('--reference-image', help='Path to a reference image to upload')

    args = parser.parse_args()

    if args.command == 'generate':
        result = generate_design(
            prompt=args.prompt,
            output_path=args.output,
            format_type=args.format,
            headless=not args.show_browser,
            reference_image=args.reference_image
        )

        print("\n" + "=" * 60)
        print(json.dumps(result, indent=2))
        print("=" * 60)

        if result.get("status") == "success":
            sys.exit(0)
        else:
            sys.exit(1)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
