import Cocoa
import Factory

@Observable
final class SettingsViewModel {
    @ObservationIgnored
    @Injected(\.setupManager) private var setupManager

    @ObservationIgnored
    @Injected(\.envConfigService) private var envConfigService

    @ObservationIgnored
    @Injected(\.botService) private var botService

    var showSaveAlert = false

    var projectPath: String { setupManager.projectPath }
    var isInLoginItems: Bool { setupManager.isInLoginItems }
    var variables: [EnvVariable] { envConfigService.variables }
    var hasChanges: Bool { envConfigService.hasChanges }
    var sections: [String] { envConfigService.sections }

    init() {}

    func variables(in section: String) -> [EnvVariable] {
        envConfigService.variables(in: section)
    }

    func updateValue(for key: String, value: String) {
        envConfigService.updateValue(for: key, value: value)
    }

    func reload() {
        envConfigService.loadConfig()
    }

    func saveAndRestart() {
        envConfigService.saveConfig()
        botService.restart()
        showSaveAlert = true
    }

    func reinstallService() {
        setupManager.uninstallService()
        _ = setupManager.installService()
    }

    func uninstallService() {
        setupManager.uninstallService()
    }

    func toggleLoginItems(_ enabled: Bool) {
        if enabled {
            setupManager.addToLoginItems()
        } else {
            setupManager.removeFromLoginItems()
        }
    }

    func openProject() {
        NSWorkspace.shared.open(URL(fileURLWithPath: setupManager.projectPath))
    }

    func openLogsFolder() {
        NSWorkspace.shared.open(URL(fileURLWithPath: "/tmp"))
    }

    func runGoogleSkillsSetup() {
        let skillsPath = "\(setupManager.projectPath)/.claude/skills/google"

        // Write a temp script and open in Terminal
        let scriptContent = """
            #!/bin/bash
            cd '\(skillsPath)'
            echo "Setting up Google Skills..."
            python3 scripts/setup_environment.py
            echo ""
            echo "Setup complete! You can close this window."
            read -p "Press Enter to close..."
            """

        let tempScript = "/tmp/google_skills_setup.sh"
        try? scriptContent.write(toFile: tempScript, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: tempScript)

        // Open with Terminal
        NSWorkspace.shared.open(
            [URL(fileURLWithPath: tempScript)],
            withApplicationAt: URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app"),
            configuration: NSWorkspace.OpenConfiguration()
        )
    }

    func runGoogleAuthSetup() {
        let skillsPath = "\(setupManager.projectPath)/.claude/skills/google"
        let venvPython = "\(skillsPath)/.venv/bin/python3"

        // Check if venv exists
        guard FileManager.default.fileExists(atPath: venvPython) else {
            print("Google skills not set up. Run Setup first.")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let task = Process()
            task.currentDirectoryURL = URL(fileURLWithPath: skillsPath)
            task.executableURL = URL(fileURLWithPath: venvPython)
            task.arguments = ["scripts/run.py", "auth_manager.py", "setup", "--service", "drive"]

            do {
                try task.run()
            } catch {
                print("Failed to run Google auth: \(error)")
            }
        }
    }

    func openGoogleDataFolder() {
        let dataPath = NSHomeDirectory() + "/Library/Application Support/claude-google-skills"
        NSWorkspace.shared.open(URL(fileURLWithPath: dataPath))
    }

    func runAtlassianAuthSetup() {
        let skillsPath = "\(setupManager.projectPath)/.claude/skills/atlassian"
        let googleSkillsPath = "\(setupManager.projectPath)/.claude/skills/google"
        let venvPython = "\(googleSkillsPath)/.venv/bin/python3"

        // Check if venv exists (shared with Google skills)
        guard FileManager.default.fileExists(atPath: venvPython) else {
            print("Skills not set up. Run Setup first.")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let task = Process()
            task.currentDirectoryURL = URL(fileURLWithPath: skillsPath)
            task.executableURL = URL(fileURLWithPath: venvPython)
            task.arguments = ["scripts/run.py", "auth_setup.py"]

            do {
                try task.run()
            } catch {
                print("Failed to run Atlassian auth: \(error)")
            }
        }
    }

    func openTerminal() {
        let script = "tell application \"Terminal\" to do script \"cd '\(setupManager.projectPath)'\""
        NSAppleScript(source: script)?.executeAndReturnError(nil)
    }

    func getNodeVersion() -> String {
        getCommandOutput("/usr/bin/env", ["node", "--version"])
    }

    private func getCommandOutput(_ command: String, _ args: [String]) -> String {
        let task = Process()
        task.launchPath = command
        task.arguments = args
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        do {
            try task.run()
            task.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Unknown"
        } catch {
            return "Error"
        }
    }
}
