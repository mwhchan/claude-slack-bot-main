import Foundation
import Factory

@Observable
@MainActor
final class DialogViewModel {
    @ObservationIgnored
    @Injected(\.logService) private var logService
    @ObservationIgnored
    @Injected(\.monitorWebSocketService) private var webSocketService

    var messages: [DialogMessage] = []
    var autoScroll = true
    var deleteError: String?
    var deletedMessageIds: Set<String> = []  // "channelId:messageTs"

    private var logs: String { logService.logs }
    private var lastLogLength = 0

    init() {
        parseMessages()
        startWatching()
    }

    func refresh() {
        parseMessages()
    }

    func clearMessages() {
        messages = []
    }

    func deleteMessage(channelId: String, messageTs: String) {
        Task {
            do {
                try await webSocketService.deleteMessage(channelId: channelId, messageTs: messageTs)
                deletedMessageIds.insert("\(channelId):\(messageTs)")
                deleteError = nil
            } catch {
                deleteError = error.localizedDescription
            }
        }
    }

    func isDeleted(message: DialogMessage) -> Bool {
        guard let channelId = message.slackChannelId, let ts = message.slackMessageTs else {
            return false
        }
        return deletedMessageIds.contains("\(channelId):\(ts)")
    }

    private func startWatching() {
        // Watch for log changes using a timer
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self else { return }
                let currentLength = self.logs.count
                if currentLength != self.lastLogLength {
                    self.lastLogLength = currentLength
                    self.parseMessages()
                }
            }
        }
    }

    private func parseMessages() {
        let lines = logs.components(separatedBy: .newlines)
        var newMessages: [DialogMessage] = []
        var pendingUsername: String? = nil
        var expectingUserMessage = false

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }

            // Strip log level prefix if present (e.g., "[INFO] ", "[DEBUG] ", etc.)
            let content = stripLogLevelPrefix(from: trimmed)

            // Pattern 1: New format "[MESSAGE] channel=C123|#name user=U456|@Name "text""
            if content.hasPrefix("[MESSAGE]") {
                if let messageInfo = parseMessageLine(content) {
                    // Remove bot mention from the message if present
                    let cleanContent = removeAtMention(from: messageInfo.text)
                    if !cleanContent.isEmpty {
                        newMessages.append(DialogMessage(
                            sender: .user,
                            content: cleanContent,
                            timestamp: nil,
                            username: messageInfo.username,
                            inputTokens: nil,
                            outputTokens: nil,
                            costUsd: nil,
                            durationSec: nil,
                            slackChannelId: nil,
                            slackMessageTs: nil
                        ))
                    }
                }
                continue
            }

            // Pattern 1a: DM format "[DM] user=U456|@Name "text""
            if content.hasPrefix("[DM]") {
                if let dmInfo = parseDMLine(content) {
                    let cleanContent = removeAtMention(from: dmInfo.text)
                    if !cleanContent.isEmpty {
                        // Pass nil if username is empty
                        let usernameOrNil = dmInfo.username.isEmpty ? nil : dmInfo.username
                        newMessages.append(DialogMessage(
                            sender: .user,
                            content: cleanContent,
                            timestamp: nil,
                            username: usernameOrNil,
                            inputTokens: nil,
                            outputTokens: nil,
                            costUsd: nil,
                            durationSec: nil,
                            slackChannelId: nil,
                            slackMessageTs: nil
                        ))
                    }
                }
                continue
            }

            // Pattern 1b (legacy): "@mention in #channel from @username:" or "Thread reply in #channel from @username:"
            // Handles both "<@userid>" and "@Display Name" formats
            if content.contains("from @") && (content.contains("@mention in") || content.contains("Thread reply in") || content.contains("mention in #")) {
                pendingUsername = extractUsername(from: content)
                expectingUserMessage = true
                continue
            }

            // Pattern 2: User message - line starting with quote after @mention/thread reply header
            if expectingUserMessage && content.hasPrefix("\"") {
                let msgContent = extractQuotedContent(from: content)
                if !msgContent.isEmpty {
                    // Remove bot mention from the message if present
                    let cleanContent = removeAtMention(from: msgContent)
                    if !cleanContent.isEmpty {
                        newMessages.append(DialogMessage(
                            sender: .user,
                            content: cleanContent,
                            timestamp: nil,
                            username: pendingUsername,
                            inputTokens: nil,
                            outputTokens: nil,
                            costUsd: nil,
                            durationSec: nil,
                            slackChannelId: nil,
                            slackMessageTs: nil
                        ))
                    }
                }
                expectingUserMessage = false
                continue
            }

            // Pattern 3: Bot response - "[RESPONSE] (Xs) [tokens] {ref}: "text"" or "[RESPONSE] (Xs): "text""
            if content.contains("[RESPONSE]") && (content.contains("}: \"") || content.contains("]: \"") || content.contains("): \"")) {
                let response = extractBotResponse(from: content)
                if !response.content.isEmpty {
                    newMessages.append(DialogMessage(
                        sender: .assistant,
                        content: response.content,
                        timestamp: nil,
                        username: nil,
                        inputTokens: response.inputTokens,
                        outputTokens: response.outputTokens,
                        costUsd: response.costUsd,
                        durationSec: response.durationSec,
                        slackChannelId: response.channelId,
                        slackMessageTs: response.messageTs
                    ))
                }
                continue
            }

            // Pattern 4: Error response - "Error response (Xs): "text" [error type]"
            if content.contains("Error response (") && content.contains("s): \"") {
                let (errorContent, errorType) = extractErrorResponse(from: content)
                if !errorContent.isEmpty {
                    let displayContent = errorType.isEmpty
                        ? "⚠️ \(errorContent)"
                        : "⚠️ \(errorContent)\n\n_Error: \(errorType)_"
                    newMessages.append(DialogMessage(
                        sender: .system,
                        content: displayContent,
                        timestamp: nil,
                        username: nil,
                        inputTokens: nil,
                        outputTokens: nil,
                        costUsd: nil,
                        durationSec: nil,
                        slackChannelId: nil,
                        slackMessageTs: nil
                    ))
                }
                continue
            }

            // Pattern 4b: Spawn error - "[SPAWN ERROR] ..."
            if content.contains("[SPAWN ERROR]") {
                let errorDetail = content.replacingOccurrences(of: "[SPAWN ERROR] ", with: "")
                newMessages.append(DialogMessage(
                    sender: .system,
                    content: "🔴 Spawn Error: \(errorDetail)",
                    timestamp: nil,
                    username: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    costUsd: nil,
                    durationSec: nil,
                    slackChannelId: nil,
                    slackMessageTs: nil
                ))
                continue
            }

            // Pattern 4c: CLI error - "[CLI ERROR] ..."
            if content.contains("[CLI ERROR]") {
                let errorDetail = content.replacingOccurrences(of: "[CLI ERROR] ", with: "")
                newMessages.append(DialogMessage(
                    sender: .system,
                    content: "🔴 CLI Error: \(errorDetail)",
                    timestamp: nil,
                    username: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    costUsd: nil,
                    durationSec: nil,
                    slackChannelId: nil,
                    slackMessageTs: nil
                ))
                continue
            }

            // Pattern 5: File upload - "[FileUpload] Uploaded filename {channelId:messageTs}"
            if content.hasPrefix("[FileUpload] Uploaded ") {
                if let fileInfo = parseFileUploadLine(content) {
                    newMessages.append(DialogMessage(
                        sender: .assistant,
                        content: "📎 \(fileInfo.filename)",
                        timestamp: nil,
                        username: nil,
                        inputTokens: nil,
                        outputTokens: nil,
                        costUsd: nil,
                        durationSec: nil,
                        slackChannelId: fileInfo.channelId,
                        slackMessageTs: fileInfo.messageTs
                    ))
                }
                continue
            }

            // Pattern 6: MCP result - "MCP result (Xs): "text""
            if content.contains("MCP result (") && content.contains("s): \"") {
                let response = extractBotResponse(from: content)
                if !response.content.isEmpty {
                    newMessages.append(DialogMessage(
                        sender: .assistant,
                        content: response.content,
                        timestamp: nil,
                        username: nil,
                        inputTokens: response.inputTokens,
                        outputTokens: response.outputTokens,
                        costUsd: response.costUsd,
                        durationSec: response.durationSec,
                        slackChannelId: response.channelId,
                        slackMessageTs: response.messageTs
                    ))
                }
                continue
            }

            // Reset if we see other log lines
            if content.contains("Triggering") || content.contains("Checking") ||
               content.contains("Found bot") || content.contains("Responding") ||
               content.contains("Thread:") || content.contains("Posted") {
                expectingUserMessage = false
            }
        }

        messages = newMessages
    }

    private func stripLogLevelPrefix(from line: String) -> String {
        var result = line

        // First strip timestamp prefix like "[10:45:10] " or "[2026-01-11 10:45:10] "
        if result.hasPrefix("[") {
            if let closeBracket = result.firstIndex(of: "]") {
                let afterBracket = result.index(after: closeBracket)
                result = String(result[afterBracket...]).trimmingCharacters(in: .whitespaces)
            }
        }

        // Then strip log level prefixes like "[INFO] ", "[DEBUG] ", "[WARN] ", "[ERROR] ", "[VERBOSE] "
        let prefixes = ["[INFO] ", "[DEBUG] ", "[WARN] ", "[ERROR] ", "[VERBOSE] "]
        for prefix in prefixes {
            if result.hasPrefix(prefix) {
                // Strip prefix and trim leading whitespace for pattern matching
                return String(result.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            }
        }
        return result
    }

    private func parseMessageLine(_ line: String) -> (channelId: String, channelName: String, userId: String, username: String, text: String)? {
        // Parse: [MESSAGE] channel=C123|#channel-name user=U456|@Username "message text"
        guard line.hasPrefix("[MESSAGE]") else { return nil }

        let content = String(line.dropFirst("[MESSAGE]".count)).trimmingCharacters(in: .whitespaces)

        // Extract channel info
        var channelId = ""
        var channelName = ""
        var userId = ""
        var username = ""
        var text = ""

        // Find channel=...
        if let channelStart = content.range(of: "channel=") {
            let afterChannel = String(content[channelStart.upperBound...])
            if let pipeIndex = afterChannel.firstIndex(of: "|") {
                channelId = String(afterChannel[..<pipeIndex])
                let afterPipe = String(afterChannel[afterChannel.index(after: pipeIndex)...])
                if let spaceIndex = afterPipe.firstIndex(of: " ") {
                    channelName = String(afterPipe[..<spaceIndex])
                    if channelName.hasPrefix("#") {
                        channelName = String(channelName.dropFirst())
                    }
                }
            }
        }

        // Find user=...
        if let userStart = content.range(of: "user=") {
            let afterUser = String(content[userStart.upperBound...])
            if let pipeIndex = afterUser.firstIndex(of: "|") {
                userId = String(afterUser[..<pipeIndex])
                let afterPipe = String(afterUser[afterUser.index(after: pipeIndex)...])
                if let spaceIndex = afterPipe.firstIndex(of: " ") {
                    username = String(afterPipe[..<spaceIndex])
                    if username.hasPrefix("@") {
                        username = String(username.dropFirst())
                    }
                }
            }
        }

        // Find the message text (everything in quotes at the end)
        if let firstQuote = content.firstIndex(of: "\"") {
            var messageContent = String(content[content.index(after: firstQuote)...])
            if messageContent.hasSuffix("\"") {
                messageContent = String(messageContent.dropLast())
            }
            text = messageContent
        }

        guard !text.isEmpty else { return nil }

        return (channelId, channelName, userId, username, text)
    }

    private func parseDMLine(_ line: String) -> (userId: String, username: String, text: String)? {
        // Parse: [DM] user=U456|@Username "message text"
        // Note: Username can contain spaces like "Chen Ding"
        guard line.hasPrefix("[DM]") else { return nil }

        let content = String(line.dropFirst("[DM]".count)).trimmingCharacters(in: .whitespaces)

        var userId = ""
        var username = ""
        var text = ""

        // Find the message text first (everything in quotes at the end)
        if let firstQuote = content.firstIndex(of: "\"") {
            var messageContent = String(content[content.index(after: firstQuote)...])
            if messageContent.hasSuffix("\"") {
                messageContent = String(messageContent.dropLast())
            }
            text = messageContent

            // Now parse user info from before the quote
            let beforeQuote = String(content[..<firstQuote]).trimmingCharacters(in: .whitespaces)

            // Find user=...
            if let userStart = beforeQuote.range(of: "user=") {
                let afterUser = String(beforeQuote[userStart.upperBound...])
                if let pipeIndex = afterUser.firstIndex(of: "|") {
                    userId = String(afterUser[..<pipeIndex])
                    // Everything after pipe is the username (may contain spaces)
                    username = String(afterUser[afterUser.index(after: pipeIndex)...]).trimmingCharacters(in: .whitespaces)
                    if username.hasPrefix("@") {
                        username = String(username.dropFirst())
                    }
                }
            }
        }

        guard !text.isEmpty else { return nil }

        return (userId, username, text)
    }

    private func extractUsername(from line: String) -> String? {
        // Extract username from "from @Chen Ding:" or "from <@U6GJSMG20>:"
        // Try new format first: "from @Display Name:"
        if let startRange = line.range(of: "from @") {
            let afterAt = String(line[startRange.upperBound...])
            // Find the colon that ends the username
            if let colonIndex = afterAt.firstIndex(of: ":") {
                return String(afterAt[..<colonIndex])
            }
        }
        // Fall back to old format: "from <@userid>"
        if let startRange = line.range(of: "from <@"),
           let endRange = line.range(of: ">", range: startRange.upperBound..<line.endIndex) {
            return String(line[startRange.upperBound..<endRange.lowerBound])
        }
        return nil
    }

    private func extractQuotedContent(from line: String) -> String {
        // Extract content from "\"text\""
        var content = line
        if content.hasPrefix("\"") {
            content.removeFirst()
        }
        if content.hasSuffix("\"") {
            content.removeLast()
        }
        return content.trimmingCharacters(in: .whitespaces)
    }

    private func removeAtMention(from text: String) -> String {
        // Remove "<@USERID> " from the beginning of text
        var result = text
        if let startRange = result.range(of: "<@"),
           let endRange = result.range(of: "> ", range: startRange.upperBound..<result.endIndex) {
            result = String(result[endRange.upperBound...])
        } else if let startRange = result.range(of: "<@"),
                  let endRange = result.range(of: ">", range: startRange.upperBound..<result.endIndex) {
            // Handle case where mention is at the end or only content
            let afterMention = String(result[endRange.upperBound...]).trimmingCharacters(in: .whitespaces)
            if afterMention.isEmpty {
                return "" // Only mention, no actual message
            }
            result = afterMention
        }
        return result.trimmingCharacters(in: .whitespaces)
    }

    private func parseFileUploadLine(_ line: String) -> (filename: String, channelId: String?, messageTs: String?)? {
        // Parse: [FileUpload] Uploaded filename {channelId:messageTs}
        guard line.hasPrefix("[FileUpload] Uploaded ") else { return nil }

        let content = String(line.dropFirst("[FileUpload] Uploaded ".count)).trimmingCharacters(in: .whitespaces)
        guard !content.isEmpty else { return nil }

        var filename = content
        var channelId: String? = nil
        var messageTs: String? = nil

        // Extract {channelId:messageTs} if present
        if let braceStart = content.range(of: " {"),
           let braceEnd = content.range(of: "}", range: braceStart.upperBound..<content.endIndex) {
            filename = String(content[..<braceStart.lowerBound])
            let refStr = String(content[braceStart.upperBound..<braceEnd.lowerBound])
            let parts = refStr.split(separator: ":")
            if parts.count == 2 {
                channelId = String(parts[0])
                messageTs = String(parts[1])
            }
        }

        return (filename, channelId, messageTs)
    }

    private func extractBotResponse(from line: String) -> (content: String, inputTokens: Int?, outputTokens: Int?, costUsd: Double?, durationSec: Int?, channelId: String?, messageTs: String?) {
        // Extract from "Response (Xs) [in→out tokens, $cost] {channel:ts}: \"text\"" or "MCP result (Xs): \"text\""
        var inputTokens: Int? = nil
        var outputTokens: Int? = nil
        var costUsd: Double? = nil
        var durationSec: Int? = nil
        var channelId: String? = nil
        var messageTs: String? = nil

        // Parse duration: "Response (6s)" or "Response (6s) [...]"
        if let openParen = line.firstIndex(of: "("),
           let closeParen = line.firstIndex(of: ")") {
            let durationStr = String(line[line.index(after: openParen)..<closeParen])
            if durationStr.hasSuffix("s"), let duration = Int(durationStr.dropLast()) {
                durationSec = duration
            }
        }

        // Parse token info: "[3→226 tokens, $0.0149]"
        if let bracketStart = line.range(of: " ["),
           let bracketEnd = line.range(of: "]", range: bracketStart.upperBound..<line.endIndex) {
            let tokenStr = String(line[bracketStart.upperBound..<bracketEnd.lowerBound])
            // Parse "3→226 tokens, $0.0149"
            if let arrowIndex = tokenStr.firstIndex(of: "→") {
                let inputStr = String(tokenStr[..<arrowIndex])
                if let input = Int(inputStr) {
                    inputTokens = input
                }
                let afterArrow = String(tokenStr[tokenStr.index(after: arrowIndex)...])
                if let spaceIndex = afterArrow.firstIndex(of: " ") {
                    let outputStr = String(afterArrow[..<spaceIndex])
                    if let output = Int(outputStr) {
                        outputTokens = output
                    }
                }
            }
            if let dollarIndex = tokenStr.firstIndex(of: "$") {
                let costStr = String(tokenStr[tokenStr.index(after: dollarIndex)...])
                if let cost = Double(costStr) {
                    costUsd = cost
                }
            }
        }

        // Parse message reference: "{C0A7U1W8WR4:1768179854.084879}"
        if let braceStart = line.range(of: " {"),
           let braceEnd = line.range(of: "}: \"") {
            let refStr = String(line[braceStart.upperBound..<braceEnd.lowerBound])
            let parts = refStr.split(separator: ":")
            if parts.count == 2 {
                channelId = String(parts[0])
                messageTs = String(parts[1])
            }
        }

        // Extract content
        if let colonRange = line.range(of: "}: \"") ?? line.range(of: "]: \"") ?? line.range(of: "): \"") {
            var content = String(line[colonRange.upperBound...])
            // Handle truncated responses ending with "..."
            if content.hasSuffix("...\"") {
                content = String(content.dropLast(4)) + "..."
            } else if content.hasSuffix("\"") {
                content.removeLast()
            }
            return (content, inputTokens, outputTokens, costUsd, durationSec, channelId, messageTs)
        }
        return ("", nil, nil, nil, nil, nil, nil)
    }

    private func extractErrorResponse(from line: String) -> (content: String, errorType: String) {
        // Extract from "Error response (Xs): \"text\" [error type]"
        // Format: Error response (0s): "Sorry, I encountered an error..." [Unknown error]
        guard let colonRange = line.range(of: "): \"") else {
            return ("", "")
        }

        let remaining = String(line[colonRange.upperBound...])

        // Find the closing quote - it may be followed by [error type]
        var content = ""
        var errorType = ""

        // Look for pattern: "message" [error type] or "message..."
        if let lastQuoteRange = remaining.range(of: "\" [", options: .backwards) {
            // Has error type suffix
            content = String(remaining[..<lastQuoteRange.lowerBound])
            let afterQuote = String(remaining[lastQuoteRange.upperBound...])
            if afterQuote.hasSuffix("]") {
                errorType = String(afterQuote.dropLast())
            }
        } else if remaining.hasSuffix("...\"") {
            content = String(remaining.dropLast(4)) + "..."
        } else if remaining.hasSuffix("\"") {
            content = String(remaining.dropLast())
        } else {
            content = remaining
        }

        return (content, errorType)
    }
}
