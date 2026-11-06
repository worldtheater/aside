import Foundation
import Translation

@available(macOS 26.0, *)
enum TranslationLanguages {
    static func availability() -> LanguageAvailability {
        if #available(macOS 26.4, *) { return LanguageAvailability(preferredStrategy: .lowLatency) }
        return LanguageAvailability()
    }

    // Use the actual Locale.Language values returned by the framework. A
    // hand-built zh-Hans locale can report installed while its session reports
    // notInstalled, despite having the same minimal identifier as Apple's zh.
    static func pair(source: String, target: String) async -> (Locale.Language, Locale.Language)? {
        let languages = await availability().supportedLanguages
        func resolve(_ code: String) -> Locale.Language? {
            let language = Locale.Language(identifier: code == "zh" ? "zh-Hans" : code)
            return languages.first { $0.minimalIdentifier == language.minimalIdentifier }
        }
        guard let from = resolve(source), let to = resolve(target) else { return nil }
        return (from, to)
    }
}
