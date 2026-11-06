import Cocoa

@main
@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    private let preparation = TranslationPreparationController()

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { preparation.open(url) }
    }

    func applicationWillTerminate(_ notification: Notification) {
        preparation.cancel()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
