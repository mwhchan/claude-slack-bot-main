import SwiftUI
import Factory

@main
struct ClaudeBotMonitorApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var coordinator = MainCoordinator()

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
        } label: {
            MenuBarIcon(coordinator: coordinator)
        }

        Window("Claude Bot Monitor", id: "main") {
            MainView(coordinator: coordinator)
                .frame(minWidth: 700, minHeight: 500)
                .onAppear {
                    NSApp.activate(ignoringOtherApps: true)
                    NSApp.mainWindow?.makeKeyAndOrderFront(nil)
                    coordinator.isWindowVisible = true
                    coordinator.showNotification(.none)
                }
                .onDisappear {
                    coordinator.isWindowVisible = false
                }
        }
        .defaultSize(width: 1000, height: 650)
        .defaultPosition(.center)
    }
}

struct MenuBarIcon: View {
    var coordinator: MainCoordinator

    var body: some View {
        Image(nsImage: renderIcon())
    }

    private func renderIcon() -> NSImage {
        let size = NSSize(width: 18, height: 16)
        let showNotification = coordinator.shouldShowNotification

        let image = NSImage(size: size, flipped: false) { _ in
            if let symbol = NSImage(systemSymbolName: "staroflife.fill", accessibilityDescription: nil) {
                var config = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
                if showNotification {
                    let color: NSColor = coordinator.currentNotification == .newMessage ? .systemBlue : .systemOrange
                    config = config.applying(.init(paletteColors: [color]))
                }
                if let configured = symbol.withSymbolConfiguration(config) {
                    let symbolSize = configured.size
                    let x = (size.width - symbolSize.width) / 2
                    let y = (size.height - symbolSize.height) / 2
                    configured.draw(at: NSPoint(x: x, y: y), from: .zero, operation: .sourceOver, fraction: 1.0)
                }
            }
            return true
        }

        image.isTemplate = !showNotification
        return image
    }
}

struct MenuBarView: View {
    @Injected(\.botService) private var botService
    @Injected(\.setupManager) private var setupManager
    @Environment(\.openWindow) private var openWindow
    @State private var hasCheckedSetup = false

    var body: some View {
        VStack {
            Button {
                NSApplication.shared.activate(ignoringOtherApps: true)
                openWindow(id: "main")
            } label: {
                Label {
                    Text(botService.isRunning ? "Claude Bot is Running" : "Claude Bot is Stopped")
                        .tint(.primary)
                } icon: {
                    Image(systemName: "circle.fill")
                        .tint(botService.isRunning ? .green : .gray)
                }
            }
            .keyboardShortcut("o", modifiers: .command)

            Divider()

            Button {
                botService.restart()
            } label: {
                Label("Restart", systemImage: "arrow.clockwise")
            }
            .keyboardShortcut("r", modifiers: .command)

            Button {
                if botService.isRunning {
                    botService.stop()
                } else {
                    botService.start()
                }
            } label: {
                Label(botService.isRunning ? "Stop" : "Start",
                      systemImage: botService.isRunning ? "stop.fill" : "play.fill")
            }

            Divider()

            Button("Quit ClaudeBotMonitor") {
                NSApp.terminate(nil)
            }
            .keyboardShortcut("q", modifiers: .command)
        }
        .task {
            guard !hasCheckedSetup else { return }
            hasCheckedSetup = true

            if !setupManager.needsSetup && !botService.isRunning {
                botService.start()
            }
        }
    }
}
