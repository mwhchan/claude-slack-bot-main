import Cocoa
import ServiceManagement

protocol SetupManagerProtocol {
    var projectPath: String { get set }
    var isServiceInstalled: Bool { get }
    var isInLoginItems: Bool { get }
    var setupError: String? { get }
    var needsSetup: Bool { get }

    func detectExistingSetup()
    func browseForProject()
    func validateProjectPath() -> Bool
    func installService() -> Bool
    func uninstallService()
    func addToLoginItems()
    func removeFromLoginItems()
}

@Observable
final class SetupManager: SetupManagerProtocol {
    var projectPath: String = ""
    private(set) var isServiceInstalled: Bool = false
    var isInLoginItems: Bool {
        SMAppService.mainApp.status == .enabled
    }
    var setupError: String?

    let plistPath: String
    let serviceLabel = "com.claude-slack-bot"

    var needsSetup: Bool {
        !isServiceInstalled || projectPath.isEmpty
    }

    init() {
        plistPath = "\(NSHomeDirectory())/Library/LaunchAgents/\(serviceLabel).plist"
        detectExistingSetup()
    }

    func detectExistingSetup() {
        isServiceInstalled = FileManager.default.fileExists(atPath: plistPath)

        if isServiceInstalled,
           let plistData = FileManager.default.contents(atPath: plistPath),
           let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
           let workingDir = plist["WorkingDirectory"] as? String {
            projectPath = workingDir
        } else {
            let possiblePaths = [
                "\(NSHomeDirectory())/Workspace/claude-slack-bot",
                "\(NSHomeDirectory())/Projects/claude-slack-bot",
                "\(NSHomeDirectory())/Developer/claude-slack-bot"
            ]
            for path in possiblePaths {
                if FileManager.default.fileExists(atPath: "\(path)/package.json") {
                    projectPath = path
                    break
                }
            }
        }
    }

    func browseForProject() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.message = "Select the claude-slack-bot project folder"

        if panel.runModal() == .OK, let url = panel.url {
            projectPath = url.path
            setupError = nil
        }
    }

    func validateProjectPath() -> Bool {
        guard FileManager.default.fileExists(atPath: "\(projectPath)/package.json") else {
            setupError = "package.json not found"
            return false
        }
        guard FileManager.default.fileExists(atPath: "\(projectPath)/.env.example") else {
            setupError = ".env.example not found"
            return false
        }
        setupError = nil
        return true
    }

    func installService() -> Bool {
        guard let node = findExecutable("node"),
              let npm = findExecutable("npm") else {
            setupError = "Node.js not found. Please install Node.js."
            return false
        }

        // Verify claude is available (warn but don't block)
        if findExecutable("claude") == nil {
            setupError = "Warning: Claude CLI not found. Bot may fail to respond."
        }

        // Create data directory for logs (launchd won't create it)
        let dataDir = "\(projectPath)/data"
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true)

        let pathEnv = buildPathEnvironment()
        let plistContent = """
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>\(serviceLabel)</string>
    <key>WorkingDirectory</key><string>\(projectPath)</string>
    <key>ProgramArguments</key>
    <array><string>\(node)</string><string>\(npm)</string><string>start</string></array>
    <key>EnvironmentVariables</key>
    <dict><key>PATH</key><string>\(pathEnv)</string></dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>StandardOutPath</key><string>\(projectPath)/data/logs/bot.log</string>
    <key>StandardErrorPath</key><string>\(projectPath)/data/logs/bot.err</string>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
"""
        let launchAgentsDir = "\(NSHomeDirectory())/Library/LaunchAgents"
        try? FileManager.default.createDirectory(atPath: launchAgentsDir, withIntermediateDirectories: true)

        do {
            try plistContent.write(toFile: plistPath, atomically: true, encoding: .utf8)
        } catch {
            setupError = "Failed to write config: \(error.localizedDescription)"
            return false
        }

        let task = Process()
        task.launchPath = "/bin/launchctl"
        task.arguments = ["load", plistPath]
        try? task.run()
        task.waitUntilExit()

        isServiceInstalled = true
        return true
    }

    func uninstallService() {
        let task = Process()
        task.launchPath = "/bin/launchctl"
        task.arguments = ["unload", plistPath]
        try? task.run()
        task.waitUntilExit()
        try? FileManager.default.removeItem(atPath: plistPath)
        isServiceInstalled = false
    }

    func addToLoginItems() {
        do {
            try SMAppService.mainApp.register()
        } catch {
            setupError = "Failed to add to login items: \(error.localizedDescription)"
        }
    }

    func removeFromLoginItems() {
        do {
            try SMAppService.mainApp.unregister()
        } catch {
            setupError = "Failed to remove from login items: \(error.localizedDescription)"
        }
    }

    private func findExecutable(_ name: String) -> String? {
        let paths = [
            "/opt/homebrew/bin/\(name)",
            "/usr/local/bin/\(name)",
            "/usr/bin/\(name)",
            "\(NSHomeDirectory())/.local/bin/\(name)",
            "\(NSHomeDirectory())/.npm-global/bin/\(name)"
        ]
        for path in paths {
            if FileManager.default.fileExists(atPath: path) { return path }
        }
        // Try using shell to find it (gets user's full PATH)
        return findExecutableViaShell(name)
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
        let basePaths = ["/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin",
                         "\(NSHomeDirectory())/.local/bin", "\(NSHomeDirectory())/.npm-global/bin"]
        paths.formUnion(basePaths)

        // Find claude and add its directory
        if let claudePath = findExecutable("claude") {
            let claudeDir = (claudePath as NSString).deletingLastPathComponent
            paths.insert(claudeDir)
        }

        // Check for nvm
        let nvmDir = "\(NSHomeDirectory())/.nvm/versions/node"
        if let contents = try? FileManager.default.contentsOfDirectory(atPath: nvmDir),
           let latestNode = contents.sorted().last {
            paths.insert("\(nvmDir)/\(latestNode)/bin")
        }

        return paths.joined(separator: ":")
    }
}
