import Factory

extension Container {
    // MARK: - Services

    var setupManager: Factory<SetupManager> {
        self { SetupManager() }
            .singleton
    }

    var botService: Factory<BotService> {
        self { BotService(projectPath: self.setupManager().projectPath) }
            .singleton
    }

    var envConfigService: Factory<EnvConfigService> {
        self { EnvConfigService() }
            .singleton
    }

    var logService: Factory<LogService> {
        self { LogService(projectPath: self.setupManager().projectPath) }
            .singleton
    }

    var claudeService: Factory<ClaudeService> {
        self { ClaudeService() }
            .singleton
    }

    var slackService: Factory<SlackService> {
        self { SlackService() }
            .singleton
    }

    var monitorWebSocketService: Factory<MonitorWebSocketService> {
        self { MonitorWebSocketService() }
            .singleton
    }
}
