/**
 * Vacation Module
 * Exports all vacation-related functionality
 */

export {
	loadVacations,
	getVacationsThisWeek,
	cleanupOldVacations,
	getVacationsFilePath,
	parseMarkdownTable,
	generateMarkdownTable,
	type VacationEntry,
} from "./storage.js";

export { formatVacationMessage } from "./formatter.js";

export {
	initializeVacationScheduler,
	setVacationSlackClient,
	broadcastVacationsNow,
	stopAllVacationJobs,
	enableVacationBroadcast,
	disableVacationBroadcast,
	getVacationBroadcastStatus,
	type VacationBroadcastConfig,
} from "./scheduler.js";
