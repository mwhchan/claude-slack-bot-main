import SwiftUI
import WebKit

struct LogWebView: NSViewRepresentable {
    let viewModel: LogWebViewModel
    let logs: String
    let autoScroll: Bool

    func makeNSView(context: Context) -> WKWebView {
        viewModel.updateLogs(logs, autoScroll: autoScroll)
        return viewModel.webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        viewModel.updateLogs(logs, autoScroll: autoScroll)
    }
}
