// Format timestamp as HH:MM:SS
const timestamp = () => new Date().toLocaleTimeString('en-US', { hour12: false });

export const log = {
	// Use console.log for all levels so logs are interleaved chronologically
	// (console.error goes to stderr which may display separately in log viewers)
	error: (...args: unknown[]) => console.log(`[${timestamp()}] [ERROR]`, ...args),
	warn: (...args: unknown[]) => console.log(`[${timestamp()}] [WARN]`, ...args),
	info: (...args: unknown[]) => console.log(`[${timestamp()}] [INFO]`, ...args),
	debug: (...args: unknown[]) => console.log(`[${timestamp()}] [DEBUG]`, ...args),
	verbose: (...args: unknown[]) => console.log(`[${timestamp()}] [VERBOSE]`, ...args),
};
