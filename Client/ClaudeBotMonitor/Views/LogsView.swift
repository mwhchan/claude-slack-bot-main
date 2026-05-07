import SwiftUI

struct LogsView: View {
    @Bindable var viewModel: LogsViewModel

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            ToolbarView {
                // Search bar
                SearchField(text: $viewModel.searchText, placeholder: "Filter logs...")
                    .frame(maxWidth: 300)

                Spacer()

                // Level filter
                Picker("", selection: $viewModel.selectedLevel) {
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
                .frame(width: 110)
            }

            Divider()

            // Log content area
            ZStack {
                Color.surfaceTertiary
                    .ignoresSafeArea()

                let currentLogs = viewModel.filteredLogs

                ScrollViewReader { proxy in
                    ScrollView {
                        Text(currentLogs)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(DesignTokens.spacingMD)
                            .id("bottom")
                    }
                    .id("\(viewModel.selectedLevel.rawValue)-\(viewModel.searchText)")
                    .onChange(of: viewModel.logs) {
                        if viewModel.autoScroll {
                            withAnimation(.easeOut(duration: 0.2)) {
                                proxy.scrollTo("bottom", anchor: .bottom)
                            }
                        }
                    }
                }

                // Empty state overlay
                if currentLogs.isEmpty {
                    EmptyStateView(
                        icon: "terminal",
                        title: "No logs yet",
                        message: viewModel.searchText.isEmpty
                            ? "Logs will appear here when the bot is running"
                            : "No logs match your filter"
                    )
                }
            }

            Divider()

            // Footer
            FooterBar {
                // Service controls
                HStack(spacing: DesignTokens.spacingXS) {
                    IconButton(icon: "play.fill", label: "Start", disabled: viewModel.isRunning, action: viewModel.start)

                    IconButton(icon: "stop.fill", label: "Stop", disabled: !viewModel.isRunning, action: viewModel.stop)

                    IconButton(icon: "arrow.clockwise", label: "Restart", action: viewModel.restart)
                }

                Divider()
                    .frame(height: 20)

                // Line count
                HStack(spacing: DesignTokens.spacingXS) {
                    Image(systemName: "text.alignleft")
                        .font(.system(size: DesignTokens.iconSM))
                        .foregroundColor(Color.secondary.opacity(0.6))
                    Text("\(viewModel.lineCount) lines")
                        .font(.system(size: DesignTokens.fontSM, design: .monospaced))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                // Auto-scroll toggle
                Toggle(isOn: $viewModel.autoScroll) {
                    Text("Auto-scroll")
                        .font(.system(size: DesignTokens.fontSM))
                }
                .toggleStyle(.checkbox)
                .controlSize(.small)

                // Clear button
                ActionButton("Clear", icon: "trash", disabled: viewModel.logs.isEmpty) {
                    viewModel.clearLogs()
                }
            }
        }
    }
}

// Extend LogLevel with color
extension LogLevel {
    var color: Color {
        switch self {
        case .verbose: return .secondary
        case .debug: return .purple
        case .info: return .accentInfo
        case .warning: return .accentWarning
        case .error: return .accentError
        }
    }
}

// Keep ControlButton for backwards compatibility
struct ControlButton: View {
    let icon: String
    let label: String
    var disabled: Bool = false
    let action: () -> Void

    var body: some View {
        IconButton(icon: icon, label: label, disabled: disabled) {
            action()
        }
    }
}
