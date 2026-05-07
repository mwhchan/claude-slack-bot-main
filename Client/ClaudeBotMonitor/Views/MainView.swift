import SwiftUI
import Factory

struct MainView: View {
    @Bindable var coordinator: MainCoordinator
    @Injected(\.botService) private var botService
    @Injected(\.setupManager) private var setupManager

    // Collapsible section states
    @State private var isChannelsExpanded = true
    @State private var isUsersExpanded = true

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(250)
        } detail: {
            detailView
        }
        .preventSidebarCollapse()
        .onAppear {
            coordinator.loadSidebarItems()
        }
    }

    // MARK: - Sidebar

    @ViewBuilder
    private var sidebar: some View {
        List(selection: $coordinator.selectedItem) {
            // Main section
            Section {
                NavigationLink(value: NavigationSelection.dashboard) {
                    Label("Dashboard", systemImage: "gauge")
                }

                NavigationLink(value: NavigationSelection.settings) {
                    Label("Settings", systemImage: "gear")
                }
            }

            // Channels section (collapsible)
            if !coordinator.channels.isEmpty {
                Section("Channels", isExpanded: $isChannelsExpanded.animation(nil)) {
                    ForEach(coordinator.channels) { channel in
                        NavigationLink(value: NavigationSelection.channel(id: channel.id)) {
                            Label(channel.label, systemImage: "number")
                        }
                    }
                }
            }

            // Users section (collapsible)
            if !coordinator.users.isEmpty {
                Section("Users", isExpanded: $isUsersExpanded.animation(nil)) {
                    ForEach(coordinator.users) { user in
                        NavigationLink(value: NavigationSelection.user(id: user.id)) {
                            Label(user.label, systemImage: "person.fill")
                        }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            sidebarFooter
        }
        .toolbar(removing: .sidebarToggle)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Spacer()

                Button {
                    coordinator.showAddDialog()
                } label: {
                    Image(systemName: "plus")
                }
                .help("Add Channel or User")
            }
        }
        .sheet(isPresented: $coordinator.showingAddDialog) {
            AddResourceSheet(coordinator: coordinator)
        }

    }

    @ViewBuilder
    private var sidebarFooter: some View {
        VStack(spacing: DesignTokens.spacingSM) {
            Divider()

            HStack(spacing: DesignTokens.spacingSM) {
                Circle()
                    .fill(botService.isRunning ? Color.green : Color.red.opacity(0.6))
                    .frame(width: 8, height: 8)

                Text(botService.isRunning ? "Running" : "Stopped")
                    .font(.system(size: DesignTokens.fontMD))
                    .foregroundStyle(.secondary)

                Spacer()

                Button {
                    if botService.isRunning {
                        botService.stop()
                    } else {
                        botService.start()
                    }
                } label: {
                    Image(systemName: botService.isRunning ? "stop.fill" : "play.fill")
                        .font(.system(size: DesignTokens.iconMD))
                }
                .buttonStyle(.borderless)
                .help(botService.isRunning ? "Stop bot" : "Start bot")

                Button {
                    botService.restart()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: DesignTokens.iconMD))
                }
                .buttonStyle(.borderless)
                .help("Restart bot")
            }
            .padding(.horizontal, DesignTokens.spacingMD)
            .padding(.bottom, DesignTokens.spacingSM)
        }
        .background(.bar)
    }

    // MARK: - Detail View

    @ViewBuilder
    private var detailView: some View {
        switch coordinator.selectedItem {
        case .dashboard:
            MonitorView(
                dialogViewModel: coordinator.dialogViewModel,
                logsViewModel: coordinator.logsViewModel,
                logWebViewModel: coordinator.logWebViewModel
            )

        case .settings:
            settingsDetailView

        case .channel(let id):
            if let channel = coordinator.channels.first(where: { $0.id == id }) {
                let vm = coordinator.contextViewModel(
                    for: channel.filePath,
                    fileName: channel.label
                )
                ChannelDetailView(channel: channel, contextViewModel: vm)
            }

        case .user(let id):
            if let user = coordinator.users.first(where: { $0.id == id }) {
                let vm = coordinator.contextViewModel(
                    for: user.filePath,
                    fileName: user.label
                )
                UserDetailView(user: user, contextViewModel: vm)
            }

        case nil:
            ContentUnavailableView(
                "Select an item",
                systemImage: "sidebar.left",
                description: Text("Choose an item from the sidebar")
            )
        }
    }

    @ViewBuilder
    private var settingsDetailView: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: DesignTokens.spacingXS) {
                ModernTabButton(
                    title: "Settings",
                    icon: "gear",
                    isSelected: coordinator.selectedSettingsTab == .settings && !coordinator.showingSetup
                ) {
                    coordinator.selectSettingsTab(.settings)
                    coordinator.showSettings()
                }

                if setupManager.needsSetup {
                    ModernTabButton(
                        title: "Setup",
                        icon: "gearshape.2.fill",
                        isSelected: coordinator.showingSetup
                    ) {
                        coordinator.showSetup()
                    }
                }

                if coordinator.hasClaudeMd {
                    ModernTabButton(
                        title: "CLAUDE.md",
                        icon: "staroflife.fill",
                        isSelected: coordinator.selectedSettingsTab == .claudeMd && !coordinator.showingSetup
                    ) {
                        coordinator.selectSettingsTab(.claudeMd)
                        coordinator.showSettings()
                    }
                }

                if coordinator.hasSlackSkill {
                    ModernTabButton(
                        title: "Slack Skills",
                        icon: "bubble.left.and.text.bubble.right.fill",
                        isSelected: coordinator.selectedSettingsTab == .slackSkill && !coordinator.showingSetup
                    ) {
                        coordinator.selectSettingsTab(.slackSkill)
                        coordinator.showSettings()
                    }
                }

                Spacer()
            }
            .padding(.horizontal, DesignTokens.spacingMD)
            .padding(.vertical, DesignTokens.spacingSM)
            .frame(height: 44)
            .background(.bar)

            Divider()

            // Content
            if coordinator.showingSetup {
                SetupView(viewModel: coordinator.makeSetupViewModel())
            } else {
                switch coordinator.selectedSettingsTab {
                case .settings:
                    SettingsView(viewModel: coordinator.makeSettingsViewModel())
                case .claudeMd:
                    let vm = coordinator.contextViewModel(
                        for: coordinator.claudeMdPath(),
                        fileName: "CLAUDE.md"
                    )
                    ContextEditorView(contextViewModel: vm)
                case .slackSkill:
                    let vm = coordinator.contextViewModel(
                        for: coordinator.slackSkillPath(),
                        fileName: "Slack Responder"
                    )
                    ContextEditorView(contextViewModel: vm)
                }
            }
        }
    }
}

// MARK: - Add Resource Sheet

struct AddResourceSheet: View {
    @Bindable var coordinator: MainCoordinator
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: DesignTokens.spacingLG) {
            // Header
            HStack {
                Text("Add Channel or User")
                    .font(.headline)
                Spacer()
                Button {
                    coordinator.dismissAddDialog()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }

            // Input field
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                Text("Paste Slack URL or ID")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                TextField("https://workspace.slack.com/archives/C...", text: $coordinator.addURLInput)
                    .textFieldStyle(.roundedBorder)
                    .focused($isInputFocused)
                    .onSubmit {
                        coordinator.addResource()
                    }

                VStack(alignment: .leading, spacing: 2) {
                    Text("Channel: URL or ID (C...)")
                    Text("User: Click name → ⋮ → Copy member ID (U...)")
                }
                .font(.caption)
                .foregroundStyle(.tertiary)
            }

            // Error message
            if let error = coordinator.addErrorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            }

            // Actions
            HStack {
                Spacer()

                Button("Cancel") {
                    coordinator.dismissAddDialog()
                }
                .keyboardShortcut(.escape)

                Button("Add") {
                    coordinator.addResource()
                }
                .keyboardShortcut(.return)
                .disabled(coordinator.addURLInput.isEmpty || coordinator.isAddingResource)
            }
        }
        .padding(DesignTokens.spacingLG)
        .frame(width: 400)
        .onAppear {
            isInputFocused = true
        }
    }
}
