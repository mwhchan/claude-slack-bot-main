import Foundation
import SwiftUI
import Factory

private struct ContextConfig: Codable {
    let id: String
    let name: String?
    let displayName: String?
}

enum NotificationType {
    case none
    case newMessage   // Blue indicator
    case aiReply      // Orange indicator
}

@Observable
@MainActor
final class MainCoordinator {
    @ObservationIgnored
    @Injected(\.setupManager) private var setupManager
    @ObservationIgnored
    @Injected(\.slackService) private var slackService

    var selectedItem: NavigationSelection? = .dashboard

    // MARK: - Menu Bar Indicator

    var currentNotification: NotificationType = .none
    var isWindowVisible: Bool = false

    var shouldShowNotification: Bool {
        !isWindowVisible && currentNotification != .none
    }

    func showNotification(_ type: NotificationType) {
        currentNotification = type
    }

    var showingSetup: Bool = false

    // Add dialog state
    var showingAddDialog: Bool = false
    var addURLInput: String = ""
    var addErrorMessage: String?
    var isAddingResource: Bool = false

    // Settings tab selection
    enum SettingsTab {
        case settings
        case claudeMd
        case slackSkill
    }
    var selectedSettingsTab: SettingsTab = .settings

    // Sidebar items
    var channels: [SidebarChannel] = []
    var users: [SidebarUser] = []

    // Dashboard ViewModels
    let dialogViewModel = DialogViewModel()
    let logsViewModel = LogsViewModel()
    let logWebViewModel = LogWebViewModel()

    // Context ViewModels cache - keyed by file path
    private var contextViewModelCache: [String: ContextViewModel] = [:]

    // File system watchers for auto-refresh
    @ObservationIgnored
    private var channelsWatcher: DispatchSourceFileSystemObject?
    @ObservationIgnored
    private var usersWatcher: DispatchSourceFileSystemObject?

    init() {
        if setupManager.needsSetup {
            showingSetup = true
            selectedItem = .settings
        }
        loadSidebarItems()
        startWatchingContextFolders()
        startListeningForConfigChanges()
        startListeningForNotifications()
    }

    private func startListeningForNotifications() {
        NotificationCenter.default.addObserver(forName: MonitorWebSocketService.newMessageNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.showNotification(.newMessage) }
        }
        NotificationCenter.default.addObserver(forName: MonitorWebSocketService.aiReplyNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.showNotification(.aiReply) }
        }
    }

    private func startListeningForConfigChanges() {
        NotificationCenter.default.addObserver(
            forName: Notification.Name("channelConfigDidSave"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.loadSidebarItems()
            }
        }
    }

    // MARK: - File System Watching

    private func startWatchingContextFolders() {
        let channelsPath = "\(setupManager.projectPath)/data/context/channels"
        let usersPath = "\(setupManager.projectPath)/data/context/users"

        channelsWatcher = createFolderWatcher(path: channelsPath) { [weak self] in
            Task { @MainActor in
                self?.loadChannels()
            }
        }

        usersWatcher = createFolderWatcher(path: usersPath) { [weak self] in
            Task { @MainActor in
                self?.loadUsers()
            }
        }
    }

    private nonisolated func createFolderWatcher(path: String, onChange: @escaping () -> Void) -> DispatchSourceFileSystemObject? {
        // Ensure folder exists
        try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)

        let fd = open(path, O_EVTONLY)
        guard fd >= 0 else { return nil }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .delete, .rename],
            queue: .main
        )

        source.setEventHandler {
            onChange()
        }

        source.setCancelHandler {
            close(fd)
        }

        source.resume()
        return source
    }

    // MARK: - Sidebar Loading

    func loadSidebarItems() {
        loadChannels()
        loadUsers()
    }

    private func loadChannels() {
        let channelsPath = "\(setupManager.projectPath)/data/context/channels"
        guard let dirs = try? FileManager.default.contentsOfDirectory(atPath: channelsPath) else {
            channels = []
            return
        }

        channels = dirs
            .filter { !$0.hasPrefix(".") }
            .compactMap { channelId -> SidebarChannel? in
                let folderPath = "\(channelsPath)/\(channelId)"
                let contextPath = "\(folderPath)/context.md"
                guard FileManager.default.fileExists(atPath: contextPath) else { return nil }

                let config = loadConfig(from: "\(folderPath)/config.json")
                return SidebarChannel(
                    id: channelId,
                    filePath: contextPath,
                    name: config?.name
                )
            }
            .sorted { $0.label < $1.label }
    }

    private func loadUsers() {
        let usersPath = "\(setupManager.projectPath)/data/context/users"
        guard let dirs = try? FileManager.default.contentsOfDirectory(atPath: usersPath) else {
            users = []
            return
        }

        users = dirs
            .filter { !$0.hasPrefix(".") }
            .compactMap { userId -> SidebarUser? in
                let folderPath = "\(usersPath)/\(userId)"
                let contextPath = "\(folderPath)/context.md"
                guard FileManager.default.fileExists(atPath: contextPath) else { return nil }

                let config = loadConfig(from: "\(folderPath)/config.json")
                return SidebarUser(
                    id: userId,
                    filePath: contextPath,
                    displayName: config?.displayName ?? config?.name
                )
            }
            .sorted { $0.label < $1.label }
    }

    private func loadConfig(from path: String) -> ContextConfig? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONDecoder().decode(ContextConfig.self, from: data)
    }

    // MARK: - Context ViewModel Cache

    /// Get or create a cached ContextViewModel for a file path
    func contextViewModel(for filePath: String, fileName: String) -> ContextViewModel {
        if let cached = contextViewModelCache[filePath] {
            return cached
        }

        let viewModel = ContextViewModel(filePath: filePath, fileName: fileName)
        contextViewModelCache[filePath] = viewModel
        return viewModel
    }

    /// Clear all cached view models (useful for memory management or refresh)
    func clearContextCache() {
        contextViewModelCache.removeAll()
    }

    /// Clear a specific cached view model
    func clearContextCache(for filePath: String) {
        contextViewModelCache.removeValue(forKey: filePath)
    }

    func claudeMdPath() -> String {
        "\(setupManager.projectPath)/CLAUDE.md"
    }

    var hasClaudeMd: Bool {
        FileManager.default.fileExists(atPath: claudeMdPath())
    }

    func slackSkillPath() -> String {
        "\(setupManager.projectPath)/.claude/skills/slack-responder/SKILL.md"
    }

    var hasSlackSkill: Bool {
        FileManager.default.fileExists(atPath: slackSkillPath())
    }

    func selectSettingsTab(_ tab: SettingsTab) {
        selectedSettingsTab = tab
    }

    // MARK: - ViewModel Creation

    func makeSettingsViewModel() -> SettingsViewModel {
        SettingsViewModel()
    }

    func makeSetupViewModel() -> SetupViewModel {
        let viewModel = SetupViewModel()
        viewModel.onSetupComplete = { [weak self] in
            self?.showingSetup = false
        }
        return viewModel
    }

    // MARK: - Navigation

    func showSettings() {
        showingSetup = false
    }

    func showSetup() {
        showingSetup = true
    }

    // MARK: - Add Resource

    func showAddDialog() {
        addURLInput = ""
        addErrorMessage = nil
        showingAddDialog = true
    }

    func dismissAddDialog() {
        showingAddDialog = false
        addURLInput = ""
        addErrorMessage = nil
    }

    func addResource() {
        guard !addURLInput.isEmpty else { return }

        isAddingResource = true
        addErrorMessage = nil

        Task {
            do {
                let result = try await slackService.addFromURL(addURLInput)

                // Select the newly added item
                switch result {
                case .channel(let id, _):
                    loadChannels()
                    selectedItem = .channel(id: id)
                case .user(let id, _):
                    loadUsers()
                    selectedItem = .user(id: id)
                }

                dismissAddDialog()
            } catch {
                addErrorMessage = error.localizedDescription
            }

            isAddingResource = false
        }
    }
}
