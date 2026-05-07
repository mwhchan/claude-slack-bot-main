import Foundation

enum NavigationSelection: Hashable, Identifiable {
    case dashboard
    case settings
    case channel(id: String)
    case user(id: String)

    var id: String {
        switch self {
        case .dashboard: return "dashboard"
        case .settings: return "settings"
        case .channel(let id): return "channel-\(id)"
        case .user(let id): return "user-\(id)"
        }
    }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .settings: return "Settings"
        case .channel(let id): return id
        case .user(let id): return id
        }
    }

    var icon: String {
        switch self {
        case .dashboard: return "gauge"
        case .settings: return "gear"
        case .channel: return "number"
        case .user: return "person.fill"
        }
    }
}

struct SidebarChannel: Identifiable, Hashable {
    let id: String
    let filePath: String
    let name: String?

    var label: String { name ?? id }
}

struct SidebarUser: Identifiable, Hashable {
    let id: String
    let filePath: String
    let displayName: String?

    var label: String { displayName ?? id }
}
