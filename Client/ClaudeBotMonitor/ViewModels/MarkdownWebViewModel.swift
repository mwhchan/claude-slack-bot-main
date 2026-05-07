import SwiftUI
import WebKit

@Observable
@MainActor
final class MarkdownWebViewModel: NSObject {
    let webView: WKWebView
    private var pendingContent: String?
    private var isReady = false

    // Load marked.js from bundle resource
    private static let markedJS: String = {
        guard let url = Bundle.main.url(forResource: "marked.min", withExtension: "js"),
              let js = try? String(contentsOf: url, encoding: .utf8) else {
            fatalError("marked.min.js not found in bundle")
        }
        return js
    }()

    override init() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Add message handler for ready callback
        let contentController = WKUserContentController()
        config.userContentController = contentController

        webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")

        super.init()

        // Set up message handler
        contentController.add(LeakAvoider(delegate: self), name: "ready")

        // Set navigation delegate
        webView.navigationDelegate = self

        // Load the HTML template
        let html = generateHTML()
        webView.loadHTMLString(html, baseURL: nil)
    }

    func updateContent(_ markdown: String) {
        if isReady {
            renderMarkdown(markdown)
        } else {
            pendingContent = markdown
        }
    }

    private func renderMarkdown(_ markdown: String) {
        // Escape the markdown for JavaScript
        let escaped = markdown
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "$", with: "\\$")

        let js = "renderMarkdown(`\(escaped)`);"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    fileprivate func handleReady() {
        isReady = true
        if let content = pendingContent {
            renderMarkdown(content)
            pendingContent = nil
        }
    }

    private func generateHTML() -> String {
        """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                :root {
                    color-scheme: light dark;
                }

                * {
                    box-sizing: border-box;
                }

                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
                    font-size: 14px;
                    line-height: 1.6;
                    margin: 0;
                    padding: 16px;
                    background: transparent;
                    word-wrap: break-word;
                }

                /* GitHub Markdown Light Theme */
                @media (prefers-color-scheme: light) {
                    :root {
                        --color-fg-default: #1f2328;
                        --color-fg-muted: #656d76;
                        --color-fg-subtle: #6e7781;
                        --color-canvas-default: transparent;
                        --color-canvas-subtle: #f6f8fa;
                        --color-border-default: #d0d7de;
                        --color-border-muted: hsla(210, 18%, 87%, 1);
                        --color-neutral-muted: rgba(175, 184, 193, 0.2);
                        --color-accent-fg: #0969da;
                        --color-accent-emphasis: #0969da;
                        --color-success-fg: #1a7f37;
                        --color-attention-fg: #9a6700;
                        --color-danger-fg: #d1242f;
                        --color-done-fg: #8250df;
                    }
                }

                /* GitHub Markdown Dark Theme */
                @media (prefers-color-scheme: dark) {
                    :root {
                        --color-fg-default: #e6edf3;
                        --color-fg-muted: #8d96a0;
                        --color-fg-subtle: #6e7681;
                        --color-canvas-default: transparent;
                        --color-canvas-subtle: #161b22;
                        --color-border-default: #30363d;
                        --color-border-muted: #21262d;
                        --color-neutral-muted: rgba(110, 118, 129, 0.4);
                        --color-accent-fg: #4493f8;
                        --color-accent-emphasis: #1f6feb;
                        --color-success-fg: #3fb950;
                        --color-attention-fg: #d29922;
                        --color-danger-fg: #f85149;
                        --color-done-fg: #a371f7;
                    }
                }

                body {
                    color: var(--color-fg-default);
                    background-color: var(--color-canvas-default);
                }

                #content {
                    max-width: 100%;
                }

                #content > *:first-child {
                    margin-top: 0 !important;
                }

                #content > *:last-child {
                    margin-bottom: 0 !important;
                }

                /* Headings */
                h1, h2, h3, h4, h5, h6 {
                    margin-top: 24px;
                    margin-bottom: 16px;
                    font-weight: 600;
                    line-height: 1.25;
                }

                h1 { font-size: 2em; border-bottom: 1px solid var(--color-border-muted); padding-bottom: 0.3em; }
                h2 { font-size: 1.5em; border-bottom: 1px solid var(--color-border-muted); padding-bottom: 0.3em; }
                h3 { font-size: 1.25em; }
                h4 { font-size: 1em; }
                h5 { font-size: 0.875em; }
                h6 { font-size: 0.85em; color: var(--color-fg-muted); }

                /* Paragraphs */
                p {
                    margin-top: 0;
                    margin-bottom: 16px;
                }

                /* Links */
                a {
                    color: var(--color-accent-fg);
                    text-decoration: none;
                }

                a:hover {
                    text-decoration: underline;
                }

                /* Lists */
                ul, ol {
                    margin-top: 0;
                    margin-bottom: 16px;
                    padding-left: 2em;
                }

                ul ul, ul ol, ol ol, ol ul {
                    margin-top: 0;
                    margin-bottom: 0;
                }

                li {
                    margin-top: 0.25em;
                }

                li > p {
                    margin-top: 16px;
                }

                li + li {
                    margin-top: 0.25em;
                }

                /* Code */
                code, tt {
                    font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 85%;
                    padding: 0.2em 0.4em;
                    margin: 0;
                    background-color: var(--color-neutral-muted);
                    border-radius: 6px;
                }

                pre {
                    font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 85%;
                    margin-top: 0;
                    margin-bottom: 16px;
                    padding: 16px;
                    overflow: auto;
                    line-height: 1.45;
                    background-color: var(--color-canvas-subtle);
                    border-radius: 6px;
                    word-wrap: normal;
                }

                pre code, pre tt {
                    display: inline;
                    padding: 0;
                    margin: 0;
                    overflow: visible;
                    line-height: inherit;
                    word-wrap: normal;
                    background-color: transparent;
                    border: 0;
                }

                /* Blockquotes */
                blockquote {
                    margin: 0 0 16px 0;
                    padding: 0 1em;
                    color: var(--color-fg-muted);
                    border-left: 0.25em solid var(--color-border-default);
                }

                blockquote > :first-child {
                    margin-top: 0;
                }

                blockquote > :last-child {
                    margin-bottom: 0;
                }

                /* Tables */
                table {
                    border-spacing: 0;
                    border-collapse: collapse;
                    margin-top: 0;
                    margin-bottom: 16px;
                    display: block;
                    width: max-content;
                    max-width: 100%;
                    overflow: auto;
                }

                table th {
                    font-weight: 600;
                }

                table th, table td {
                    padding: 6px 13px;
                    border: 1px solid var(--color-border-default);
                }

                table tr {
                    background-color: var(--color-canvas-default);
                    border-top: 1px solid var(--color-border-muted);
                }

                table tr:nth-child(2n) {
                    background-color: var(--color-canvas-subtle);
                }

                /* Horizontal Rules */
                hr {
                    height: 0.25em;
                    padding: 0;
                    margin: 24px 0;
                    background-color: var(--color-border-default);
                    border: 0;
                }

                /* Images */
                img {
                    max-width: 100%;
                    box-sizing: content-box;
                    background-color: var(--color-canvas-default);
                }

                /* Task Lists */
                .task-list-item {
                    list-style-type: none;
                }

                .task-list-item + .task-list-item {
                    margin-top: 4px;
                }

                .task-list-item input {
                    margin: 0 0.2em 0.25em -1.4em;
                    vertical-align: middle;
                }

                /* Selection */
                ::selection {
                    background: rgba(59, 130, 246, 0.3);
                }

                /* Emphasis */
                strong {
                    font-weight: 600;
                }

                em {
                    font-style: italic;
                }

                /* Definition lists */
                dl {
                    padding: 0;
                }

                dl dt {
                    padding: 0;
                    margin-top: 16px;
                    font-size: 1em;
                    font-style: italic;
                    font-weight: 600;
                }

                dl dd {
                    padding: 0 16px;
                    margin-bottom: 16px;
                }

                /* Keyboard */
                kbd {
                    display: inline-block;
                    padding: 3px 5px;
                    font: 11px ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    line-height: 10px;
                    color: var(--color-fg-default);
                    vertical-align: middle;
                    background-color: var(--color-canvas-subtle);
                    border: solid 1px var(--color-border-default);
                    border-bottom-color: var(--color-border-default);
                    border-radius: 6px;
                    box-shadow: inset 0 -1px 0 var(--color-border-default);
                }
            </style>
        </head>
        <body>
            <div id="content"></div>
            <script>\(Self.markedJS)</script>
            <script>
                marked.setOptions({ breaks: true, gfm: true });

                function renderMarkdown(markdown) {
                    document.getElementById('content').innerHTML = marked.parse(markdown);
                }

                window.webkit.messageHandlers.ready.postMessage('ready');
            </script>
        </body>
        </html>
        """
    }
}

// MARK: - WKNavigationDelegate

extension MarkdownWebViewModel: WKNavigationDelegate {
    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Page loaded, but we wait for the JS ready message
    }
}

// MARK: - WKScriptMessageHandler

extension MarkdownWebViewModel: WKScriptMessageHandler {
    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "ready" {
            Task { @MainActor in
                self.handleReady()
            }
        }
    }
}

// Helper class to avoid retain cycle with WKUserContentController
private class LeakAvoider: NSObject, WKScriptMessageHandler {
    weak var delegate: MarkdownWebViewModel?

    init(delegate: MarkdownWebViewModel) {
        self.delegate = delegate
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}
