#!/usr/bin/env python3
"""Debug script to analyze Stitch DOM structure, including iframe content."""

import sys
import time
import json
from pathlib import Path

from patchright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from browser_utils import BrowserFactory


def main():
    headless = "--headless" in sys.argv

    pw = sync_playwright().start()
    ctx = BrowserFactory.launch_persistent_context(pw, headless=headless)
    page = ctx.new_page()

    print("Loading Stitch...")
    page.goto("https://stitch.withgoogle.com/", wait_until="networkidle", timeout=60000)
    time.sleep(5)

    print(f"URL: {page.url}")
    print(f"Title: {page.title()}")
    print()

    # ===== FRAMES =====
    print(f"=== FRAMES ({len(page.frames)} total) ===")
    for i, frame in enumerate(page.frames):
        print(f"  Frame[{i}]: name='{frame.name}' url={frame.url[:120]}")
    print()

    # ===== IFRAME SRC =====
    iframe_info = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('iframe')).map(f => ({
            src: f.src || 'no-src',
            id: f.id || '',
            name: f.name || '',
            w: Math.round(f.getBoundingClientRect().width),
            h: Math.round(f.getBoundingClientRect().height),
            x: Math.round(f.getBoundingClientRect().x),
            y: Math.round(f.getBoundingClientRect().y)
        }));
    }""")
    print(f"=== IFRAMES ({len(iframe_info)}) ===")
    for f in iframe_info:
        print(f"  src={f['src'][:100]}")
        print(f"  id='{f['id']}' name='{f['name']}' pos=({f['x']},{f['y']}) size={f['w']}x{f['h']}")
    print()

    # ===== MAIN PAGE DOM =====
    html_len = page.evaluate("() => document.documentElement.outerHTML.length")
    print(f"=== MAIN PAGE DOM ({html_len} chars) ===")
    # Get top-level body children
    body_info = page.evaluate("""() => {
        return Array.from(document.body.children).map(el => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            cls: (typeof el.className === 'string' ? el.className : '').substring(0, 80),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
            text: el.textContent?.substring(0, 50)?.trim() || ''
        }));
    }""")
    for el in body_info:
        print(f"  <{el['tag']}> id='{el['id']}' class='{el['cls']}' size={el['w']}x{el['h']}")
        if el['text']:
            print(f"    text: '{el['text'][:50]}'")
    print()

    # ===== EACH FRAME CONTENT =====
    for i, frame in enumerate(page.frames):
        if i == 0:
            continue  # Skip main frame
        print(f"=== FRAME[{i}] CONTENT: {frame.url[:80]} ===")
        try:
            frame_html_len = frame.evaluate("() => document.documentElement?.outerHTML?.length || 0")
            print(f"  HTML length: {frame_html_len}")

            # Get all elements in frame
            elements = frame.evaluate("""() => {
                const results = [];
                function walk(el, depth) {
                    if (depth > 5 || results.length > 50) return;
                    const rect = el.getBoundingClientRect();
                    const tag = el.tagName?.toLowerCase() || '';
                    const cls = (typeof el.className === 'string' ? el.className : '').substring(0, 80);
                    const role = el.getAttribute?.('role') || '';
                    const text = el.textContent?.trim()?.substring(0, 60) || '';
                    const placeholder = el.placeholder || el.getAttribute?.('placeholder') || '';
                    const ariaLabel = el.getAttribute?.('aria-label') || '';

                    const isInteresting = tag === 'textarea' || tag === 'input' || tag === 'button'
                        || tag === 'a' || role || placeholder || ariaLabel
                        || el.contentEditable === 'true'
                        || (text && text.length < 60 && rect.width > 0);

                    if (isInteresting && rect.width > 0 && rect.height > 0) {
                        results.push({
                            tag, cls, role, placeholder, ariaLabel,
                            contentEditable: el.contentEditable,
                            text: text.substring(0, 60),
                            w: Math.round(rect.width), h: Math.round(rect.height),
                            depth
                        });
                    }
                    for (const child of el.children || []) {
                        walk(child, depth + 1);
                    }
                }
                if (document.body) walk(document.body, 0);
                return results;
            }""")

            print(f"  Interesting elements: {len(elements)}")
            for el in elements[:30]:
                attrs = []
                if el['role']: attrs.append(f"role='{el['role']}'")
                if el['placeholder']: attrs.append(f"placeholder='{el['placeholder']}'")
                if el['ariaLabel']: attrs.append(f"aria-label='{el['ariaLabel']}'")
                if el['contentEditable'] == 'true': attrs.append("contenteditable")
                if el['cls']: attrs.append(f"class='{el['cls'][:50]}'")
                indent = '  ' * (el['depth'] + 1)
                print(f"{indent}<{el['tag']}> {' '.join(attrs)}")
                if el['text']:
                    print(f"{indent}  text: '{el['text'][:50]}'")
                print(f"{indent}  size={el['w']}x{el['h']}")
        except Exception as e:
            print(f"  Cannot access frame content: {e}")
    print()

    # ===== USE frame_locator TO FIND ELEMENTS INSIDE IFRAME =====
    print("=== TRYING frame_locator APPROACH ===")
    try:
        fl = page.frame_locator('iframe').first
        # Try to find textarea inside iframe
        for selector in ['textarea', 'input', '[contenteditable="true"]', '[role="textbox"]', 'button', 'div:has-text("Describe")']:
            try:
                loc = fl.locator(selector).first
                if loc.is_visible(timeout=2000):
                    text = loc.inner_text()[:40] if loc.inner_text() else ''
                    print(f"  FOUND via frame_locator: {selector} text='{text}'")
            except Exception:
                pass
    except Exception as e:
        print(f"  frame_locator failed: {e}")

    # Take screenshot
    page.screenshot(path="/tmp/stitch-frames-debug.png")
    print("\nScreenshot: /tmp/stitch-frames-debug.png")

    ctx.close()
    pw.stop()


if __name__ == "__main__":
    main()
