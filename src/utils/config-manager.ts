/**
 * Config Manager
 * Manages user configuration for watched channels and users
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve as pathResolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = pathResolve(__dirname, "..", "..");
const CONFIG_DIR = pathResolve(ROOT_DIR, "data", "config");
const CONFIG_FILE = pathResolve(CONFIG_DIR, "watched.json");

export interface WatchedChannel {
	id: string;
	name: string;
	purpose?: string;
	addedAt: string;
	addedBy: string;
	addedByName?: string;
}

export interface WatchedUser {
	id: string;
	username: string;
	realName: string;
	addedAt: string;
	addedBy: string;
	addedByName?: string;
}

export interface WatchedConfig {
	channels: Record<string, WatchedChannel>;
	users: Record<string, WatchedUser>;
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

/**
 * Load the watched configuration from file
 */
export function loadWatchedConfig(): WatchedConfig {
	ensureConfigDir();

	if (existsSync(CONFIG_FILE)) {
		try {
			const data = readFileSync(CONFIG_FILE, "utf-8");
			const parsed = JSON.parse(data);
			return {
				channels: parsed.channels || {},
				users: parsed.users || {},
			};
		} catch (error) {
			console.error("Failed to load watched config:", error);
		}
	}

	return { channels: {}, users: {} };
}

/**
 * Save the watched configuration to file
 */
export function saveWatchedConfig(config: WatchedConfig): void {
	ensureConfigDir();

	try {
		writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
	} catch (error) {
		console.error("Failed to save watched config:", error);
		throw error;
	}
}

/**
 * Add a channel to the watched list
 */
export function addWatchedChannel(channel: WatchedChannel): void {
	const config = loadWatchedConfig();
	config.channels[channel.id] = channel;
	saveWatchedConfig(config);
}

/**
 * Remove a channel from the watched list
 */
export function removeWatchedChannel(channelId: string): boolean {
	const config = loadWatchedConfig();
	if (config.channels[channelId]) {
		delete config.channels[channelId];
		saveWatchedConfig(config);
		return true;
	}
	return false;
}

/**
 * Get a watched channel by ID
 */
export function getWatchedChannel(channelId: string): WatchedChannel | null {
	const config = loadWatchedConfig();
	return config.channels[channelId] || null;
}

/**
 * Get all watched channels
 */
export function getAllWatchedChannels(): WatchedChannel[] {
	const config = loadWatchedConfig();
	return Object.values(config.channels);
}

/**
 * Add a user to the watched list
 */
export function addWatchedUser(user: WatchedUser): void {
	const config = loadWatchedConfig();
	config.users[user.id] = user;
	saveWatchedConfig(config);
}

/**
 * Remove a user from the watched list
 */
export function removeWatchedUser(userId: string): boolean {
	const config = loadWatchedConfig();
	if (config.users[userId]) {
		delete config.users[userId];
		saveWatchedConfig(config);
		return true;
	}
	return false;
}

/**
 * Get a watched user by ID
 */
export function getWatchedUser(userId: string): WatchedUser | null {
	const config = loadWatchedConfig();
	return config.users[userId] || null;
}

/**
 * Get all watched users
 */
export function getAllWatchedUsers(): WatchedUser[] {
	const config = loadWatchedConfig();
	return Object.values(config.users);
}

/**
 * Check if a channel is being watched
 */
export function isChannelWatched(channelId: string): boolean {
	const config = loadWatchedConfig();
	return channelId in config.channels;
}

/**
 * Check if a user is being watched
 */
export function isUserWatched(userId: string): boolean {
	const config = loadWatchedConfig();
	return userId in config.users;
}

/**
 * Format the watched list for display
 */
export function formatWatchedList(): string {
	const config = loadWatchedConfig();
	const channelList = Object.values(config.channels);
	const userList = Object.values(config.users);

	const parts: string[] = [];

	if (channelList.length > 0) {
		parts.push("*Watched Channels:*");
		for (const ch of channelList) {
			const addedDate = new Date(ch.addedAt).toLocaleDateString();
			parts.push(`• <#${ch.id}> (added ${addedDate} by ${ch.addedByName || ch.addedBy})`);
		}
	} else {
		parts.push("*Watched Channels:* None");
	}

	parts.push(""); // Empty line

	if (userList.length > 0) {
		parts.push("*Watched Users:*");
		for (const u of userList) {
			const addedDate = new Date(u.addedAt).toLocaleDateString();
			parts.push(`• <@${u.id}> - ${u.realName} (added ${addedDate} by ${u.addedByName || u.addedBy})`);
		}
	} else {
		parts.push("*Watched Users:* None");
	}

	return parts.join("\n");
}
