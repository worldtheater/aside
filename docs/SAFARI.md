# Safari for macOS

Safari support is a local development preview. It uses the same TypeScript source as the other browsers and a small macOS app containing a Safari Web Extension. The debug build is ad-hoc signed; the App Store commands below create a separate team-signed archive. It is not yet available in the App Store. iOS and iPadOS are outside this initial scope.

Requirements: macOS 14 or later with **Safari 26 or later**, full Xcode (26 or later), Node.js 22+, and Python 3. If the active developer directory points to Command Line Tools, select the installed Xcode in Xcode Settings → Locations before building.

## Build and run

```sh
npm ci
npm run safari:run
```

The command builds the Safari resources, generates an Xcode project, compiles an ad-hoc-signed debug app, and opens its setup window. It does not require an Apple Developer team for local testing.

The fixed debug outputs are:

- `artifacts/safari/Debug/Aside.app` — the app to open locally.
- `artifacts/safari/project/Aside/Aside.xcodeproj` — the generated Xcode project.
- `artifacts/unpacked-safari/` — unpacked web extension resources.
- `artifacts/aside-<version>-safari.zip` — web extension resources for conversion/packaging, **not a Safari-installable app or signed distribution package**.

Safari cannot install the resource ZIP through “Load unpacked.” Use the macOS app:

1. In Safari Settings → Advanced, enable **Show features for web developers**.
2. In Safari's Develop menu, enable **Allow Unsigned Extensions** for local development. Depending on the Safari version, this setting can be under Develop → Developer Settings. Safari may reset it after restarting.
3. Open `Aside.app`, choose **Open Safari Settings**, and enable Aside under Extensions.
4. Allow website access on a test page. Open Aside's toolbar popup and add a model connection; approve access to that model service when prompted.

If Aside is still missing from Extensions after enabling unsigned extensions, keep Safari open and run `npm run safari:run` again. Apple documents a macOS 27 issue where unsigned extensions may not appear until rebuilt **after** the checkbox is enabled ([issue 183044008](https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes)). Reopen Safari Settings → Extensions after the build.

Retain the debug app at its fixed path. Rebuild to update it, then refresh test pages so old content scripts are replaced. If Safari keeps an old background page, disable and re-enable the extension or restart Safari. Do not uninstall the extension just to update it; removing it can remove its local data.

## Commands

```sh
npm run build:safari          # dist/safari/ only
npm run package:safari        # resource ZIP only
npm run package:safari:dev    # ZIP + fixed resources + Xcode project + debug app
./script/build_and_run.sh --verify  # rebuild, launch, confirm app process
npm run test:safari           # Safari background/storage regression checks
```

`script/build_and_run.sh` is also the Codex Run action. `--debug` attaches LLDB after launch; `--logs` streams app logs; `--telemetry` filters the app's subsystem. The app does not log model requests or API keys.

Native settings and bundle identifiers are in `safari/config.json`; host customizations are in `safari/host/`. The project under `artifacts/safari/project/` is regenerated each time. Do not keep signing changes or source edits there. App and extension versions are derived from the web manifest. The bundle identifiers stay fixed across rebuilds.

## Safari-specific behavior

- **No cross-device configuration sync.** There is no Sync page, the background does not start the sync controller, and `sync.*` messages are rejected. Safari's own extension syncing does not enable Aside configuration sync.
- Configuration, API keys, collections, history, and cached results remain local to Safari. They are separate from Chrome, Edge, and Firefox installations.
- Sensitive configuration uses an extension-origin IndexedDB store, as in Firefox. API keys stay encrypted with a non-exportable AES-GCM device key in IndexedDB; they are not placed in content-script-accessible `storage.local`.
- Host permission patterns omit explicit ports, as required by Safari. Model URLs retain their configured ports for actual requests.
- API services support HTTPS and trusted HTTP addresses. Website/service access is still controlled by Safari; it can be denied or revoked independently of the saved connection.
- The existing Option+W, Option+Q, and Option+T command suggestions are retained. Change actual bindings in **Safari → Settings → Extensions → Aside** (Safari 26+). The extension does not open Chromium settings pages.
- Favicons use browser-provided tab icons when available; saved entries fall back to Aside's local page icon.
- The background uses a nonpersistent module event page. Dark Reader's proxy remains bundled and is injected with the scripting API; no remotely hosted executable code is added.

Apple's converter may report `type`, `persistent`, or `match_origin_as_fallback` as unsupported. Its compatibility check can lag Safari: module background pages are supported since Safari 16.4 and origin-fallback matching since 18.4. Do not remove these solely to suppress converter warnings. References: [Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [Safari 18.4](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes).

## Validation and distribution boundary

The automated Safari test exercises the **built background code with API doubles**, including startup with sync disabled, an HTTP mock model service, local credential encryption, and content-script access boundaries. It does not install an extension in Safari. Xcode compilation and launching the container app also do not prove browser behavior.

Before distributing, test in Safari itself: enabling/granting access; saving and reopening model connections; HTTPS and HTTP model requests; inline translation; selected-text tools; Quick Q&A; text translation; dark mode; collections; usage; and shortcuts. Check that no sync entry appears, including direct `#sync` navigation. Use test data and a local model fixture where possible.

App Store delivery is a separate step: Apple Developer membership, team signing, App Store Connect metadata/privacy information, and an archived build are required. This change does not publish an app or alter the existing Chrome/Edge/Firefox release workflow. See [Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

## App Store preparation

The maintainer confirmed basic Safari functionality on 2026-11-05. The team-signed release still needs TestFlight/installation validation and App Review; a successful local archive is not App Store approval.

Sign in to the paid Apple Developer team in Xcode → Settings → Accounts. Keep the existing bundle identifiers in `safari/config.json` for the app and extension. The release commands obtain the team and build number from the environment, so account-specific signing settings do not enter the repository. Both targets use automatic signing. Xcode may register identifiers, create certificates, or refresh provisioning profiles with `-allowProvisioningUpdates`.

```sh
export SAFARI_TEAM_ID=YOURTEAMID
export SAFARI_BUILD_NUMBER=1
npm run safari:archive
npm run safari:export
```

Use your actual 10-character team identifier, and a new positive build number for each upload. The public version comes from `manifest.json`. `safari:archive` rebuilds the Safari resources, regenerates the project with team/build settings, then archives **Release** for both Apple silicon and Intel. It checks both bundle IDs, versions, signing teams, and architectures. Existing archives are kept; use a new build number rather than overwriting one.

Outputs are in `artifacts/safari/release/<version>-<build>/`:

- `Aside.xcarchive` — open in Xcode Organizer to validate or upload to App Store Connect.
- `ExportOptions.plist` — local App Store Connect export settings.
- `export/Aside.pkg` — signed installer for upload through Transporter (actual filename follows the Xcode export).

`safari:export` exports locally only; it does not upload, submit for review, or publish. It requires the same team and build variables as the archive. Release archives do not replace the local debug app.

In App Store Connect, create a **macOS** app using the main bundle ID. Configure product metadata, screenshots, support/privacy URLs, pricing, age rating, and review information, then select the uploaded build. The Safari resource ZIP is not the upload artifact for this Xcode workflow. Distribution provisioning/certificates are separate from the Developer ID identity used for downloads outside the store.

Native copyright and application category are in `safari/config.json`. The app and extension declare only exempt encryption: network TLS and credential encryption use OS/Safari Web Crypto APIs, with no bundled cryptographic implementation. Reassess this declaration if dependencies or encryption behavior change. App Privacy answers must also account for content sent to user-configured model services; do not equate having no developer-operated server with having no outbound data.

The Mac icon set is generated from the existing vector brand artwork with `npm run build:icons:safari`. Commit those generated assets with the source change; normal archives use them without starting a browser. Review-specific copy, screenshots, and credentials belong under ignored `artifacts/`, not in the source repository. Never include reviewer API keys in an app or commit.

Before submitting, publish the Safari update to the existing privacy policy URL and supply reviewer-only access to a working model endpoint. Explicitly state that Safari has no cross-device configuration sync. Use actual Safari screenshots; Chromium screenshots are not evidence of Safari UI validation.

References: [distribution](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension), [app records](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/), [Mac screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).
