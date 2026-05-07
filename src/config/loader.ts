import { existsSync, readFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { CHANNEL_CONTEXT_DIR, CONTEXT_DIR } from "./paths.js";
import type { ChannelConfig } from "../types/index.js";

// Load channel config from config.json (falls back to default config)
export function loadChannelConfig(channelId: string): ChannelConfig | null {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");
	const defaultConfigPath = pathResolve(CONTEXT_DIR, "default", "config.json");

	try {
		// Try channel-specific config first
		if (existsSync(configPath)) {
			const data = readFileSync(configPath, "utf-8");
			return JSON.parse(data) as ChannelConfig;
		}
		// Fall back to default config (for DMs and unconfigured channels)
		if (existsSync(defaultConfigPath)) {
			const data = readFileSync(defaultConfigPath, "utf-8");
			return JSON.parse(data) as ChannelConfig;
		}
	} catch (error: any) {
		// Silently fail - caller can handle null
	}
	return null;
}

// Get channel context file path if it exists (auto-summaries)
export function getChannelContextPath(channelId: string): string | null {
	const contextPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "context.md");
	return existsSync(contextPath) ? contextPath : null;
}

// Get channel memory file path if it exists (manual memory)
export function getChannelMemoryPath(channelId: string): string | null {
	const memoryPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "memory.md");
	return existsSync(memoryPath) ? memoryPath : null;
}

// Get channel config file path if it exists (falls back to default)
export function getChannelConfigPath(channelId: string): string | null {
	const configPath = pathResolve(CHANNEL_CONTEXT_DIR, channelId, "config.json");
	if (existsSync(configPath)) return configPath;

	// Fall back to default config
	const defaultConfigPath = pathResolve(CONTEXT_DIR, "default", "config.json");
	return existsSync(defaultConfigPath) ? defaultConfigPath : null;
}

// Get user context file path if it exists (auto-summaries)
export function getUserContextPath(userId: string): string | null {
	const contextPath = pathResolve(CONTEXT_DIR, "users", userId, "context.md");
	return existsSync(contextPath) ? contextPath : null;
}

// Get user memory file path if it exists (manual memory)
export function getUserMemoryPath(userId: string): string | null {
	const memoryPath = pathResolve(CONTEXT_DIR, "users", userId, "memory.md");
	return existsSync(memoryPath) ? memoryPath : null;
}
