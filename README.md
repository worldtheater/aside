<img src="icons/icon.svg" alt="Aside logo" width="96" height="96">

# Aside / 旁白

A Chrome extension for translating, understanding, and collecting what you read on the web. Built with TypeScript, native HTML/CSS, and Manifest V3. No companion server required.

[Product website](https://worldtheater.github.io/aside/) · [中文介绍](https://worldtheater.github.io/aside/zh/) · [Installation](#installation) · [Privacy policy](https://worldtheater.github.io/aside/privacy.html)

## Features

- **Inline translation:** Translate the visible area with a small preload margin, then process more content as you scroll or the page changes. Keep the original text and restore it at any time.
- **Reading actions:** Translate, explain classical texts across languages, clarify content, extract key points, or define your own actions. Summary actions process the full page.
- **Quick Q&A:** Ask about selected text or page content, or clear the quote to ask an independent question. Answers stream after you submit your question.
- **Reading tools:** A selection toolbar and floating menu, with configurable color palettes and result styles.
- **Website dark mode:** Powered by [Dark Reader](https://github.com/darkreader/darkreader), with per-site settings.
- **Collections and reflections:** Save, search, and copy results. Generate a short reflection with your chosen model, optionally drawing on saved passages.
- **Encrypted configuration sync (next store update):** Sync model connections, API keys, reading actions, and reflection settings through your Chrome account using a shared passphrase. Collections and request history stay on each device.
- **Models and usage:** Configure model services, reasoning levels, and output languages; review usage and manage the local result cache.

## Installation

Requires **Chrome 120+**.

[**Install from the Chrome Web Store**](https://chromewebstore.google.com/detail/aside/fpepddfodhahbemmlphncnaifledggcf).

After installing, open Aside’s **Settings → Model connections**, add your model service, and save. Open a regular HTTP/HTTPS page to use the selection toolbar, floating menu, or extension popup.

### Manual installation

Alternatively, load the packaged extension from GitHub Releases. No Node.js is required.

1. [Download Aside 0.1.1](https://github.com/worldtheater/aside/releases/download/v0.1.1/aside-0.1.1.zip) from GitHub Releases. Use the extension ZIP, not the automatically generated “Source code” archive.
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Open Aside’s **Settings**, add your service URL, API key, and protocol in **Model connections**, test the connection, choose a model, and save.
5. Open a regular HTTP/HTTPS page and use the selection toolbar, floating menu, or extension popup.

Keep the extracted folder while using the unpacked extension.

### Build from source

For development, use Node.js 22+ and npm. `.nvmrc` selects Node.js 24.

```sh
git clone https://github.com/worldtheater/aside.git
cd aside
npm ci
npm run build
```

Load the **repository root** as the unpacked extension. After changing code, run `npm run build`, reload the extension in Chrome, and refresh open web pages. Generated JavaScript lives in the repository root and is excluded from Git; edit `src/`.

The **About** page includes the version, project and support links, privacy policy, and open-source acknowledgements. Model setup is also available from the reflection card.

### Interface languages

Available in 15 interface languages: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, German, Spanish, Portuguese (Brazil), Russian, Indonesian, Italian, Turkish, Thai, and Vietnamese. Use the language menu in the top bar to choose a language or follow your system language. Traditional Chinese is also selected for Chinese system locales in Taiwan, Hong Kong, and Macao. Portuguese system locales use Brazilian Portuguese.

Translation targets and other built-in actions default to **Follow interface language**, which uses the current interface language when a request runs. You can choose a fixed language separately; saved explicit language choices stay unchanged.

### Today's thought

With a model configured, Aside generates a reflection the first time you open Collection each day, using your local date. Today's saved result is reused when you return or reload; the refresh button can generate another at any time. Hidden reflections do not generate automatically. If generation fails, the previous result is kept and you can retry with the refresh button.

### Model services

Aside supports four protocols: OpenAI Responses, OpenAI-compatible Chat Completions, Anthropic Messages, and Gemini Interactions. New OpenAI Responses connections use implicit prefix caching by default. Prefix caching, maximum output tokens, and batching/concurrency controls are grouped under **Advanced settings**. Connection tests only retrieve the model list; they do not generate text. A successful test does not guarantee that every listed model supports the selected generation protocol.

**Duplicate connection** opens a new draft with the current provider settings, API key, model list, and advanced settings. Choose another model and save to add a separate connection.

Requests go directly from the extension to your configured service. Use an HTTPS endpoint or a supported local HTTP endpoint. Aside does not depend on another local project or background service. UI assets and runtime dependencies are bundled with the extension, without a CDN dependency.

### Website dark mode

Aside bundles the **Dark Reader dynamic theme engine** to adapt web page colors. You do not need to install the separate Dark Reader extension. Choose on, off, or follow system from the floating menu; the setting is saved per site, separately from Aside's own interface theme.

The engine runs locally and may fetch stylesheets or images referenced by the page. It does not call a model or download executable code. Dark Reader's MIT license is included in [licenses/darkreader.txt](licenses/darkreader.txt); build-time adaptations are described in [Third-party notices](THIRD_PARTY_NOTICES.md).

### Keyboard shortcuts

| Feature | Default shortcut | Behavior |
| --- | --- | --- |
| Recent tabs | `Alt+W` | Switch back and forth between the two most recently visited tabs in the current window |
| Quick Q&A | `Alt+Q` | Quote selected text, or page content if nothing is selected, and open the question panel |

On macOS, Alt is Option. The **Keyboard shortcuts** page in the sidebar shows Chrome's actual bindings and opens `chrome://extensions/shortcuts` for editing. Reassign a shortcut there if another extension already uses it.

Quick Q&A is unavailable on extension pages, blank pages, browser-internal pages, and pages where Chrome blocks script injection. Recent-tab switching does not require page injection. After restarting the browser or reloading the extension, visit two tabs to establish a new recent-tab history.

## Configuration sync

Available in the current source build; planned for the next Chrome Web Store update. The currently published store version does not include sync.

Open **Settings → Sync** to enable optional sync through your existing Chrome account. The page waits for existing synced settings by default. Only on the first device, choose **First-time setup** and set a passphrase of at least 12 characters. On another device, sign in to the same Chrome account, enable Chrome sync, install Aside with the same extension ID, and wait for the synced settings to arrive, then enter that passphrase to join. Do not select first-time setup again while waiting for delivery. Chrome controls delivery; Aside cannot detect whether your account sync is enabled or confirm delivery to another device.

- Sync merges model connections (with their API keys), actions, and reflection settings as separate records. All reflection settings travel together as one record. Language, theme, appearance, website preferences, quick-action visibility and order stay local. Collections, generated reflections, request history, caches, and discovered model lists are also excluded. Browser site permissions are granted separately on each device. After joining, the sync page lists model services that need access on this browser. Choose **Allow access** to authorize those addresses; this does not send a model request.
- The shared records are compressed and encrypted on your device with AES-256-GCM. The key is derived from your passphrase using PBKDF2-HMAC-SHA-256 with 600,000 iterations and a random salt. Chrome receives encrypted data and revision metadata, not your passphrase or plaintext configuration.
- The passphrase is never saved. The derived key stays only in trusted extension session storage; restart Chrome or reload the extension and enter the passphrase again. Existing local settings remain usable while sync is locked. Local API key encryption uses a separate device key and does not depend on the sync passphrase.
- Independently created records keep their own IDs and are combined; records received from another device keep the same ID. For the same record, the latest saved whole record wins (device ID breaks timestamp ties); deletion takes precedence, including over later offline edits. Deletion markers are retained so old devices cannot resurrect deleted records. Local saves record their time even while sync is stopped or locked. Receiving an update does not change its modification time.
- On first joining, records with no known modification time adopt the synced version for matching IDs after confirmation; unique local records are retained. Synced default-generation and default-decision model choices only fill unset defaults; an existing local choice is never replaced. A suggestion is used only if its connection still exists and matches the model purpose. Stopping sync affects only this device. **Delete synced settings** removes the encrypted synced copy while preserving local settings; use this to start again if you forget the passphrase. The passphrase cannot be recovered.
- Chrome Sync has a 100 KB total quota and an 8 KB per-item quota. Aside splits encrypted snapshots into chunks and reserves room for publication; a snapshot is limited to 42,000 base64 characters after compression and encryption. Oversized settings are rejected without replacing the previous synced copy.

## Data and permissions

Read the [Privacy Policy](https://worldtheater.github.io/aside/privacy.html) for details about local storage, model requests, third parties, and your deletion controls.

- API keys are encrypted locally with AES-256-GCM, including copies in the local sync records. The non-exportable encryption key is kept in this browser’s IndexedDB and is never included in Chrome Sync. This reduces plaintext exposure but is not an operating-system keychain or protection against access to the full browser profile or a compromised extension. Existing plaintext credentials are converted on upgrade; old backups are not rewritten. Settings and collections stay in local extension storage. Usage summaries and request details share the `aside-usage` IndexedDB database; the result cache has its own database. Optional encrypted configuration sync uses Chrome Sync; collections, request history, generated reflections, and caches are not synchronized. History is read in pages of 50 using time and model indexes, while totals and daily charts are queried separately.
- Each new usage record has a **Details** view with the model instructions, submitted input (including context or batched passages), and received output. Interrupted calls retain any text already received. Authorization headers are not stored. Known configured API keys are redacted from new request details and results, including streamed output; existing history is not rewritten. Clearing usage history also deletes these details; clearing the result cache does not. Older records have no request details.
- Running an action sends the relevant page content to your selected model service. Reflections can include up to five saved passages when collection references are enabled.
- API keys are available only to trusted extension pages and the background worker, not content scripts.
- Page access supports text selection, result insertion, and dark mode. Model connections request access to the configured service address.
- Aside has no telemetry or hosted relay. Uninstalling the extension deletes its local data.

The public `key` in `manifest.json` keeps the extension ID consistent across source builds and release packages. Keep it unchanged and reload the existing extension to update it; do not uninstall it, as that deletes local data. Builds installed before this key was added may have a different ID, and their data does not migrate automatically. See [Loading paths and local data (Chinese)](docs/DEVELOPMENT.md#加载路径与本地数据).

## Development and packaging

```sh
npm test               # Type checking, build, and core tests
npm run test:browser   # Browser regression tests using local Chrome
npm run package        # Create artifacts/aside-0.1.2.zip; requires Python 3
```

Browser tests use isolated profiles and local mock model services. They do not read your personal Chrome profile or call paid models. Install Google Chrome locally, or set `CHROME_PATH` to a custom executable path.

See the [development guide (Chinese)](docs/DEVELOPMENT.md) for the source layout, focused tests, protocol maintenance, and migration notes.

## License

[MIT](LICENSE). See [Third-party notices](THIRD_PARTY_NOTICES.md) for bundled dependencies and provider logos.
