import SwiftUI

struct ContextChatView: View {
    @Bindable var viewModel: ContextChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            // Header
            chatHeader

            Divider()

            // Messages
            if viewModel.messages.isEmpty {
                emptyState
            } else {
                messageList
            }

            Divider()

            // Input area
            inputArea
        }
        .background(Color.surfaceSecondary.opacity(0.3))
    }

    // MARK: - Header

    private var chatHeader: some View {
        HStack(spacing: DesignTokens.spacingSM) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: DesignTokens.iconMD))
                .foregroundStyle(.purple)

            Text("Claude Assistant")
                .font(.system(size: DesignTokens.fontMD, weight: .medium))

            Spacer()

            if viewModel.hasContext {
                HStack(spacing: 4) {
                    Image(systemName: "doc.text.fill")
                        .font(.system(size: DesignTokens.iconSM))
                    Text(viewModel.contextFileName ?? "Context")
                        .font(.system(size: DesignTokens.fontXS))
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.surfaceTertiary)
                .cornerRadius(DesignTokens.radiusSM)
            }

            IconButton(icon: "trash", label: nil, size: .small) {
                viewModel.clearChat()
            }
        }
        .padding(.horizontal, DesignTokens.spacingMD)
        .padding(.vertical, DesignTokens.spacingSM)
        .frame(height: 36)
        .background(.bar)
    }

    // MARK: - Message List

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: DesignTokens.spacingSM) {
                    ForEach(viewModel.messages) { message in
                        ChatMessageBubble(message: message)
                            .id(message.id)
                    }

                    // Show streaming response
                    if viewModel.isLoading && !viewModel.streamingResponse.isEmpty {
                        streamingBubble
                            .id("streaming")
                    }
                }
                .padding(DesignTokens.spacingMD)
            }
            .onChange(of: viewModel.messages.count) { _, _ in
                if let lastMessage = viewModel.messages.last {
                    withAnimation {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
            .onChange(of: viewModel.streamingResponse) { _, _ in
                if viewModel.isLoading {
                    withAnimation {
                        proxy.scrollTo("streaming", anchor: .bottom)
                    }
                }
            }
        }
    }

    private var streamingBubble: some View {
        HStack {
            Spacer(minLength: 40)

            VStack(alignment: .trailing, spacing: 4) {
                HStack(spacing: 6) {
                    Text("Claude")
                        .font(.system(size: DesignTokens.fontXS))
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                    Image(systemName: "ellipsis")
                        .font(.system(size: DesignTokens.iconSM))
                        .foregroundColor(.secondary)
                        .symbolEffect(.variableColor.iterative)
                }

                Text(viewModel.streamingResponse)
                    .font(.system(size: DesignTokens.fontSM))
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.orange.opacity(0.15))
                    .cornerRadius(12)
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 36))
                .foregroundColor(.secondary)

            Text("Chat with Claude")
                .font(.system(size: DesignTokens.fontMD, weight: .medium))
                .foregroundColor(.secondary)

            Text("Ask questions about the selected context file")
                .font(.system(size: DesignTokens.fontSM))
                .foregroundColor(.secondary.opacity(0.7))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Input Area

    private var inputArea: some View {
        HStack(spacing: DesignTokens.spacingSM) {
            TextField("Ask Claude...", text: $viewModel.inputText)
                .textFieldStyle(.plain)
                .font(.system(size: DesignTokens.fontSM))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.surfaceTertiary)
                .cornerRadius(DesignTokens.radiusMD)
                .onSubmit {
                    viewModel.sendMessage()
                }
                .disabled(viewModel.isLoading)

            if viewModel.isLoading {
                Button {
                    viewModel.cancelRequest()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .help("Cancel")
            } else {
                Button {
                    viewModel.sendMessage()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(viewModel.inputText.isEmpty ? Color.secondary : Color.accentColor)
                }
                .buttonStyle(.plain)
                .disabled(viewModel.inputText.isEmpty)
                .help("Send")
            }
        }
        .padding(DesignTokens.spacingSM)
    }
}

// MARK: - Chat Message Bubble

struct ChatMessageBubble: View {
    let message: ChatMessage

    private var isUser: Bool {
        message.role == .user
    }

    private var isSystem: Bool {
        message.role == .system
    }

    private var bubbleColor: Color {
        switch message.role {
        case .user:
            return Color.blue.opacity(0.15)
        case .assistant:
            return Color.orange.opacity(0.15)
        case .system:
            return Color.green.opacity(0.15)
        }
    }

    private var iconName: String {
        switch message.role {
        case .user:
            return "person.fill"
        case .assistant:
            return "brain.head.profile"
        case .system:
            return "info.circle.fill"
        }
    }

    private var roleName: String {
        switch message.role {
        case .user:
            return "You"
        case .assistant:
            return "Claude"
        case .system:
            return "System"
        }
    }

    var body: some View {
        HStack(alignment: .top) {
            if !isUser { Spacer(minLength: 40) }

            VStack(alignment: isUser ? .leading : .trailing, spacing: 4) {
                // Header
                HStack(spacing: 6) {
                    if isUser {
                        Image(systemName: iconName)
                            .font(.system(size: DesignTokens.iconSM))
                            .foregroundColor(.secondary)
                    }

                    Text(roleName)
                        .font(.system(size: DesignTokens.fontXS))
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)

                    if !isUser {
                        Image(systemName: iconName)
                            .font(.system(size: DesignTokens.iconSM))
                            .foregroundColor(.secondary)
                    }
                }

                // Message content
                Text(message.content)
                    .font(.system(size: DesignTokens.fontSM))
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(bubbleColor)
                    .cornerRadius(12)
            }

            if isUser { Spacer(minLength: 40) }
        }
    }
}
