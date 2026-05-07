// Channel configuration interfaces

export interface JiraConfig {
	project: string;
	site: string;
}

export interface ConfluenceConfig {
	space: string;
	spaceId: string;
	cloudId: string;
	homepageId?: string;
}

export interface NotebookLmConfig {
	url: string;
	name?: string;
	description?: string;
	profile?: string;
}

export interface ProjectStatusConfig {
	enabled?: boolean;
	schedule?: string;
	lastRun?: string;
	googleDocs?: string[];
	slackChannels?: string[];
	reportSections?: string[];
	customContext?: string;
	githubRepos?: string[];  // e.g., ["accedobroadband/record-ott"]
}

export interface ChannelConfig {
	type?: string;
	id: string;
	name: string;
	displayName?: string;
	claudeModelThinking?: string;
	claudeModelQuick?: string;
	jira?: JiraConfig[];
	confluence?: ConfluenceConfig[];
	notebookLm?: NotebookLmConfig[];
	projectStatus?: ProjectStatusConfig;
}

// Slack file interfaces

export interface SlackFileInfo {
	id: string;
	name: string;
	mimetype: string;
	filetype: string;
	url_private_download?: string;
	url_private?: string;
}

export interface DownloadedFile {
	id: string;
	name: string;
	localPath: string;
	mimetype: string;
}

// Slack Canvas interface

export interface CanvasInfo {
	id: string;
	title: string;
	content: string;
	permalink?: string;
}

// Queue interfaces

export interface ClaudeRequestItem {
	execute: () => Promise<void>;
	channelId: string;
}

// Session tracking is in state/index.ts (ThreadSession interface and threadSessions map)
