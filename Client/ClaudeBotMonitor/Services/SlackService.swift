import Foundation
import Factory

protocol SlackServiceProtocol {
    func addFromURL(_ urlString: String) async throws -> AddResult
}

enum AddResult {
    case channel(id: String, name: String)
    case user(id: String, name: String)
}

enum SlackError: LocalizedError {
    case invalidURL
    case missingToken
    case apiError(String)
    case alreadyExists

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid Slack URL. Expected format: https://workspace.slack.com/archives/CHANNEL_ID or /team/USER_ID"
        case .missingToken:
            return "SLACK_BOT_TOKEN not found in .env"
        case .apiError(let message):
            return "Slack API error: \(message)"
        case .alreadyExists:
            return "This channel/user already exists"
        }
    }
}

final class SlackService: SlackServiceProtocol {
    @Injected(\.setupManager) private var setupManager
    @Injected(\.envConfigService) private var envConfigService

    private var projectPath: String { setupManager.projectPath }

    private var slackToken: String? {
        envConfigService.variables.first { $0.key == "SLACK_BOT_TOKEN" }?.value
    }

    func addFromURL(_ urlString: String) async throws -> AddResult {
        guard let token = slackToken, !token.isEmpty else {
            throw SlackError.missingToken
        }

        // Parse the URL to extract channel or user ID
        let (type, id) = try parseSlackURL(urlString)

        switch type {
        case .channel:
            return try await addChannel(id: id, token: token)
        case .user:
            return try await addUser(id: id, token: token)
        case .dm:
            return try await addDM(id: id, token: token)
        }
    }

    // MARK: - URL Parsing

    private enum SlackResourceType {
        case channel
        case user
        case dm
    }

    private func parseSlackURL(_ urlString: String) throws -> (SlackResourceType, String) {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)

        // Direct ID input (e.g., C0A7U1W8WR4, U012AB3CD, or D7VMCAPLL)
        if trimmed.hasPrefix("C") && trimmed.count >= 9 && !trimmed.contains("/") {
            return (.channel, trimmed)
        }
        if trimmed.hasPrefix("G") && trimmed.count >= 9 && !trimmed.contains("/") {
            return (.channel, trimmed)
        }
        if trimmed.hasPrefix("U") && trimmed.count >= 9 && !trimmed.contains("/") {
            return (.user, trimmed)
        }
        if trimmed.hasPrefix("D") && trimmed.count >= 9 && !trimmed.contains("/") {
            return (.dm, trimmed)
        }

        guard let url = URL(string: trimmed) else {
            throw SlackError.invalidURL
        }

        let pathComponents = url.pathComponents

        // Channel URL: https://workspace.slack.com/archives/C0A7U1W8WR4
        if let archivesIndex = pathComponents.firstIndex(of: "archives"),
           archivesIndex + 1 < pathComponents.count {
            let channelId = pathComponents[archivesIndex + 1]
            if channelId.hasPrefix("C") || channelId.hasPrefix("G") {
                return (.channel, channelId)
            }
            // DM URL: https://workspace.slack.com/archives/D0A7U1W8WR4
            if channelId.hasPrefix("D") {
                return (.dm, channelId)
            }
        }

        // User URL: https://workspace.slack.com/team/U012AB3CD
        if let teamIndex = pathComponents.firstIndex(of: "team"),
           teamIndex + 1 < pathComponents.count {
            let userId = pathComponents[teamIndex + 1]
            if userId.hasPrefix("U") {
                return (.user, userId)
            }
        }

        throw SlackError.invalidURL
    }

    // MARK: - Channel

    private func addChannel(id: String, token: String) async throws -> AddResult {
        let channelDir = "\(projectPath)/data/context/channels/\(id)"

        // Check if already exists
        if FileManager.default.fileExists(atPath: channelDir) {
            throw SlackError.alreadyExists
        }

        // Fetch channel info from Slack API
        let channelInfo = try await fetchChannelInfo(id: id, token: token)

        // Create folder
        try FileManager.default.createDirectory(atPath: channelDir, withIntermediateDirectories: true)

        // Create config.json
        let config: [String: String] = [
            "type": "channel",
            "id": id,
            "name": channelInfo.name,
            "displayName": channelInfo.name
        ]
        let configData = try JSONEncoder().encode(config)
        try configData.write(to: URL(fileURLWithPath: "\(channelDir)/config.json"))

        // Create blank context.md
        try "".write(toFile: "\(channelDir)/context.md", atomically: true, encoding: .utf8)

        return .channel(id: id, name: channelInfo.name)
    }

    private struct ChannelInfo {
        let name: String
    }

    private func fetchChannelInfo(id: String, token: String) async throws -> ChannelInfo {
        var request = URLRequest(url: URL(string: "https://slack.com/api/conversations.info?channel=\(id)")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SlackError.apiError("Invalid response")
        }

        if let ok = json["ok"] as? Bool, !ok {
            let error = json["error"] as? String ?? "Unknown error"
            throw SlackError.apiError(error)
        }

        guard let channel = json["channel"] as? [String: Any],
              let name = channel["name"] as? String else {
            throw SlackError.apiError("Missing channel info")
        }

        return ChannelInfo(name: name)
    }

    // MARK: - User

    private func addUser(id: String, token: String) async throws -> AddResult {
        let userDir = "\(projectPath)/data/context/users/\(id)"

        // Check if already exists
        if FileManager.default.fileExists(atPath: userDir) {
            throw SlackError.alreadyExists
        }

        // Fetch user info from Slack API
        let userInfo = try await fetchUserInfo(id: id, token: token)

        // Create folder
        try FileManager.default.createDirectory(atPath: userDir, withIntermediateDirectories: true)

        // Create config.json
        var config: [String: String] = [
            "type": "user",
            "id": id,
            "name": userInfo.username,
            "displayName": userInfo.realName
        ]
        if let email = userInfo.email {
            config["email"] = email
        }
        let configData = try JSONEncoder().encode(config)
        try configData.write(to: URL(fileURLWithPath: "\(userDir)/config.json"))

        // Create blank context.md
        try "".write(toFile: "\(userDir)/context.md", atomically: true, encoding: .utf8)

        return .user(id: id, name: userInfo.realName)
    }

    private struct UserInfo {
        let username: String
        let realName: String
        let email: String?
    }

    private func fetchUserInfo(id: String, token: String) async throws -> UserInfo {
        var request = URLRequest(url: URL(string: "https://slack.com/api/users.info?user=\(id)")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SlackError.apiError("Invalid response")
        }

        if let ok = json["ok"] as? Bool, !ok {
            let error = json["error"] as? String ?? "Unknown error"
            throw SlackError.apiError(error)
        }

        guard let user = json["user"] as? [String: Any] else {
            throw SlackError.apiError("Missing user info")
        }

        let username = user["name"] as? String ?? id
        let profile = user["profile"] as? [String: Any]
        let realName = user["real_name"] as? String
            ?? profile?["display_name"] as? String
            ?? username
        let email = profile?["email"] as? String

        return UserInfo(username: username, realName: realName, email: email)
    }

    // MARK: - DM (Direct Message)

    private func addDM(id: String, token: String) async throws -> AddResult {
        // Get DM conversation info to find the other user
        let userId = try await fetchDMUserId(dmId: id, token: token)

        // Now add as a user
        return try await addUser(id: userId, token: token)
    }

    private func fetchDMUserId(dmId: String, token: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://slack.com/api/conversations.info?channel=\(dmId)")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SlackError.apiError("Invalid response")
        }

        if let ok = json["ok"] as? Bool, !ok {
            let error = json["error"] as? String ?? "Unknown error"
            // Provide helpful message for DM access issues
            if error == "channel_not_found" {
                throw SlackError.apiError("Cannot access this DM. Please use the user's profile URL instead (click their name → Copy link)")
            }
            throw SlackError.apiError(error)
        }

        guard let channel = json["channel"] as? [String: Any] else {
            throw SlackError.apiError("Missing channel info")
        }

        // For DMs, the user field contains the other user's ID
        if let userId = channel["user"] as? String {
            return userId
        }

        throw SlackError.apiError("Could not find user in DM")
    }
}
