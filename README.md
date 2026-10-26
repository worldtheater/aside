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
- **Models and usage:** Configure model services, reasoning levels, and output languages; review usage and manage the local result cache.

## Installation

Requires **Chrome 120+**. The packaged extension does not require Node.js.

1. [Download Aside 0.1.1](https://github.com/worldtheater/aside/releases/download/v0.1.1/aside-0.1.1.zip) from GitHub Releases. Use the extension ZIP, not the automatically generated “Source code” archive.
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Open Aside’s **Settings**, add your service URL, API key, and protocol in **Model connections**, test the connection, choose a model, and save.
5. Open a regular HTTP/HTTPS page and use the selection toolbar, floating menu, or extension popup.

Keep the extracted folder while using the extension. Chrome Web Store review is in progress; the release ZIP is the current installation option.

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

## Data and permissions

Read the [Privacy Policy](https://worldtheater.github.io/aside/privacy.html) for details about local storage, model requests, third parties, and your deletion controls.

- API keys, settings, and collections stay in local extension storage. Usage summaries and request details share the `aside-usage` IndexedDB database; the result cache has its own database. There is no cloud sync. History is read in pages of 50 using time and model indexes, while totals and daily charts are queried separately.
- Each new usage record has a **Details** view with the model instructions, submitted input (including context or batched passages), and received output. Interrupted calls retain any text already received. Authorization headers and API keys are not included. Clearing usage history also deletes these details; clearing the result cache does not. Older records have no request details.
- Running an action sends the relevant page content to your selected model service. Reflections can include up to five saved passages when collection references are enabled.
- API keys are available only to trusted extension pages and the background worker, not content scripts. Local storage is not an encrypted credential vault.
- Page access supports text selection, result insertion, and dark mode. Model connections request access to the configured service address.
- Aside has no telemetry or hosted relay. Uninstalling the extension deletes its local data.

The public `key` in `manifest.json` keeps the extension ID consistent across source builds and release packages. Keep it unchanged and reload the existing extension to update it; do not uninstall it, as that deletes local data. Builds installed before this key was added may have a different ID, and their data does not migrate automatically. See [Loading paths and local data (Chinese)](docs/DEVELOPMENT.md#加载路径与本地数据).

## Development and packaging

```sh
npm test               # Type checking, build, and core tests
npm run test:browser   # Browser regression tests using local Chrome
npm run package        # Create artifacts/aside-0.1.1.zip; requires Python 3
```

Browser tests use isolated profiles and local mock model services. They do not read your personal Chrome profile or call paid models. Install Google Chrome locally, or set `CHROME_PATH` to a custom executable path.

See the [development guide (Chinese)](docs/DEVELOPMENT.md) for the source layout, focused tests, protocol maintenance, and migration notes.

Chrome Web Store listing copy, artwork, permissions declarations, and reviewer instructions are maintained in [web-store/](web-store/README.md).

### Automated releases

Ordinary commits and branch pushes do not create extension packages. Push a version tag such as `v0.1.1` on the commit you want to release to run the [release workflow](.github/workflows/release.yml). It checks version consistency, formatting, generated product pages, and core tests, then builds the ZIP and uploads it to a **draft** GitHub Release with generated release notes. It does not publish the release automatically.

Before tagging, update the versions in `manifest.json`, `package.json`, and `package-lock.json`, regenerate the product pages with `npm run build:site`, and update the installation download link above. Commit these changes first. The tag must match the version in all three files.

```sh
git tag -a v0.1.1 -m "Aside 0.1.1"
git push origin main
git push origin v0.1.1
```

While a release is still a draft, moving its version tag to a newer commit reruns the workflow and replaces the ZIP in the same draft, preserving the release title and notes. Confirm the release is a draft before moving the tag. Published versions must use a new version number; the workflow refuses to overwrite their assets.

The workflow uses GitHub's built-in token; no personal access token or model API key is needed. After the workflow succeeds, sign in to GitHub, download the ZIP from the draft, and verify it before clicking **Publish release**. Draft assets are not publicly downloadable; the website download link becomes available after publication. This workflow only prepares GitHub Releases. Chrome Web Store submission remains manual, and GitHub Pages continues to deploy from `main` / `docs`. See the [release guide (Chinese)](docs/DEVELOPMENT.md#自动发布) for targeting an earlier commit.

## License

[MIT](LICENSE). See [Third-party notices](THIRD_PARTY_NOTICES.md) for bundled dependencies and provider logos.
