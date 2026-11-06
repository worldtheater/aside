import SafariServices
import AppKit
import NaturalLanguage
import Translation

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        guard let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] else {
            context.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        // Safari profiles have independent session namespaces. No page text is
        // persisted, logged, or sent to the containing app.
        let profile = (item?.userInfo?[SFExtensionProfileKey] as? UUID)?.uuidString ?? "default"
        Task { @MainActor in
            let result: [String: Any]
            if #available(macOS 26.0, *) {
                result = await AppleTranslationService.shared.handle(message, profile: profile)
            } else {
                result = ["error": "translationUnavailable", "detail": String(localized: "Apple on-device translation requires macOS 26 or later.")]
            }
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: result]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }
}

@available(macOS 26.0, *)
@MainActor
final class AppleTranslationService {
    static let shared = AppleTranslationService()
    private var sessions: [String: TranslationSession] = [:]
    private var tasks: [String: [String: Task<[String: Any], Never>]] = [:]

    func handle(_ message: [String: Any], profile: String) async -> [String: Any] {
        guard let sessionID = message["sessionId"] as? String, UUID(uuidString: sessionID) != nil,
              let command = message["command"] as? String else { return ["error": "invalidRequest"] }
        let owner = profile + ":" + sessionID
        if command == "destroy" {
            for task in tasks.removeValue(forKey: owner)?.values ?? [:].values { task.cancel() }
            sessions.removeValue(forKey: owner)?.cancel()
            return [:]
        }
        if command == "cancel" {
            if let id = message["requestId"] as? String { tasks[owner]?[id]?.cancel() }
            return [:]
        }
        guard let id = message["id"] as? String, UUID(uuidString: id) != nil else { return ["error": "invalidRequest"] }
        let task = Task { @MainActor in
            do {
                return ["value": try await self.run(command, message, owner: owner)]
            } catch is CancellationError {
                return ["error": "cancelled"]
            } catch {
                // A failed native session is never reused. The page's explicit
                // retry creates a fresh connection and TranslationSession.
                if command == "translate" { self.sessions.removeValue(forKey: owner)?.cancel() }
                let code = (error as? BridgeError)?.code ?? "translationFailed"
                return ["error": code, "detail": error.localizedDescription]
            }
        }
        tasks[owner, default: [:]][id] = task
        let result = await task.value
        tasks[owner]?[id] = nil
        if tasks[owner]?.isEmpty == true { tasks[owner] = nil }
        return result
    }

    private func run(_ command: String, _ message: [String: Any], owner: String) async throws -> Any {
        try Task.checkCancellation()
        if command == "detect" {
            guard let text = message["text"] as? String, text.utf16.count <= 200_000 else { throw BridgeError.invalid }
            let recognizer = NLLanguageRecognizer()
            recognizer.processString(text)
            guard let language = recognizer.dominantLanguage else { throw BridgeError(code: "translationDetection") }
            return language.rawValue
        }
        if command == "translate" {
            guard let texts = message["texts"] as? [String], texts.count <= 256,
                  texts.reduce(0, { $0 + $1.utf16.count }) <= 200_000 else { throw BridgeError.invalid }
            guard let session = sessions[owner] else {
                throw BridgeError(code: "translationFailed", detail: String(localized: "The translation session ended. Retry to create a new session."))
            }
            let requests = texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
            let responses = try await session.translations(from: requests)
            try Task.checkCancellation()
            var result = Array<String?>(repeating: nil, count: texts.count)
            for response in responses {
                guard let identifier = response.clientIdentifier, let index = Int(identifier), result.indices.contains(index), result[index] == nil else { throw BridgeError.invalid }
                result[index] = response.targetText
            }
            guard result.allSatisfy({ $0 != nil }) else { throw BridgeError.invalid }
            return result.map { $0! }
        }
        guard ["availability", "prepare", "create"].contains(command),
              let source = message["sourceLanguage"] as? String, let target = message["targetLanguage"] as? String,
              validLanguage(source), validLanguage(target) else { throw BridgeError.invalid }
        guard let (from, to) = await TranslationLanguages.pair(source: source, target: target) else {
            if command == "availability" { return "unavailable" }
            throw BridgeError(code: "translationLanguageUnavailable")
        }
        let availability = TranslationLanguages.availability()
        let status = await availability.status(from: from, to: to)
        try Task.checkCancellation()
        if command == "availability" {
            switch status {
            case .installed: return "available"
            case .supported: return "downloadable"
            case .unsupported: return "unavailable"
            @unknown default: return "unavailable"
            }
        }
        guard status != .unsupported else { throw BridgeError(code: "translationLanguageUnavailable") }
        if command == "prepare" {
            guard let scheme = Bundle(for: SafariWebExtensionHandler.self).object(forInfoDictionaryKey: "AsideURLScheme") as? String else { throw BridgeError.invalid }
            var url = URLComponents()
            url.scheme = scheme
            url.host = "prepare-translation"
            url.queryItems = [URLQueryItem(name: "requestId", value: message["id"] as? String), URLQueryItem(name: "source", value: source), URLQueryItem(name: "target", value: target)]
            guard let address = url.url, NSWorkspace.shared.open(address) else {
                throw BridgeError(code: "translationFailed", detail: String(localized: "Unable to open Aside to prepare languages."))
            }
            return true
        }
        guard status == .installed else { throw BridgeError(code: "translationDownload") }
        sessions.removeValue(forKey: owner)?.cancel()
        let session: TranslationSession
        if #available(macOS 26.4, *) { session = TranslationSession(installedSource: from, target: to, preferredStrategy: .lowLatency) }
        else { session = TranslationSession(installedSource: from, target: to) }
        guard await session.isReady else { session.cancel(); throw BridgeError(code: "translationDownload") }
        do { try Task.checkCancellation() } catch { session.cancel(); throw error }
        sessions[owner] = session
        return true
    }
    private func validLanguage(_ code: String) -> Bool {
        code.range(of: "^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$", options: .regularExpression) != nil
    }
}

private struct BridgeError: LocalizedError {
    let code: String
    var detail: String = ""
    static let invalid = BridgeError(code: "invalidRequest")
    var errorDescription: String? { detail.isEmpty ? code : detail }
}
