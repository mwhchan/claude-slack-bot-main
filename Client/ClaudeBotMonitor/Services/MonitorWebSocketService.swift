import Foundation

final class MonitorWebSocketService: @unchecked Sendable {
    static let newMessageNotification = Notification.Name("MonitorNewMessage")
    static let aiReplyNotification = Notification.Name("MonitorAIReply")

    private var webSocketTask: URLSessionWebSocketTask?
    private var reconnectTimer: Timer?
    private let port: Int = 3847
    private var shouldReconnect = true
    private var pendingRequests: [String: CheckedContinuation<Result<Void, Error>, Never>] = [:]
    private let lock = NSLock()

    init() {
        connect()
    }

    deinit {
        shouldReconnect = false
        disconnect()
    }

    func connect() {
        guard webSocketTask == nil else { return }

        let url = URL(string: "ws://localhost:\(port)")!
        webSocketTask = URLSession.shared.webSocketTask(with: url)
        webSocketTask?.resume()
        receiveMessage()
    }

    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
    }

    // MARK: - Send Commands

    func deleteMessage(channelId: String, messageTs: String) async throws {
        guard let task = webSocketTask else {
            throw NSError(domain: "MonitorWebSocket", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not connected to bot"])
        }

        let requestId = UUID().uuidString
        let command: [String: Any] = [
            "type": "deleteMessage",
            "requestId": requestId,
            "channelId": channelId,
            "messageTs": messageTs
        ]

        let data = try JSONSerialization.data(withJSONObject: command)
        guard let jsonString = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "MonitorWebSocket", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode command"])
        }

        // Send and wait for response
        let result: Result<Void, Error> = await withCheckedContinuation { continuation in
            lock.lock()
            pendingRequests[requestId] = continuation
            lock.unlock()

            task.send(.string(jsonString)) { [weak self] error in
                if let error = error {
                    self?.lock.lock()
                    if let cont = self?.pendingRequests.removeValue(forKey: requestId) {
                        self?.lock.unlock()
                        cont.resume(returning: .failure(error))
                    } else {
                        self?.lock.unlock()
                    }
                }
            }
        }

        if case .failure(let error) = result {
            throw error
        }
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    self?.handleMessage(text)
                }
                self?.receiveMessage()
            case .failure:
                self?.scheduleReconnect()
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "response":
            handleResponse(json)
        case "newMessage":
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Self.newMessageNotification, object: nil)
            }
        case "aiReply":
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Self.aiReplyNotification, object: nil)
            }
        default:
            break
        }
    }

    private func handleResponse(_ json: [String: Any]) {
        guard let requestId = json["requestId"] as? String else { return }

        lock.lock()
        let continuation = pendingRequests.removeValue(forKey: requestId)
        lock.unlock()

        guard let cont = continuation else { return }

        if let success = json["success"] as? Bool, success {
            cont.resume(returning: .success(()))
        } else {
            let errorMessage = json["error"] as? String ?? "Unknown error"
            cont.resume(returning: .failure(NSError(domain: "MonitorWebSocket", code: -1, userInfo: [NSLocalizedDescriptionKey: errorMessage])))
        }
    }

    private func scheduleReconnect() {
        guard shouldReconnect else { return }
        webSocketTask = nil
        DispatchQueue.main.async { [weak self] in
            self?.reconnectTimer?.invalidate()
            self?.reconnectTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { _ in
                self?.connect()
            }
        }
    }
}
