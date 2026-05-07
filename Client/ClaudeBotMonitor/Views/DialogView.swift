import SwiftUI

struct DialogView: View {
    @Bindable var viewModel: DialogViewModel

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                Text("Messages")
                    .font(.headline)

                Spacer()

                Toggle("Auto-scroll", isOn: $viewModel.autoScroll)
                    .toggleStyle(.checkbox)

                Button {
                    viewModel.refresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(NSColor.controlBackgroundColor))

            Divider()

            // Messages
            if viewModel.messages.isEmpty {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(viewModel.messages) { message in
                                MessageBubble(message: message, viewModel: viewModel)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: viewModel.messages.count) { _, _ in
                        if viewModel.autoScroll, let lastMessage = viewModel.messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMessage.id, anchor: .bottom)
                            }
                        }
                    }
                }
            }
        }
        .alert("Delete Failed", isPresented: .init(
            get: { viewModel.deleteError != nil },
            set: { if !$0 { viewModel.deleteError = nil } }
        )) {
            Button("OK") { viewModel.deleteError = nil }
        } message: {
            Text(viewModel.deleteError ?? "Unknown error")
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No messages yet")
                .font(.headline)
                .foregroundColor(.secondary)
            Text("Messages will appear here when the bot is running")
                .font(.caption)
                .foregroundColor(.secondary.opacity(0.7))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct MessageBubble: View {
    let message: DialogMessage
    let viewModel: DialogViewModel

    private var isDeleted: Bool {
        viewModel.isDeleted(message: message)
    }

    private var isUser: Bool {
        message.sender == .user
    }

    private var bubbleColor: Color {
        switch message.sender {
        case .user:
            return Color.blue.opacity(0.2)
        case .assistant:
            return Color.orange.opacity(0.2)
        case .system:
            return Color.green.opacity(0.25)
        }
    }

    private var alignment: HorizontalAlignment {
        isUser ? .leading : .trailing
    }

    var body: some View {
        HStack {
            if !isUser { Spacer(minLength: 60) }

            VStack(alignment: alignment, spacing: 4) {
                // Header
                HStack(spacing: 6) {
                    if isUser {
                        Image(systemName: "person.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                    Text(message.displayName)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                    if !isUser {
                        Image(systemName: message.sender == .assistant ? "bubble.left.and.text.bubble.right" : "info.circle")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                }

                // Message content
                Text(message.content)
                    .font(.body)
                    .strikethrough(isDeleted, color: .secondary)
                    .foregroundColor(isDeleted ? .secondary : .primary)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(isDeleted ? Color.gray.opacity(0.1) : bubbleColor)
                    .cornerRadius(12)

                // Deleted label / Delete button and token info
                HStack(spacing: 8) {
                    if isDeleted {
                        HStack(spacing: 4) {
                            Image(systemName: "trash.fill")
                                .font(.system(size: 10))
                            Text("Deleted")
                                .font(.caption2)
                        }
                        .foregroundColor(.secondary.opacity(0.7))
                    } else if message.canDelete,
                              let channelId = message.slackChannelId,
                              let messageTs = message.slackMessageTs {
                        Button {
                            viewModel.deleteMessage(channelId: channelId, messageTs: messageTs)
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 10))
                        }
                        .buttonStyle(.borderless)
                        .foregroundColor(.secondary.opacity(0.7))
                        .help("Delete from Slack")
                    }

                    if let tokenInfo = message.tokenInfo {
                        HStack(spacing: 4) {
                            Image(systemName: "number")
                                .font(.system(size: 10))
                            Text(tokenInfo)
                                .font(.caption2)
                            if let duration = message.durationSec {
                                Text("• \(duration)s")
                                    .font(.caption2)
                            }
                        }
                        .foregroundColor(.secondary.opacity(0.7))
                    }
                }
            }

            if isUser { Spacer(minLength: 60) }
        }
    }
}
