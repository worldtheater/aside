import Foundation

@main
struct NativeTranslationSmoke {
    @MainActor
    static func main() async throws {
        guard #available(macOS 26.0, *) else { print("SKIP: Apple translation requires macOS 26."); return }
        let service = AppleTranslationService.shared
        let session = UUID().uuidString
        func send(_ command: String, _ fields: [String: Any] = [:], profile: String = "test") async -> [String: Any] {
            var message = fields
            message["command"] = command
            message["sessionId"] = session
            message["id"] = UUID().uuidString
            return await service.handle(message, profile: profile)
        }
        func expect(_ condition: Bool, _ message: String) throws {
            if !condition { throw NSError(domain: "AsideNativeTest", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
        }
        let detected = await send("detect", ["text": "The quick brown fox jumps over the lazy dog."])
        try expect(detected["value"] as? String == "en", "Native English detection failed: \(detected)")
        let invalid = await send("translate", ["texts": [12]])
        try expect(invalid["error"] as? String == "invalidRequest", "Invalid text accepted")
        let unknown = await send("read-file", ["path": "/tmp"])
        try expect(unknown["error"] as? String == "invalidRequest", "Unknown native command accepted")
        let pair = ["sourceLanguage": "en", "targetLanguage": "zh"]
        let availability = await send("availability", pair)
        try expect(["available", "downloadable"].contains(availability["value"] as? String ?? ""), "English/Chinese unavailable: \(availability)")
        print("PASS: Native detection, validation and language availability (\(availability["value"] ?? "unknown")).")
        if availability["value"] as? String == "available" {
            let created = await send("create", pair)
            try expect(created["error"] == nil, "Create failed: \(created)")
            for texts in [["Hello world.", "Good morning."], ["The weather is nice today."]] {
                let translated = await send("translate", ["texts": texts])
                let values = translated["value"] as? [String] ?? []
                try expect(values.count == texts.count && !values.contains(where: \.isEmpty) && values != texts, "Translation failed: \(translated)")
            }
            let other = await send("translate", ["texts": ["Hello"]], profile: "other")
            try expect(other["error"] != nil, "Session leaked across Safari profiles")
            _ = await send("destroy")
            let released = await send("translate", ["texts": ["Hello"]])
            try expect(released["error"] != nil, "Released session still usable")
            print("PASS: Real Apple translations across batches, profile isolation and release.")
        } else { print("SKIP: Translation smoke needs installed English/Chinese packs; no implicit download.") }
    }
}
