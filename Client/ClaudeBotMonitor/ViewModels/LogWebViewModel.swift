import SwiftUI
import WebKit

@Observable
@MainActor
final class LogWebViewModel {
    let webView: WKWebView
    private var lastLogs: String = ""

    init() {
        webView = WKWebView()
        webView.setValue(false, forKey: "drawsBackground")
    }

    func updateLogs(_ logs: String, autoScroll: Bool) {
        guard logs != lastLogs else { return }
        lastLogs = logs

        let html = generateHTML(logs: logs)
        webView.loadHTMLString(html, baseURL: nil)

        if autoScroll {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.webView.evaluateJavaScript("window.scrollTo(0, document.body.scrollHeight);", completionHandler: nil)
            }
        }
    }

    private func generateHTML(logs: String) -> String {
        let escapedLogs = logs
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\n", with: "<br>")

        let coloredLogs = escapedLogs
            .replacingOccurrences(of: "[ERROR]", with: "<span class='error'>[ERROR]</span>")
            .replacingOccurrences(of: "[WARN]", with: "<span class='warn'>[WARN]</span>")
            .replacingOccurrences(of: "[INFO]", with: "<span class='info'>[INFO]</span>")
            .replacingOccurrences(of: "[DEBUG]", with: "<span class='debug'>[DEBUG]</span>")
            .replacingOccurrences(of: "[VERBOSE]", with: "<span class='verbose'>[VERBOSE]</span>")
            .replacingOccurrences(of: "[MESSAGE]", with: "<span class='message'>[MESSAGE]</span>")

        return """
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                :root {
                    color-scheme: light dark;
                }
                body {
                    font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
                    font-size: 11px;
                    line-height: 1.5;
                    margin: 12px;
                    padding: 0;
                    background: transparent;
                    color: var(--text-color);
                }
                @media (prefers-color-scheme: dark) {
                    :root {
                        --text-color: #e0e0e0;
                    }
                    .error { color: #ff6b6b; }
                    .warn { color: #ffa94d; }
                    .info { color: #74c0fc; }
                    .debug { color: #b197fc; }
                    .verbose { color: #868e96; }
                    .message { color: #69db7c; font-weight: 600; }
                }
                @media (prefers-color-scheme: light) {
                    :root {
                        --text-color: #1a1a1a;
                    }
                    .error { color: #c92a2a; }
                    .warn { color: #e67700; }
                    .info { color: #1971c2; }
                    .debug { color: #7048e8; }
                    .verbose { color: #868e96; }
                    .message { color: #2f9e44; font-weight: 600; }
                }
                ::selection {
                    background: rgba(59, 130, 246, 0.3);
                }
            </style>
        </head>
        <body>
            \(coloredLogs)
        </body>
        </html>
        """
    }
}
