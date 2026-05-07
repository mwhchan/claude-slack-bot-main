import Foundation
import Factory

@Observable
final class LogsViewModel {
    @ObservationIgnored
    @Injected(\.logService) private var logService

    @ObservationIgnored
    @Injected(\.botService) private var botService

    var selectedLevel: LogLevel = .verbose
    var searchText: String = ""
    var autoScroll = true

    var logs: String { logService.logs }
    var isRunning: Bool { botService.isRunning }

    var filteredLogs: String {
        let lines = logs.components(separatedBy: .newlines)
        let filtered = lines.filter { line in
            let matchesSearch = searchText.isEmpty || line.localizedCaseInsensitiveContains(searchText)
            let matchesLevel = shouldShowLine(line, forLevel: selectedLevel)
            return matchesSearch && matchesLevel
        }
        return filtered.joined(separator: "\n")
    }

    /// Filter lines based on log level hierarchy: error < warn < info < debug < verbose
    /// Lines without a level tag are always shown (startup banner, etc.)
    private func shouldShowLine(_ line: String, forLevel level: LogLevel) -> Bool {
        // Determine the log level of this line by searching for level tags
        // Log format: [timestamp] [LEVEL] message
        let lineLevel: LogLevel?
        if line.contains("[ERROR]") {
            lineLevel = .error
        } else if line.contains("[WARN]") {
            lineLevel = .warning
        } else if line.contains("[INFO]") {
            lineLevel = .info
        } else if line.contains("[DEBUG]") {
            lineLevel = .debug
        } else if line.contains("[VERBOSE]") {
            lineLevel = .verbose
        } else {
            // No level tag - always show (startup banner, plain logs, etc.)
            lineLevel = nil
        }

        // If no level tag, always show
        guard let lineLevel = lineLevel else { return true }

        // Show line if its level is >= selected filter level (using hierarchy)
        return lineLevel.priority >= level.priority
    }

    var lineCount: Int {
        logs.components(separatedBy: .newlines).count
    }

    init() {}

    func start() {
        botService.start()
    }

    func stop() {
        botService.stop()
    }

    func restart() {
        botService.restart()
    }

    func clearLogs() {
        logService.clearLogs()
    }

    func clearSearch() {
        searchText = ""
    }
}
