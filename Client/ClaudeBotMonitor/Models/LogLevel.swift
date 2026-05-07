import Foundation

enum LogLevel: String, CaseIterable {
    case verbose = "Verbose"
    case debug = "Debug"
    case info = "Info"
    case warning = "Warning"
    case error = "Error"

    /// Priority for filtering: higher = more important, always shown
    /// When filter is set to "info", lines with priority >= info.priority are shown
    var priority: Int {
        switch self {
        case .verbose: return 0
        case .debug: return 1
        case .info: return 2
        case .warning: return 3
        case .error: return 4
        }
    }
}
