import SwiftUI

struct ContextEditorView: View {
    @Bindable var contextViewModel: ContextViewModel

    @State private var showChat = true
    @State private var isEditMode = false

    var body: some View {
        HSplitView {
            // Editor
            editorView

            // Chat panel
            if showChat {
                ContextChatView(viewModel: contextViewModel.chatViewModel)
                    .frame(minWidth: 280, idealWidth: 320, maxWidth: 400)
            }
        }
        .onChange(of: contextViewModel.editorViewModel.selectedFile?.id) { _, _ in
            contextViewModel.syncChatContext()
        }
        .alert("Unsaved Changes", isPresented: Bindable(contextViewModel.editorViewModel).showSaveAlert) {
            Button("Don't Save", role: .destructive) {
                contextViewModel.editorViewModel.discardChanges()
            }
            Button("Cancel", role: .cancel) { }
            Button("Save") {
                contextViewModel.editorViewModel.saveFile()
            }
        } message: {
            Text("Do you want to save changes before switching files?")
        }
    }

    // MARK: - Editor

    private var editorView: some View {
        VStack(spacing: 0) {
            if let file = contextViewModel.editorViewModel.selectedFile {
                // Editor header
                HStack(spacing: DesignTokens.spacingSM) {
                    Image(systemName: file.icon)
                        .font(.system(size: DesignTokens.iconMD))
                        .foregroundStyle(file.iconColor)

                    Text(file.displayName)
                        .font(.system(size: DesignTokens.fontMD, weight: .medium))

                    if contextViewModel.editorViewModel.hasUnsavedChanges {
                        Circle()
                            .fill(Color.accentWarning)
                            .frame(width: 8, height: 8)
                    }

                    Spacer()

                    Text(file.sizeFormatted)
                        .font(.system(size: DesignTokens.fontXS, design: .monospaced))
                        .foregroundStyle(.secondary)

                    // Edit controls - macOS style
                    HStack(spacing: 4) {
                        if isEditMode && contextViewModel.editorViewModel.hasUnsavedChanges {
                            Button {
                                contextViewModel.editorViewModel.revertFile()
                            } label: {
                                Label("Revert", systemImage: "arrow.uturn.backward")
                                    .font(.system(size: 12))
                            }
                            .buttonStyle(.accessoryBar)
                            .help("Revert changes")
                        }

                        Button {
                            if isEditMode && contextViewModel.editorViewModel.hasUnsavedChanges {
                                contextViewModel.editorViewModel.saveFile()
                            }
                            isEditMode.toggle()
                        } label: {
                            Label(isEditMode ? "Done" : "Edit", systemImage: isEditMode ? "checkmark" : "pencil")
                                .font(.system(size: 12))
                        }
                        .buttonStyle(.accessoryBar)
                        .help(isEditMode ? "Save and finish editing" : "Edit file")
                    }
                }
                .padding(.horizontal, DesignTokens.spacingLG)
                .padding(.vertical, DesignTokens.spacingSM)
                .frame(height: 36)
                .background(.bar)

                Divider()

                // Content area
                if isEditMode {
                    // Edit mode - plain TextEditor with ScrollView
                    ScrollView {
                        TextEditor(text: Bindable(contextViewModel.editorViewModel).editorContent)
                            .font(.system(size: 13, design: .monospaced))
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .padding(DesignTokens.spacingMD)
                            .onChange(of: contextViewModel.editorViewModel.editorContent) { _, _ in
                                contextViewModel.editorViewModel.contentDidChange()
                            }
                    }
                } else {
                    // View mode - WebView with GitHub markdown styling (handles own scrolling)
                    MarkdownWebView(
                        viewModel: contextViewModel.markdownViewModel,
                        content: contextViewModel.editorViewModel.editorContent
                    )
                }
            } else {
                // Empty state
                EmptyStateView(
                    icon: "doc.text",
                    title: "Select a file",
                    message: "Choose a context file from the sidebar to edit"
                )
            }
        }
        .onChange(of: contextViewModel.editorViewModel.selectedFile?.id) { _, _ in
            // Reset to view mode when switching files
            isEditMode = false
        }
    }
}
