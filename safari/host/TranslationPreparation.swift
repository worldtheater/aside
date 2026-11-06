import AppKit
import SwiftUI
import Translation
import SafariServices

@MainActor
final class TranslationPreparationController: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private var requestID: String?

    func open(_ url: URL) {
        guard url.scheme == Bundle.main.object(forInfoDictionaryKey: "AsideURLScheme") as? String,
              url.host == "prepare-translation", let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let items = components.queryItems ?? []
        guard let id = items.first(where: { $0.name == "requestId" })?.value, UUID(uuidString: id) != nil,
              let source = items.first(where: { $0.name == "source" })?.value,
              let target = items.first(where: { $0.name == "target" })?.value,
              [source, target].allSatisfy({ $0.range(of: "^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$", options: .regularExpression) != nil }) else { return }
        cancel()
        requestID = id
        guard #available(macOS 26.0, *) else {
            finish(error: "translationUnavailable", detail: String(localized: "Apple on-device translation requires macOS 26 or later."))
            return
        }
        let view = TranslationPreparationView(source: source, target: target, completion: { [weak self] error in
            guard self?.requestID == id else { return }
            self?.finish(error: error == nil ? nil : "translationFailed", detail: error?.localizedDescription)
        }, cancel: { [weak self] in self?.cancel() })
        let window = NSWindow(contentViewController: NSHostingController(rootView: view))
        window.title = String(localized: "Prepare translation languages")
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.delegate = self
        self.window = window
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func cancel() { finish(error: "cancelled") }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === window { cancel() }
        return false
    }

    private func finish(error: String? = nil, detail: String? = nil) {
        guard let id = requestID else { return }
        requestID = nil
        let oldWindow = window
        window = nil
        guard let identifier = Bundle.main.object(forInfoDictionaryKey: "AsideExtensionIdentifier") as? String else {
            oldWindow?.close()
            return
        }
        var result: [String: Any] = ["requestId": id, "value": true]
        if let error { result["error"] = error }
        if let detail { result["detail"] = detail }
        // Closing the last window terminates the host. Keep it alive until the
        // completion message dispatch has finished.
        SFSafariApplication.dispatchMessage(withName: "translation-prepared", toExtensionWithIdentifier: identifier, userInfo: result) { _ in
            Task { @MainActor in oldWindow?.close() }
        }
    }
}

@available(macOS 26.0, *)
private struct TranslationPreparationView: View {
    let source: String
    let target: String
    let completion: (Error?) -> Void
    let cancel: () -> Void

    @State private var configuration: TranslationSession.Configuration?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Prepare translation languages").font(.headline)
            Text("macOS manages the language download. Translation will continue in Safari when preparation finishes.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel(Text("Preparing languages"))
            HStack { Spacer(); Button("Cancel", role: .cancel, action: cancel).keyboardShortcut(.cancelAction) }
        }
        .padding(24)
        .frame(width: 420)
        .task {
            guard let (from, to) = await TranslationLanguages.pair(source: source, target: target) else {
                completion(TranslationError.unsupportedLanguagePairing)
                return
            }
            if #available(macOS 26.4, *) { configuration = .init(source: from, target: to, preferredStrategy: .lowLatency) }
            else { configuration = .init(source: from, target: to) }
        }
        .translationTask(configuration) { session in
            do { try await session.prepareTranslation(); completion(nil) }
            catch { completion(error) }
        }
    }
}
