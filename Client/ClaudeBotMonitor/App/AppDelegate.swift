import Cocoa
import Factory

class AppDelegate: NSObject, NSApplicationDelegate {
    @Injected(\.botService) private var botService
    @Injected(\.monitorWebSocketService) private var monitorWebSocketService

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Ensure only one instance is running
        if let bundleId = Bundle.main.bundleIdentifier {
            let runningApps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            if runningApps.count > 1 {
                if let existingApp = runningApps.first(where: { $0 != NSRunningApplication.current }) {
                    existingApp.activate()
                }
                NSApp.terminate(nil)
                return
            }
        }

        // Start the bot automatically on app launch
        botService.start()

        // Touch monitorWebSocketService to ensure it connects
        _ = monitorWebSocketService
    }

    func applicationWillTerminate(_ notification: Notification) {
        botService.stop()
    }
}
