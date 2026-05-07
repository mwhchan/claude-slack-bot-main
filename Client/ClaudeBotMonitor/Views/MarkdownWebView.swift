import SwiftUI
import WebKit

struct MarkdownWebView: NSViewRepresentable {
    let viewModel: MarkdownWebViewModel
    let content: String

    func makeNSView(context: Context) -> WKWebView {
        viewModel.updateContent(content)
        return viewModel.webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        viewModel.updateContent(content)
    }
}
