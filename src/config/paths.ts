import { dirname, resolve as pathResolve } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

// Root directory is one level up from dist/ (after esbuild bundles to dist/bot.js)
export const ROOT_DIR = pathResolve(__dirname, "..");

// Data directory structure
export const DATA_DIR = pathResolve(ROOT_DIR, "data");
export const LOG_DIR = pathResolve(DATA_DIR, "logs");
export const MESSAGES_DIR = pathResolve(DATA_DIR, "messages");
export const CONTEXT_DIR = pathResolve(DATA_DIR, "context");
export const CHANNEL_CONTEXT_DIR = pathResolve(CONTEXT_DIR, "channels");
export const USER_CONTEXT_DIR = pathResolve(CONTEXT_DIR, "users");
export const SLACK_FILES_DIR = pathResolve(DATA_DIR, "slack-files");
