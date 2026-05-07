import Foundation
import Factory

struct ChatMessage: Identifiable, Codable {
    let id: UUID
    let role: ChatRole
    let content: String
    let timestamp: Date

    enum ChatRole: String, Codable {
        case user
        case assistant
        case system
    }

    init(role: ChatRole, content: String, timestamp: Date) {
        self.id = UUID()
        self.role = role
        self.content = content
        self.timestamp = timestamp
    }
}

@Observable
final class ClaudeService {
    @ObservationIgnored
    @Injected(\.setupManager) private var setupManager

    private var currentProcess: Process?
    private var outputPipe: Pipe?

    var isRunning: Bool = false
    var currentResponse: String = ""
    var error: String?

    // Track active sessions per context file
    private var activeSessions: Set<String> = []

    private var projectPath: String { setupManager.projectPath }
    private var chatsDirectory: String { "\(projectPath)/data/system/chats" }

    /// Send a message, using --continue if session exists
    func sendMessage(
        prompt: String,
        context: String?,
        sessionId: String,
        onUpdate: @escaping (String) -> Void,
        onComplete: @escaping (String) -> Void,
        onError: @escaping (String) -> Void
    ) {
        guard !isRunning else {
            onError("Claude is already processing a request")
            return
        }

        guard let claudePath = findClaudeExecutable() else {
            onError("Claude CLI not found. Please install it first.")
            return
        }

        isRunning = true
        currentResponse = ""
        error = nil

        // Check if we have an active session for this context
        let hasActiveSession = activeSessions.contains(sessionId)
        let sessionDir = "\(chatsDirectory)/\(sessionId)"

        // Ensure session directory exists
        try? FileManager.default.createDirectory(atPath: sessionDir, withIntermediateDirectories: true)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: claudePath)

        var args: [String] = []

        if hasActiveSession {
            // Continue existing conversation - just send the prompt
            args = [
                "-p", prompt,
                "--continue",
                "--model", "sonnet",
                "--output-format", "text",
                "--dangerously-skip-permissions"
            ]
        } else {
            // First message - include context
            var fullPrompt = ""
            if let context = context, !context.isEmpty {
                fullPrompt = """
                I'm going to share a context file with you. Please help me work on it.

                <context-file>
                \(context)
                </context-file>

                \(prompt)
                """
            } else {
                fullPrompt = prompt
            }

            args = [
                "-p", fullPrompt,
                "--model", "sonnet",
                "--output-format", "text",
                "--dangerously-skip-permissions"
            ]
        }

        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: sessionDir)

        // Set up environment with proper PATH
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = buildPathEnvironment()
        process.environment = env

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        outputPipe = pipe
        currentProcess = process

        // Read output asynchronously
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { return }

            if let output = String(data: data, encoding: .utf8) {
                DispatchQueue.main.async {
                    self?.currentResponse += output
                    onUpdate(self?.currentResponse ?? "")
                }
            }
        }

        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                self?.isRunning = false
                pipe.fileHandleForReading.readabilityHandler = nil

                if process.terminationStatus == 0 {
                    // Mark session as active after successful first message
                    self?.activeSessions.insert(sessionId)
                    self?.markSessionActive(sessionId)
                    onComplete(self?.currentResponse ?? "")
                } else {
                    let errorMsg = self?.currentResponse.isEmpty == true
                        ? "Claude exited with code \(process.terminationStatus)"
                        : self?.currentResponse ?? ""
                    self?.error = errorMsg
                    onError(errorMsg)
                }

                self?.currentProcess = nil
                self?.outputPipe = nil
            }
        }

        do {
            try process.run()
        } catch {
            isRunning = false
            let errorMsg = "Failed to start Claude: \(error.localizedDescription)"
            self.error = errorMsg
            onError(errorMsg)
        }
    }

    func cancel() {
        currentProcess?.terminate()
        isRunning = false
    }

    /// Check if a session exists for the given context
    func hasSession(for sessionId: String) -> Bool {
        activeSessions.contains(sessionId) || sessionExists(sessionId)
    }

    /// Clear a session (delete session directory)
    func clearSession(for sessionId: String) {
        activeSessions.remove(sessionId)
        let sessionDir = "\(chatsDirectory)/\(sessionId)"
        try? FileManager.default.removeItem(atPath: sessionDir)
    }

    /// Load session from disk if it exists
    func loadSessionIfExists(_ sessionId: String) {
        if sessionExists(sessionId) {
            activeSessions.insert(sessionId)
        }
    }

    /// Save messages to session file
    func saveMessages(_ messages: [ChatMessage], for sessionId: String) {
        let sessionDir = "\(chatsDirectory)/\(sessionId)"
        try? FileManager.default.createDirectory(atPath: sessionDir, withIntermediateDirectories: true)

        let messagesPath = "\(sessionDir)/messages.json"
        if let data = try? JSONEncoder().encode(messages) {
            try? data.write(to: URL(fileURLWithPath: messagesPath))
        }
    }

    /// Load messages from session file
    func loadMessages(for sessionId: String) -> [ChatMessage]? {
        let messagesPath = "\(chatsDirectory)/\(sessionId)/messages.json"
        guard let data = FileManager.default.contents(atPath: messagesPath),
              let messages = try? JSONDecoder().decode([ChatMessage].self, from: data) else {
            return nil
        }
        return messages
    }

    private func sessionExists(_ sessionId: String) -> Bool {
        let sessionDir = "\(chatsDirectory)/\(sessionId)"
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: sessionDir, isDirectory: &isDir) && isDir.boolValue
    }

    private func markSessionActive(_ sessionId: String) {
        let sessionDir = "\(chatsDirectory)/\(sessionId)"
        let markerPath = "\(sessionDir)/.active"
        FileManager.default.createFile(atPath: markerPath, contents: nil)
    }

    private func findClaudeExecutable() -> String? {
        let paths = [
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
            "\(NSHomeDirectory())/.local/bin/claude",
            "\(NSHomeDirectory())/.npm-global/bin/claude"
        ]

        for path in paths {
            if FileManager.default.fileExists(atPath: path) {
                return path
            }
        }

        // Try via shell
        return findExecutableViaShell("claude")
    }

    private func findExecutableViaShell(_ name: String) -> String? {
        let task = Process()
        task.launchPath = "/bin/zsh"
        task.arguments = ["-l", "-c", "which \(name)"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice

        do {
            try task.run()
            task.waitUntilExit()
            if task.terminationStatus == 0 {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                if let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !path.isEmpty {
                    return path
                }
            }
        } catch {}
        return nil
    }

    private func buildPathEnvironment() -> String {
        var paths = Set<String>()
        let basePaths = [
            "/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin",
            "\(NSHomeDirectory())/.local/bin", "\(NSHomeDirectory())/.npm-global/bin"
        ]
        paths.formUnion(basePaths)

        // Check for nvm
        let nvmDir = "\(NSHomeDirectory())/.nvm/versions/node"
        if let contents = try? FileManager.default.contentsOfDirectory(atPath: nvmDir),
           let latestNode = contents.sorted().last {
            paths.insert("\(nvmDir)/\(latestNode)/bin")
        }

        return paths.joined(separator: ":")
    }
}
