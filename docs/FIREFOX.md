# Firefox build and review

Aside shares its TypeScript sources with Chrome. The Firefox target supports **desktop Firefox 147+**. Firefox for Android is not a supported target. Version **0.1.6** is available on [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/aside-ai/). Use the store version for permanent installation and automatic updates; the unsigned development ZIP is for temporary testing.

## Try it locally

```sh
npm ci
npm run package:firefox:dev
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `artifacts/unpacked-firefox/manifest.json`. After changing code, rebuild, reload the add-on there, and refresh open web pages. Temporary add-ons are removed when Firefox closes; use this only for testing. Do not assume temporary-install data survives removal. Normal installation and automatic updates require a Mozilla-signed package.

The stable Firefox add-on ID is `aside-ai@worldtheater.github.io`. It is independent of the Chrome public key and extension ID. Firefox data does not automatically migrate from Chrome.

## Reproduce the package

Use Node.js 24 (see `.nvmrc`), npm and Python 3. Extract `aside-<version>-firefox-source.zip` into an empty directory, then run:

```sh
npm ci
npm run build:firefox
npm run lint:firefox
python3 build.py --firefox
```

The runtime output is `dist/firefox/`; the install/upload archive is `artifacts/aside-<version>-firefox.zip`. The separate `*-firefox-source.zip` is for source review, not installation. Runtime files use an explicit allowlist and contain no build dependencies or test credentials. Bundled Dark Reader adaptations are applied by `scripts/build.mjs`; no obfuscation or remotely loaded executable code is used.

The base `manifest.json` remains the Chrome manifest. `manifests/firefox.json` replaces its background worker with a module event page and declares the stable Gecko ID, minimum version and data categories. Chrome's manifest key, minimum version and favicon permission are excluded from the Firefox output.

## Browser differences

- **HTTP model services:** The Firefox manifest explicitly sets an extension-page CSP without `upgrade-insecure-requests`, so authorized HTTP providers keep their configured scheme, including LAN addresses. Firefox's default Manifest V3 policy otherwise upgrades these requests to HTTPS. Script and object sources remain restricted to packaged extension resources; inline scripts and eval remain blocked. HTTP connections still require host access and display the unencrypted-connection warning.
- **Storage:** Chrome retains trusted-context `storage.local`. Firefox uses extension-origin IndexedDB for local settings because `storage.setAccessLevel` is unavailable. API keys remain AES-256-GCM encrypted with a non-exportable device key in a separate IndexedDB. Content scripts receive only the public settings projection. Configuration changes between extension pages are delivered through an extension-origin BroadcastChannel.
- **Sync:** Firefox uses Mozilla account sync for Add-ons; Chrome uses Google Chrome Sync. The same passphrase does not connect the two ecosystems. Firefox and Chrome can each synchronize between their own desktop installations. The passphrase-derived key stays in privileged session storage and must be entered again after browser restart or extension reload.
- **Shortcuts:** The settings button opens Firefox’s **Manage Extension Shortcuts** page directly. Firefox and the operating system may reserve some defaults; users can reassign them.
- **Translation engines:** The action editor, toolbar popup and selection settings offer AI and Microsoft online translation. Aside has no on-device translation integration on Firefox, so that option is hidden. A previously saved native-engine choice prompts for a supported engine and cannot run; it is never silently switched to an online service.
- **Icons:** The popup uses the current tab's browser-provided favicon. Saved passages use a local page icon; Firefox does not provide Chrome's `/_favicon` API.
- **Dark mode access:** Firefox requires optional permissions to be requested directly from an extension-page click. If access is missing, use the dark-mode control in Aside’s browser-toolbar popup to grant it. The floating control then uses the existing grant.
- **Page navigation:** Firefox 147+ provides the Navigation API used to reset tools after same-document page navigation.

## Permissions and data consent

The Firefox manifest declares `websiteContent` and `authenticationInfo`: page/selected/typed text and API credentials go directly to the configured model service when a corresponding feature is used. Optional encrypted configuration sync also includes model credentials. See [the privacy policy](https://worldtheater.github.io/aside/privacy.html). There is no Aside account, analytics endpoint or relay server.

`storage` holds settings and optional encrypted sync data. `activeTab` and `scripting` activate tools on the selected page. `contextMenus` provides selected-text actions. HTTP/HTTPS content-script matches support the floating menu and selection toolbar; optional host permissions authorize model endpoints and page resources used by Dark Reader. Host access must be granted on each installation and is not synchronized.

## Validation

```sh
npm test
npm run test:firefox
npm run lint:firefox
```

The Firefox regression uses Selenium, geckodriver and an isolated temporary profile. Set `FIREFOX_PATH` if the browser is not at its standard location. Selenium Manager may download geckodriver on first run. It uses a local mock model, not a paid API or personal profile. Model requests use a non-localhost hostname mapped to loopback only in the test profile, covering both connection tests and streamed generation without the localhost HTTPS-upgrade exemption. Native test-only permissions are granted solely in that temporary profile.

Real account-to-account Firefox Sync delivery, native keyboard conflicts and Mozilla's signed installation/update path still require manual acceptance. Automated checks of encrypted sync records do not prove delivery through Mozilla's servers. `web-ext lint` can report dynamic-HTML warnings for the shared renderers; model Markdown is sanitized with DOMPurify and interpolated user text is escaped. Review these warnings rather than suppressing them globally.
