import SwiftUI

enum ContextTab: String, CaseIterable {
    case claude = "Claude"
    case channels = "Channels"
    case users = "Users"

    var icon: String {
        switch self {
        case .claude: return "brain.head.profile"
        case .channels: return "number"
        case .users: return "person.2"
        }
    }
}

enum ContextFileType {
    case claudeMd
    case channelMemory
    case userMemory
}

struct ContextFile: Identifiable {
    let id = UUID()
    let name: String
    let path: String
    let size: Int
    let fileType: ContextFileType
    let friendlyName: String?

    var displayName: String {
        switch fileType {
        case .claudeMd:
            return friendlyName ?? name
        case .channelMemory:
            // Show friendly name (#channel-name) or fall back to ID
            return friendlyName ?? name
        case .userMemory:
            // Show friendly name (Real Name) or fall back to ID
            return friendlyName ?? name
        }
    }

    var subtitle: String? {
        switch fileType {
        case .claudeMd:
            return nil
        case .channelMemory, .userMemory:
            // Show the ID as subtitle when we have a friendly name
            return friendlyName != nil ? name : nil
        }
    }

    var icon: String {
        switch fileType {
        case .claudeMd:
            return "doc.text"
        case .channelMemory:
            return "number"
        case .userMemory:
            return "person"
        }
    }

    var iconColor: Color {
        switch fileType {
        case .claudeMd:
            return .purple
        case .channelMemory:
            return .blue
        case .userMemory:
            return .green
        }
    }

    var sortOrder: Int {
        switch fileType {
        case .claudeMd:
            return 0
        case .channelMemory:
            return 1
        case .userMemory:
            return 2
        }
    }

    var sizeFormatted: String {
        if size < 1024 {
            return "\(size) B"
        } else if size < 1024 * 1024 {
            return String(format: "%.1f KB", Double(size) / 1024)
        } else {
            return String(format: "%.1f MB", Double(size) / (1024 * 1024))
        }
    }
}
