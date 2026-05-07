import SwiftUI

enum UserDetailTab: String, CaseIterable {
    case context = "Context"
    case config = "Config"

    var icon: String {
        switch self {
        case .context: return "doc.text"
        case .config: return "gearshape"
        }
    }
}

struct UserDetailView: View {
    let user: SidebarUser
    let contextViewModel: ContextViewModel
    let configViewModel: UserConfigViewModel

    @State private var selectedTab: UserDetailTab = .context
    @State private var showDeleteConfirmation = false

    init(user: SidebarUser, contextViewModel: ContextViewModel) {
        self.user = user
        self.contextViewModel = contextViewModel

        // Derive config path from context.md path
        let contextURL = URL(fileURLWithPath: user.filePath)
        let configPath = contextURL.deletingLastPathComponent().appendingPathComponent("config.json").path
        self.configViewModel = UserConfigViewModel(configPath: configPath)
    }

    private var folderURL: URL {
        URL(fileURLWithPath: user.filePath).deletingLastPathComponent()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: DesignTokens.spacingXS) {
                ForEach(UserDetailTab.allCases, id: \.self) { tab in
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
                    .help("Delete User")
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
                UserConfigView(viewModel: configViewModel)
            }
        }
        .id(user.id) // Force view recreation when user changes
        .alert("Delete User", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) {
                deleteUser()
            }
        } message: {
            Text("Are you sure you want to delete \"\(user.label)\"? This will remove all context and configuration for this user.")
        }
    }

    private func deleteUser() {
        do {
            try FileManager.default.removeItem(at: folderURL)
            // Notify sidebar to refresh
            NotificationCenter.default.post(name: .channelConfigDidSave, object: nil)
        } catch {
            print("Failed to delete user folder: \(error)")
        }
    }
}

// MARK: - User Config ViewModel

@Observable
@MainActor
class UserConfigViewModel {
    let configPath: String

    // User settings
    var displayName: String = ""

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
        displayName = ""

        guard let data = FileManager.default.contents(atPath: configPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        displayName = json["displayName"] as? String ?? ""
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
        existingConfig["displayName"] = displayName.isEmpty ? nil : displayName

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
}

// MARK: - User Config View

struct UserConfigView: View {
    @Bindable var viewModel: UserConfigViewModel

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView("Loading config...")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DesignTokens.spacingLG) {
                        // User Info Section
                        ConfigSection(title: "User Info", icon: "person.fill") {
                            LabeledTextField(label: "Display Name", text: $viewModel.displayName, placeholder: "John Doe")
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
