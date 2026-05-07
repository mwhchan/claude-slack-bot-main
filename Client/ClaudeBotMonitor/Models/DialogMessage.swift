import Foundation

enum MessageSender {
    case user
    case assistant
    case system
}

struct DialogMessage: Identifiable {
    let id = UUID()
    let sender: MessageSender
    let content: String
    let timestamp: Date?
    let username: String?

    // Token usage (for assistant messages)
    let inputTokens: Int?
    let outputTokens: Int?
    let costUsd: Double?
    let durationSec: Int?

    // Slack message reference (for deletion)
    let slackChannelId: String?
    let slackMessageTs: String?

    var canDelete: Bool {
        slackChannelId != nil && slackMessageTs != nil
    }

    var tokenInfo: String? {
        guard let input = inputTokens, let output = outputTokens, let cost = costUsd else {
            return nil
        }
        return "\(input)→\(output) tokens, $\(String(format: "%.4f", cost))"
    }

    var displayName: String {
        switch sender {
        case .user:
            if let name = username, !name.isEmpty {
                return name
            }
            return "User"
        case .assistant:
            return "Claude"
        case .system:
            return "System"
        }
    }
}
