import Cocoa
import SwiftUI
import Factory

@Observable
final class ContextEditorViewModel {
    @ObservationIgnored
    @Injected(\.setupManager) private var setupManager

    private var allFiles: [ContextFile] = []
    var selectedFile: ContextFile?

    // Editor state
    var editorContent: String = ""

    var hasUnsavedChanges = false
    var showSaveAlert = false
    var isLoadingContent = false
    private var pendingFile: ContextFile?
    private var originalContent: String = ""

    init() {}

    func loadFiles() {
        var files: [ContextFile] = []

        // Add CLAUDE.md
        let claudeMdPath = "\(setupManager.projectPath)/CLAUDE.md"
        if FileManager.default.fileExists(atPath: claudeMdPath) {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: claudeMdPath),
               let size = attrs[.size] as? Int {
                files.append(ContextFile(
                    name: "CLAUDE.md",
                    path: claudeMdPath,
                    size: size,
                    fileType: .claudeMd,
                    friendlyName: nil
                ))
            }
        }

        // Add channel memory files from data/context/channels/{channelId}/context.md
        let channelsPath = "\(setupManager.projectPath)/data/context/channels"
        if let channelDirs = try? FileManager.default.contentsOfDirectory(atPath: channelsPath) {
            for channelId in channelDirs {
                guard !channelId.hasPrefix(".") else { continue }
                let contextPath = "\(channelsPath)/\(channelId)/context.md"
                guard FileManager.default.fileExists(atPath: contextPath) else { continue }
                if let attrs = try? FileManager.default.attributesOfItem(atPath: contextPath),
                   let size = attrs[.size] as? Int {
                    files.append(ContextFile(
                        name: channelId,
                        path: contextPath,
                        size: size,
                        fileType: .channelMemory,
                        friendlyName: nil
                    ))
                }
            }
        }

        // Add user memory files from data/context/users/{userId}/context.md
        let usersPath = "\(setupManager.projectPath)/data/context/users"
        if let userDirs = try? FileManager.default.contentsOfDirectory(atPath: usersPath) {
            for userId in userDirs {
                guard !userId.hasPrefix(".") else { continue }
                let contextPath = "\(usersPath)/\(userId)/context.md"
                guard FileManager.default.fileExists(atPath: contextPath) else { continue }
                if let attrs = try? FileManager.default.attributesOfItem(atPath: contextPath),
                   let size = attrs[.size] as? Int {
                    files.append(ContextFile(
                        name: userId,
                        path: contextPath,
                        size: size,
                        fileType: .userMemory,
                        friendlyName: nil
                    ))
                }
            }
        }

        allFiles = files.sorted { $0.sortOrder < $1.sortOrder || ($0.sortOrder == $1.sortOrder && $0.name < $1.name) }

        // Auto-select CLAUDE.md if nothing selected
        if selectedFile == nil, let claudeMd = files.first(where: { $0.fileType == .claudeMd }) {
            selectFile(claudeMd)
        }
    }

    func selectFile(_ file: ContextFile) {
        selectedFile = file
        loadFileContent(file)
    }

    /// Load a file directly by path (used from sidebar navigation)
    func loadFile(at path: String, displayName: String? = nil) {
        let fileType: ContextFileType
        if path.contains("CLAUDE.md") {
            fileType = .claudeMd
        } else if path.contains("/channels/") {
            fileType = .channelMemory
        } else if path.contains("/users/") {
            fileType = .userMemory
        } else {
            fileType = .claudeMd
        }

        let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
        let file = ContextFile(
            name: (path as NSString).lastPathComponent,
            path: path,
            size: size,
            fileType: fileType,
            friendlyName: displayName
        )
        selectFile(file)
    }

    func loadFileContent(_ file: ContextFile) {
        isLoadingContent = true
        if let content = try? String(contentsOfFile: file.path, encoding: .utf8) {
            originalContent = content
            editorContent = content
        }
        hasUnsavedChanges = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.isLoadingContent = false
        }
    }

    func saveFile() {
        guard let file = selectedFile else { return }
        do {
            try editorContent.write(toFile: file.path, atomically: true, encoding: .utf8)
            originalContent = editorContent
            hasUnsavedChanges = false
            loadFiles()
        } catch {
            print("Failed to save: \(error)")
        }
    }

    func revertFile() {
        guard let file = selectedFile else { return }
        loadFileContent(file)
    }

    func contentDidChange() {
        if !isLoadingContent {
            hasUnsavedChanges = editorContent != originalContent
        }
    }

    func discardChanges() {
        hasUnsavedChanges = false
        if let pending = pendingFile {
            pendingFile = nil
            selectFile(pending)
        }
    }

    /// Reload file content from disk
    func reloadFromDisk() {
        guard let file = selectedFile else { return }
        loadFileContent(file)
    }
}
