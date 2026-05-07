import Foundation
import SwiftUI

/// Combined view model for context editing, containing both editor and chat view models.
/// One instance per file selection, cached by the coordinator.
@Observable
@MainActor
final class ContextViewModel {
    let editorViewModel: ContextEditorViewModel
    let chatViewModel: ContextChatViewModel
    let markdownViewModel: MarkdownWebViewModel

    /// The file path this view model is associated with
    let filePath: String

    /// Display name for the file
    let fileName: String

    init(filePath: String, fileName: String) {
        self.filePath = filePath
        self.fileName = fileName
        self.editorViewModel = ContextEditorViewModel()
        self.chatViewModel = ContextChatViewModel()
        self.markdownViewModel = MarkdownWebViewModel()
        load()
    }

    /// Load the file content
    func load() {
        editorViewModel.loadFile(at: filePath, displayName: fileName)

        // Sync chat context with editor content
        chatViewModel.updateContext(
            fileName: fileName,
            content: editorViewModel.editorContent
        )

        // Preload markdown content
        markdownViewModel.updateContent(editorViewModel.editorContent)
    }

    /// Update chat context when editor content changes
    func syncChatContext() {
        chatViewModel.updateContext(
            fileName: fileName,
            content: editorViewModel.editorContent
        )
    }
}
