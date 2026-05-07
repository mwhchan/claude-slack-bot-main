import SwiftUI

struct MonitorView: View {
    @Bindable var dialogViewModel: DialogViewModel
    @Bindable var logsViewModel: LogsViewModel
    let logWebViewModel: LogWebViewModel
    @State private var autoScroll: Bool = true

    var body: some View {
        VStack(spacing: 0) {
            // Main content area using HSplitView
            HSplitView {
                messagesPanel
                    .frame(minWidth: 300, maxWidth: 800)

                logsPanel
            }

            Divider()

            // Unified footer bar
            unifiedFooterBar
        }
        .onChange(of: autoScroll) { _, newValue in
            dialogViewModel.autoScroll = newValue
            logsViewModel.autoScroll = newValue
        }
        .onAppear {
            dialogViewModel.autoScroll = autoScroll
            logsViewModel.autoScroll = autoScroll
        }
    }

    // MARK: - Messages Panel

    private var messagesPanel: some View {
        VStack(spacing: 0) {
            // Toolbar
            ToolbarView {
                HStack(spacing: DesignTokens.spacingXS) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: DesignTokens.iconMD))
                        .foregroundColor(.secondary)
                    Text("Messages")
                        .font(.system(size: DesignTokens.fontLG))
                        .foregroundColor(.secondary)
                }

                Spacer()
            }

            Divider()

            // Messages content
            if dialogViewModel.messages.isEmpty {
                messagesEmptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(dialogViewModel.messages) { message in
                                MessageBubble(message: message, viewModel: dialogViewModel)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: dialogViewModel.messages.count) { _, _ in
                        if autoScroll, let lastMessage = dialogViewModel.messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMessage.id, anchor: .bottom)
                            }
                        }
                    }
                }
            }
        }
        .background(Color.surfaceSecondary)
    }

    private var messagesEmptyState: some View {
        EmptyStateView(
            icon: "bubble.left.and.bubble.right",
            title: "No messages yet",
            message: "Messages will appear here when the bot is running"
        )
    }

    // MARK: - Logs Panel

    private var logsPanel: some View {
        VStack(spacing: 0) {
            // Toolbar
            ToolbarView {
                HStack(spacing: DesignTokens.spacingXS) {
                    Image(systemName: "terminal")
                        .font(.system(size: DesignTokens.iconMD))
                        .foregroundColor(.secondary)
                    Text("Logs")
                        .font(.system(size: DesignTokens.fontLG))
                        .foregroundColor(.secondary)
                }

                Spacer()

                // Search bar
                SearchField(text: $logsViewModel.searchText, placeholder: "Filter...")
                    .frame(maxWidth: 200)

                // Level filter
                Picker("", selection: $logsViewModel.selectedLevel) {
                    ForEach(LogLevel.allCases, id: \.self) { level in
                        HStack(spacing: 4) {
                            Circle()
                                .fill(level.color)
                                .frame(width: 6, height: 6)
                            Text(level.rawValue)
                        }
                        .tag(level)
                    }
                }
                .pickerStyle(.menu)
                .frame(width: 100)
            }

            Divider()

            // Log content area
            ZStack {
                Color.surfaceTertiary

                LogWebView(viewModel: logWebViewModel, logs: logsViewModel.filteredLogs, autoScroll: autoScroll)

                // Empty state overlay
                if logsViewModel.filteredLogs.isEmpty {
                    EmptyStateView(
                        icon: "terminal",
                        title: "No logs yet",
                        message: logsViewModel.searchText.isEmpty
                            ? "Logs will appear here when the bot is running"
                            : "No logs match your filter"
                    )
                }
            }
        }
    }

    // MARK: - Unified Footer Bar

    private var unifiedFooterBar: some View {
        FooterBar {
            // Line count (logs)
            HStack(spacing: DesignTokens.spacingXS) {
                Image(systemName: "text.alignleft")
                    .font(.system(size: DesignTokens.iconSM))
                    .foregroundColor(Color.secondary.opacity(0.6))
                Text("\(logsViewModel.lineCount) lines")
                    .font(.system(size: DesignTokens.fontSM, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Divider()
                .frame(height: 20)

            // Message count
            HStack(spacing: DesignTokens.spacingXS) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: DesignTokens.iconSM))
                    .foregroundColor(Color.secondary.opacity(0.6))
                Text("\(dialogViewModel.messages.count) messages")
                    .font(.system(size: DesignTokens.fontSM, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Auto-scroll toggle
            Toggle(isOn: $autoScroll) {
                Text("Auto-scroll")
                    .font(.system(size: DesignTokens.fontSM))
            }
            .toggleStyle(.checkbox)
            .controlSize(.small)

            // Refresh button
            IconButton(icon: "arrow.clockwise", label: nil) {
                dialogViewModel.refresh()
            }

            // Clear button
            ActionButton("Clear", icon: "trash", disabled: logsViewModel.logs.isEmpty && dialogViewModel.messages.isEmpty) {
                logsViewModel.clearLogs()
                dialogViewModel.clearMessages()
            }
        }
    }
}
