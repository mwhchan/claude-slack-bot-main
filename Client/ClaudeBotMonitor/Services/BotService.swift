import Foundation

protocol BotServiceProtocol {
    var isRunning: Bool { get }
    func start()
    func stop()
    func restart()
    func checkStatus()
    func killAll()
}

@Observable
final class BotService: BotServiceProtocol {
    static let serviceLabel = "com.claude-slack-bot"
    static var logPath: String = ""

    private(set) var isRunning: Bool = false
    private var timer: Timer?
    private let projectPath: String

    init(projectPath: String) {
        self.projectPath = projectPath
        BotService.logPath = "\(projectPath)/data/logs/bot.log"
        checkStatus()
        startPolling()
    }

    func checkStatus() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let running = Self.checkIsRunning()
            DispatchQueue.main.async {
                self?.isRunning = running
            }
        }
    }

    func start() {
        // Ensure data directory exists for logs
        let dataDir = "\(projectPath)/data"
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true)

        // Use bootstrap to load and start the service
        let plistPath = "\(NSHomeDirectory())/Library/LaunchAgents/\(Self.serviceLabel).plist"
        runLaunchctl(["bootstrap", "gui/\(getuid())", plistPath])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.checkStatus()
        }
    }

    func stop() {
        // Use bootout to completely unload the service (prevents KeepAlive restart)
        runLaunchctl(["bootout", "gui/\(getuid())/\(Self.serviceLabel)"])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.checkStatus()
        }
    }

    func restart() {
        runLaunchctl(["kickstart", "-k", "gui/\(getuid())/\(Self.serviceLabel)"])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.checkStatus()
        }
    }

    func killAll() {
        // First, bootout the service to unload it completely
        runLaunchctl(["bootout", "gui/\(getuid())/\(Self.serviceLabel)"])

        // Then kill any orphaned node processes running claude-slack-bot
        DispatchQueue.global(qos: .utility).async { [weak self] in
            Self.killOrphanedProcesses()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self?.checkStatus()
            }
        }
    }

    private static func killOrphanedProcesses() {
        // Find and kill any node processes running from the project directory
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-f", "claude-slack-bot"]
        try? task.run()
        task.waitUntilExit()
    }

    private func startPolling() {
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.checkStatus()
        }
    }

    private func runLaunchctl(_ args: [String]) {
        let task = Process()
        task.launchPath = "/bin/launchctl"
        task.arguments = args
        try? task.run()
    }

    private static func checkIsRunning() -> Bool {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        task.arguments = ["list", serviceLabel]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe

        do {
            try task.run()
        } catch {
            return false
        }

        // Read output before waiting (prevents pipe buffer deadlock)
        let data = pipe.fileHandleForReading.readDataToEndOfFile()

        // Wait with timeout to prevent hanging
        let deadline = Date().addingTimeInterval(5.0)
        while task.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.01)
        }

        if task.isRunning {
            task.terminate()
            return false
        }

        guard task.terminationStatus == 0 else { return false }

        // Parse dictionary output - look for "PID" = <number>;
        if let output = String(data: data, encoding: .utf8) {
            let pattern = #""PID"\s*=\s*(\d+)"#
            if let regex = try? NSRegularExpression(pattern: pattern),
               let match = regex.firstMatch(in: output, range: NSRange(output.startIndex..., in: output)),
               let pidRange = Range(match.range(at: 1), in: output),
               Int(output[pidRange]) != nil {
                return true
            }
        }
        return false
    }
}
