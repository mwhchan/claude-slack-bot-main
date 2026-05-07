import { WebSocketServer, WebSocket } from "ws";
import { log } from "../utils/log.js";

// Monitor WebSocket state
const monitorClients = new Set<WebSocket>();
let monitorWss: WebSocketServer | null = null;

// Slack client reference for delete operations (set via setMonitorSlackClient)
let slackClient: any = null;

export function setMonitorSlackClient(client: any): void {
	slackClient = client;
}

// Start the WebSocket server for Mac Client Monitor
export function startMonitorWebSocket(port: number): void {
	try {
		monitorWss = new WebSocketServer({ port });

		monitorWss.on("connection", (ws) => {
			monitorClients.add(ws);
			log.debug(`[Monitor] Client connected (${monitorClients.size} total)`);

			ws.on("message", async (data) => {
				try {
					const message = JSON.parse(data.toString());
					await handleMonitorCommand(ws, message);
				} catch (err: any) {
					log.error(`[Monitor] Failed to parse message: ${err.message}`);
				}
			});

			ws.on("close", () => {
				monitorClients.delete(ws);
				log.debug(`[Monitor] Client disconnected (${monitorClients.size} total)`);
			});

			ws.on("error", (err) => {
				log.debug(`[Monitor] Client error: ${err.message}`);
				monitorClients.delete(ws);
			});
		});

		monitorWss.on("error", (err: any) => {
			if (err.code === "EADDRINUSE") {
				log.debug(`[Monitor] Port ${port} in use, skipping WebSocket server`);
			} else {
				log.error(`[Monitor] WebSocket server error: ${err.message}`);
			}
		});

		log.info(`[Monitor] WebSocket server started on port ${port}`);
	} catch (err: any) {
		log.error(`[Monitor] Failed to start WebSocket server: ${err.message}`);
	}
}

// Broadcast event to all connected monitor clients
export function broadcastMonitorEvent(type: "newMessage" | "aiReply", data?: Record<string, any>): void {
	const message = JSON.stringify({ type, timestamp: Date.now(), ...data });
	for (const client of monitorClients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message);
		}
	}
}

// Handle commands from monitor clients
async function handleMonitorCommand(ws: WebSocket, message: any): Promise<void> {
	const { type, requestId } = message;

	const sendResponse = (success: boolean, error?: string) => {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "response", requestId, success, error }));
		}
	};

	switch (type) {
		case "deleteMessage": {
			const { channelId, messageTs } = message;
			if (!channelId || !messageTs) {
				sendResponse(false, "Missing channelId or messageTs");
				return;
			}
			if (!slackClient) {
				sendResponse(false, "Slack client not initialized");
				return;
			}
			try {
				await slackClient.chat.delete({
					channel: channelId,
					ts: messageTs,
				});
				log.info(`[Monitor] Deleted message ${channelId}:${messageTs}`);
				sendResponse(true);
			} catch (err: any) {
				log.error(`[Monitor] Failed to delete message: ${err.message}`);
				sendResponse(false, err.message);
			}
			break;
		}
		default:
			log.debug(`[Monitor] Unknown command: ${type}`);
			sendResponse(false, `Unknown command: ${type}`);
	}
}
