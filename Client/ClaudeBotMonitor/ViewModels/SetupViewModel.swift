import Foundation
import Factory

@Observable
@MainActor
final class SetupViewModel {
    @ObservationIgnored
    @Injected(\.setupManager) private var setupManager

    @ObservationIgnored
    var onSetupComplete: (() -> Void)?

    var projectPath: String {
        get { setupManager.projectPath }
        set { setupManager.projectPath = newValue }
    }
    var isServiceInstalled: Bool { setupManager.isServiceInstalled }
    var isInLoginItems: Bool { setupManager.isInLoginItems }
    var setupError: String? { setupManager.setupError }
    var isProjectPathEmpty: Bool { setupManager.projectPath.isEmpty }

    init() {}

    func browseForProject() {
        setupManager.browseForProject()
    }

    func toggleLoginItems(_ enabled: Bool) {
        if enabled {
            setupManager.addToLoginItems()
        } else {
            setupManager.removeFromLoginItems()
        }
    }

    func completeSetup() -> Bool {
        if setupManager.validateProjectPath() {
            if !setupManager.isServiceInstalled {
                let success = setupManager.installService()
                if success {
                    onSetupComplete?()
                }
                return success
            }
            onSetupComplete?()
            return true
        }
        return false
    }
}
