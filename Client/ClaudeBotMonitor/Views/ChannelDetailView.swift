import SwiftUI

extension Notification.Name {
    static let channelConfigDidSave = Notification.Name("channelConfigDidSave")
}

enum ClaudeModel: String, CaseIterable {
    case haiku = "haiku"
    case sonnet = "sonnet"
    case opus = "opus"

    var displayName: String {
        switch self {
        case .haiku: return "Haiku"
        case .sonnet: return "Sonnet"
        case .opus: return "Opus"
        }
    }
}

enum ChannelDetailTab: String, CaseIterable {
    case context = "Context"
    case config = "Config"

    var icon: String {
        switch self {
        case .context: return "doc.text"
        case .config: return "gearshape"
        }
    }
}

struct ChannelDetailView: View {
    let channel: SidebarChannel
    let contextViewModel: ContextViewModel
    let configViewModel: ChannelConfigViewModel
    @State private var selectedTab: ChannelDetailTab = .context
    @State private var showDeleteConfirmation = false

    init(channel: SidebarChannel, contextViewModel: ContextViewModel) {
        self.channel = channel
        self.contextViewModel = contextViewModel

        // Derive config path from context.md path
        let contextURL = URL(fileURLWithPath: channel.filePath)
        let configPath = contextURL.deletingLastPathComponent().appendingPathComponent("config.json").path
        self.configViewModel = ChannelConfigViewModel(configPath: configPath)
    }

    private var folderURL: URL {
        URL(fileURLWithPath: channel.filePath).deletingLastPathComponent()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: DesignTokens.spacingXS) {
                ForEach(ChannelDetailTab.allCases, id: \.self) { tab in
                    ModernTabButton(
                        title: tab.rawValue,
                        icon: tab.icon,
                        isSelected: selectedTab == tab
                    ) {
                        selectedTab = tab
                    }
                }

                Spacer()

                HStack(spacing: 2) {
                    Button {
                        contextViewModel.editorViewModel.reloadFromDisk()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .font(.system(size: 12))
                    }
                    .buttonStyle(.accessoryBar)
                    .help("Refresh from disk")

                    Button {
                        NSWorkspace.shared.open(folderURL)
                    } label: {
                        Label("Finder", systemImage: "folder")
                            .font(.system(size: 12))
                    }
                    .buttonStyle(.accessoryBar)
                    .help("Open in Finder")

                    Button {
                        showDeleteConfirmation = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                            .font(.system(size: 12))
                    }
                    .buttonStyle(.accessoryBar)
                    .help("Delete Channel")
                }
            }
            .padding(.horizontal, DesignTokens.spacingMD)
            .padding(.vertical, DesignTokens.spacingSM)
            .frame(height: 44)
            .background(.bar)

            Divider()

            // Tab content
            switch selectedTab {
            case .context:
                ContextEditorView(contextViewModel: contextViewModel)
            case .config:
                ChannelConfigView(viewModel: configViewModel)
            }
        }
        .id(channel.id) // Force view recreation when channel changes
        .alert("Delete Channel", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) {
                deleteChannel()
            }
        } message: {
            Text("Are you sure you want to delete \"\(channel.label)\"? This will remove all context and configuration for this channel.")
        }
    }

    private func deleteChannel() {
        do {
            try FileManager.default.removeItem(at: folderURL)
            // Notify sidebar to refresh
            NotificationCenter.default.post(name: .channelConfigDidSave, object: nil)
        } catch {
            print("Failed to delete channel folder: \(error)")
        }
    }
}

// MARK: - Channel Config ViewModel

@Observable
@MainActor
class ChannelConfigViewModel {
    let configPath: String

    // Channel settings
    var name: String = ""
    var claudeModelThinking: String = ""
    var claudeModelQuick: String = ""
    var summaryThreshold: String = ""  // Empty = use global default (51200)

    // Integrations
    var jira: [JiraConfigItem] = []
    var confluence: [ConfluenceConfigItem] = []
    var notebookLm: [NotebookLmConfigItem] = []

    var isLoading = true
    var isSaving = false
    var errorMessage: String?
    var showSavedMessage = false

    init(configPath: String) {
        self.configPath = configPath
        loadConfig()
    }

    func loadConfig() {
        isLoading = true
        defer { isLoading = false }

        // Reset to defaults
        name = ""
        claudeModelThinking = ""
        claudeModelQuick = ""
        summaryThreshold = ""
        jira = []
        confluence = []
        notebookLm = []

        guard let data = FileManager.default.contents(atPath: configPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        name = json["name"] as? String ?? ""
        claudeModelThinking = json["claudeModelThinking"] as? String ?? ""
        claudeModelQuick = json["claudeModelQuick"] as? String ?? ""

        // Handle summaryThreshold as either number or string
        if let threshold = json["summaryThreshold"] as? Int {
            summaryThreshold = String(threshold)
        } else if let threshold = json["summaryThreshold"] as? String {
            summaryThreshold = threshold
        }

        // Parse Jira array
        if let jiraArray = json["jira"] as? [[String: Any]] {
            jira = jiraArray.map { item in
                JiraConfigItem(
                    project: item["project"] as? String ?? "",
                    site: item["site"] as? String ?? ""
                )
            }
        }

        // Parse Confluence array
        if let confArray = json["confluence"] as? [[String: Any]] {
            confluence = confArray.map { item in
                ConfluenceConfigItem(
                    space: item["space"] as? String ?? "",
                    spaceId: item["spaceId"] as? String ?? "",
                    cloudId: item["cloudId"] as? String ?? "",
                    homepageId: item["homepageId"] as? String ?? ""
                )
            }
        }

        // Parse NotebookLM array
        if let nbArray = json["notebookLm"] as? [[String: Any]] {
            notebookLm = nbArray.map { item in
                NotebookLmConfigItem(
                    url: item["url"] as? String ?? "",
                    name: item["name"] as? String ?? "",
                    description: item["description"] as? String ?? "",
                    profile: item["profile"] as? String ?? ""
                )
            }
        }
    }

    func saveConfig() {
        isSaving = true
        errorMessage = nil

        // Load existing config to preserve type, id, name
        var existingConfig: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: configPath),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            existingConfig = json
        }

        // Update with new values
        existingConfig["name"] = name.isEmpty ? nil : name
        existingConfig["claudeModelThinking"] = claudeModelThinking.isEmpty ? nil : claudeModelThinking
        existingConfig["claudeModelQuick"] = claudeModelQuick.isEmpty ? nil : claudeModelQuick

        // Save summaryThreshold as number if valid, otherwise nil
        if let thresholdInt = Int(summaryThreshold), thresholdInt > 0 {
            existingConfig["summaryThreshold"] = thresholdInt
        } else {
            existingConfig["summaryThreshold"] = nil
        }

        // Jira
        let jiraArray = jira.filter { !$0.project.isEmpty }.map { item -> [String: String] in
            ["project": item.project, "site": item.site]
        }
        existingConfig["jira"] = jiraArray.isEmpty ? nil : jiraArray

        // Confluence
        let confArray = confluence.filter { !$0.space.isEmpty }.map { item -> [String: String] in
            var dict = ["space": item.space, "spaceId": item.spaceId, "cloudId": item.cloudId]
            if !item.homepageId.isEmpty { dict["homepageId"] = item.homepageId }
            return dict
        }
        existingConfig["confluence"] = confArray.isEmpty ? nil : confArray

        // NotebookLM
        let nbArray = notebookLm.filter { !$0.url.isEmpty }.map { item -> [String: String] in
            var dict = ["url": item.url]
            if !item.name.isEmpty { dict["name"] = item.name }
            if !item.description.isEmpty { dict["description"] = item.description }
            if !item.profile.isEmpty { dict["profile"] = item.profile }
            return dict
        }
        existingConfig["notebookLm"] = nbArray.isEmpty ? nil : nbArray

        // Remove nil values
        existingConfig = existingConfig.compactMapValues { $0 }

        do {
            let data = try JSONSerialization.data(withJSONObject: existingConfig, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: URL(fileURLWithPath: configPath))
            withAnimation {
                showSavedMessage = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [self] in
                withAnimation {
                    showSavedMessage = false
                }
            }
            // Notify sidebar to refresh
            NotificationCenter.default.post(name: .channelConfigDidSave, object: nil)
        } catch {
            errorMessage = error.localizedDescription
        }

        isSaving = false
    }

    func addJira() {
        jira.append(JiraConfigItem())
    }

    func removeJira(at index: Int) {
        jira.remove(at: index)
    }

    func addConfluence() {
        confluence.append(ConfluenceConfigItem())
    }

    func removeConfluence(at index: Int) {
        confluence.remove(at: index)
    }

    func addNotebookLm() {
        notebookLm.append(NotebookLmConfigItem())
    }

    func removeNotebookLm(at index: Int) {
        notebookLm.remove(at: index)
    }
}

// MARK: - Channel Config View

struct ChannelConfigView: View {
    @Bindable var viewModel: ChannelConfigViewModel

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView("Loading config...")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DesignTokens.spacingLG) {
                        // Channel Info Section
                        ConfigSection(title: "Channel Info", icon: "number") {
                            LabeledTextField(label: "Name", text: $viewModel.name, placeholder: "general")
                        }

                        // Bot Settings Section
                        ConfigSection(title: "Bot Settings", icon: "gearshape") {
                            LabeledModelPicker(label: "Thinking Model", selection: $viewModel.claudeModelThinking)
                            LabeledModelPicker(label: "Quick Model", selection: $viewModel.claudeModelQuick)
                            LabeledTextField(
                                label: "Summary Threshold",
                                text: $viewModel.summaryThreshold,
                                placeholder: "51200 (default)"
                            )
                            Text("Bytes before auto-summarization. Leave empty for global default.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        // Jira Section
                        ConfigSection(title: "Jira", icon: "list.bullet.rectangle") {
                            ForEach(viewModel.jira.indices, id: \.self) { index in
                                JiraConfigRow(config: $viewModel.jira[index]) {
                                    viewModel.removeJira(at: index)
                                }
                            }
                            Button {
                                viewModel.addJira()
                            } label: {
                                Label("Add Jira Project", systemImage: "plus.circle")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.blue)
                        }

                        // Confluence Section
                        ConfigSection(title: "Confluence", icon: "doc.richtext") {
                            ForEach(viewModel.confluence.indices, id: \.self) { index in
                                ConfluenceConfigRow(config: $viewModel.confluence[index]) {
                                    viewModel.removeConfluence(at: index)
                                }
                            }
                            Button {
                                viewModel.addConfluence()
                            } label: {
                                Label("Add Confluence Space", systemImage: "plus.circle")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.blue)
                        }

                        // NotebookLM Section
                        ConfigSection(title: "NotebookLM", icon: "book.closed") {
                            ForEach(viewModel.notebookLm.indices, id: \.self) { index in
                                NotebookLmConfigRow(config: $viewModel.notebookLm[index]) {
                                    viewModel.removeNotebookLm(at: index)
                                }
                            }
                            Button {
                                viewModel.addNotebookLm()
                            } label: {
                                Label("Add Notebook", systemImage: "plus.circle")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.blue)
                        }

                        // Save button
                        HStack {
                            Spacer()
                            if viewModel.showSavedMessage {
                                Text("Saved!")
                                    .foregroundStyle(.green)
                                    .transition(.opacity)
                            }
                            Button("Save") {
                                viewModel.saveConfig()
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(viewModel.isSaving)
                        }
                        .padding(.top, DesignTokens.spacingMD)

                        if let error = viewModel.errorMessage {
                            Text(error)
                                .foregroundStyle(.red)
                                .font(.caption)
                        }
                    }
                    .padding(DesignTokens.spacingLG)
                }
            }
        }
    }
}

// MARK: - Config Item Models

struct JiraConfigItem: Identifiable {
    let id = UUID()
    var project: String = ""
    var site: String = ""
}

struct ConfluenceConfigItem: Identifiable {
    let id = UUID()
    var space: String = ""
    var spaceId: String = ""
    var cloudId: String = ""
    var homepageId: String = ""
}

struct NotebookLmConfigItem: Identifiable {
    let id = UUID()
    var url: String = ""
    var name: String = ""
    var description: String = ""
    var profile: String = ""
}

// MARK: - Config UI Components

struct ConfigSection<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingSM) {
            Label(title, systemImage: icon)
                .font(.headline)

            VStack(alignment: .leading, spacing: DesignTokens.spacingSM) {
                content
            }
            .padding(DesignTokens.spacingMD)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)
        }
    }
}

struct LabeledTextField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        HStack {
            Text(label)
                .frame(width: 120, alignment: .leading)
            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

struct LabeledModelPicker: View {
    let label: String
    @Binding var selection: String

    var body: some View {
        HStack {
            Text(label)
                .frame(width: 120, alignment: .leading)
            Picker("", selection: $selection) {
                Text("Not Set").tag("")
                ForEach(ClaudeModel.allCases, id: \.rawValue) { model in
                    Text(model.displayName).tag(model.rawValue)
                }
            }
            .labelsHidden()
            .fixedSize()
        }
    }
}

struct JiraConfigRow: View {
    @Binding var config: JiraConfigItem
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.spacingSM) {
            VStack(alignment: .leading, spacing: 4) {
                LabeledTextField(label: "Project", text: $config.project, placeholder: "RECORD")
                LabeledTextField(label: "Site", text: $config.site, placeholder: "company.atlassian.net")
            }
            Button(role: .destructive) {
                onDelete()
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, DesignTokens.spacingXS)
    }
}

struct ConfluenceConfigRow: View {
    @Binding var config: ConfluenceConfigItem
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.spacingSM) {
            VStack(alignment: .leading, spacing: 4) {
                LabeledTextField(label: "Space", text: $config.space, placeholder: "Record")
                LabeledTextField(label: "Space ID", text: $config.spaceId, placeholder: "123456789")
                LabeledTextField(label: "Cloud ID", text: $config.cloudId, placeholder: "uuid")
                LabeledTextField(label: "Homepage ID", text: $config.homepageId, placeholder: "optional")
            }
            Button(role: .destructive) {
                onDelete()
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, DesignTokens.spacingXS)
    }
}

struct NotebookLmConfigRow: View {
    @Binding var config: NotebookLmConfigItem
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.spacingSM) {
            VStack(alignment: .leading, spacing: 4) {
                LabeledTextField(label: "URL", text: $config.url, placeholder: "https://notebooklm.google.com/...")
                LabeledTextField(label: "Name", text: $config.name, placeholder: "Requirements")
                LabeledTextField(label: "Description", text: $config.description, placeholder: "What this notebook contains")
                LabeledTextField(label: "Profile", text: $config.profile, placeholder: "minimal")
            }
            Button(role: .destructive) {
                onDelete()
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, DesignTokens.spacingXS)
    }
}
