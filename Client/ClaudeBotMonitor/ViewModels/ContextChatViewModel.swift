import Foundation
import Factory

@Observable
final class ContextChatViewModel {
    @ObservationIgnored
    @Injected(\.claudeService) private var claudeService

    var messages: [ChatMessage] = []
    var inputText: String = ""
    var isLoading: Bool = false
    var streamingResponse: String = ""
    var error: String?

    // Context from the selected file
    var contextFileName: String?
    var contextContent: String?

    // Session ID derived from file name
    private var currentSessionId: String?

    init() {
        showWelcomeMessage()
    }

    var hasContext: Bool {
        contextContent != nil && !contextContent!.isEmpty
    }

    var hasActiveSession: Bool {
        guard let sessionId = currentSessionId else { return false }
        return claudeService.hasSession(for: sessionId)
    }

    func updateContext(fileName: String?, content: String?) {
        // Only reset if file changed (not just content updates)
        let fileChanged = contextFileName != fileName
        let previousSessionId = currentSessionId

        // Save current messages before switching
        if fileChanged, let prevId = previousSessionId, !messages.isEmpty {
            saveMessages(for: prevId)
        }

        contextFileName = fileName
        contextContent = content

        // Update session ID based on file name
        if let fileName = fileName {
            // Create safe session ID from filename
            currentSessionId = fileName
                .replacingOccurrences(of: ".md", with: "")
                .replacingOccurrences(of: " ", with: "_")
                .lowercased()
        } else {
            currentSessionId = nil
        }

        // Load messages for new context
        if fileChanged, let fileName = fileName, let sessionId = currentSessionId {
            messages.removeAll()
            claudeService.loadSessionIfExists(sessionId)

            // Try to load saved messages
            if let savedMessages = claudeService.loadMessages(for: sessionId), !savedMessages.isEmpty {
                messages = savedMessages
            } else if claudeService.hasSession(for: sessionId) {
                // Session exists but no saved messages (shouldn't happen, but handle it)
                messages.append(ChatMessage(
                    role: .system,
                    content: "Context: \(fileName)\nContinuing previous conversation...",
                    timestamp: Date()
                ))
            } else {
                // New session
                messages.append(ChatMessage(
                    role: .system,
                    content: "Context: \(fileName)\nAsk me questions or request suggestions.",
                    timestamp: Date()
                ))
            }
        }
    }

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard !isLoading else { return }
        guard let sessionId = currentSessionId else {
            error = "No context file selected"
            return
        }

        // Add user message
        let userMessage = ChatMessage(
            role: .user,
            content: text,
            timestamp: Date()
        )
        messages.append(userMessage)
        saveMessages(for: sessionId)
        inputText = ""

        isLoading = true
        streamingResponse = ""
        error = nil

        claudeService.sendMessage(
            prompt: text,
            context: contextContent,
            sessionId: sessionId,
            onUpdate: { [weak self] response in
                self?.streamingResponse = response
            },
            onComplete: { [weak self] response in
                guard let self = self else { return }
                self.isLoading = false
                self.streamingResponse = ""

                let assistantMessage = ChatMessage(
                    role: .assistant,
                    content: response,
                    timestamp: Date()
                )
                self.messages.append(assistantMessage)

                // Save after receiving response
                if let sessionId = self.currentSessionId {
                    self.saveMessages(for: sessionId)
                }
            },
            onError: { [weak self] errorMsg in
                guard let self = self else { return }
                self.isLoading = false
                self.streamingResponse = ""
                self.error = errorMsg

                let errorMessage = ChatMessage(
                    role: .system,
                    content: "Error: \(errorMsg)",
                    timestamp: Date()
                )
                self.messages.append(errorMessage)
            }
        )
    }

    func cancelRequest() {
        claudeService.cancel()
        isLoading = false
        streamingResponse = ""
    }

    /// Clear chat - deletes the session file for current context
    func clearChat() {
        // Clear the session file
        if let sessionId = currentSessionId {
            claudeService.clearSession(for: sessionId)
        }

        // Reset UI
        messages.removeAll()
        if let fileName = contextFileName {
            messages.append(ChatMessage(
                role: .system,
                content: "Session cleared for \(fileName). Start a new conversation.",
                timestamp: Date()
            ))
        } else {
            showWelcomeMessage()
        }
    }

    private func saveMessages(for sessionId: String) {
        // Filter out system messages about context (they're regenerated)
        let messagesToSave = messages.filter { msg in
            if msg.role == .system {
                // Keep error messages, skip context announcements
                return msg.content.hasPrefix("Error:")
            }
            return true
        }
        claudeService.saveMessages(messagesToSave, for: sessionId)
    }

    private func showWelcomeMessage() {
        messages.append(ChatMessage(
            role: .system,
            content: "Select a context file to start chatting with Claude.",
            timestamp: Date()
        ))
    }
}
