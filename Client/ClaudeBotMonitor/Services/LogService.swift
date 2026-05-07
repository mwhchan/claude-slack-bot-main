import Foundation

protocol LogServiceProtocol {
    var logs: String { get }
    func loadLogs()
    func clearLogs()
    func startWatching()
}

@Observable
final class LogService: LogServiceProtocol {
    private(set) var logs: String = ""
    private var stdoutSource: DispatchSourceFileSystemObject?
    private var stderrSource: DispatchSourceFileSystemObject?
    private var refreshTimer: Timer?
    private let logPath: String
    private let errPath: String
    private var lastLogSize: UInt64 = 0
    private var lastErrSize: UInt64 = 0

    init(projectPath: String) {
        self.logPath = "\(projectPath)/data/logs/bot.log"
        self.errPath = "\(projectPath)/data/logs/bot.err"
        loadLogs()
        startWatching()
    }

    func loadLogs() {
        var combined = ""

        if let stdout = try? String(contentsOfFile: logPath, encoding: .utf8), !stdout.isEmpty {
            combined += stdout
        }
        if let stderr = try? String(contentsOfFile: errPath, encoding: .utf8), !stderr.isEmpty {
            if !combined.isEmpty { combined += "\n" }
            combined += stderr
        }

        if combined.isEmpty {
            logs = "No logs yet. Start the bot to see output."
        } else {
            logs = combined.components(separatedBy: .newlines).suffix(500).joined(separator: "\n")
        }

        // Track file sizes for change detection
        lastLogSize = fileSize(logPath)
        lastErrSize = fileSize(errPath)
    }

    func startWatching() {
        // Watch stdout log
        watchFile(path: logPath, source: &stdoutSource)
        // Watch stderr log
        watchFile(path: errPath, source: &stderrSource)

        // Backup: poll every 2 seconds in case file watcher misses events
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.checkForChanges()
        }
    }

    private func checkForChanges() {
        let currentLogSize = fileSize(logPath)
        let currentErrSize = fileSize(errPath)

        if currentLogSize != lastLogSize || currentErrSize != lastErrSize {
            loadLogs()
        }
    }

    private func fileSize(_ path: String) -> UInt64 {
        (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? UInt64) ?? 0
    }

    private func watchFile(path: String, source: inout DispatchSourceFileSystemObject?) {
        // Ensure parent directory exists
        let parentDir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: parentDir, withIntermediateDirectories: true)

        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        guard let handle = FileHandle(forReadingAtPath: path) else { return }
        handle.seekToEndOfFile()

        source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: handle.fileDescriptor,
            eventMask: .write,
            queue: .main
        )
        source?.setEventHandler { [weak self] in
            if let data = try? handle.readToEnd(),
               let str = String(data: data, encoding: .utf8),
               !str.isEmpty {
                self?.logs += str
                let lines = self?.logs.components(separatedBy: .newlines) ?? []
                if lines.count > 500 {
                    self?.logs = lines.suffix(500).joined(separator: "\n")
                }
            }
        }
        source?.resume()
    }

    func clearLogs() {
        try? "".write(toFile: logPath, atomically: true, encoding: .utf8)
        try? "".write(toFile: errPath, atomically: true, encoding: .utf8)
        logs = ""
        lastLogSize = 0
        lastErrSize = 0
    }

    deinit {
        refreshTimer?.invalidate()
    }
}
