# Microsoft Edge development and testing

Aside uses the shared Chromium implementation on desktop Microsoft Edge 120+. Version 0.1.5 is available on [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/aside/chkehhllhepnnfofjkdbpkgdfmekggnp).

## Build and load

Use Node.js 22+ (Node.js 24 via `.nvmrc`), npm and Python 3:

```sh
npm ci
npm run package:edge:dev
```

Outputs:

- `dist/edge/`: Edge runtime files.
- `artifacts/aside-<version>-edge.zip`: Edge installation/upload package.
- `artifacts/unpacked-edge/`: fixed local debugging directory, refreshed from the same ZIP.

Open `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `artifacts/unpacked-edge/`. After rebuilding, reload the existing extension and refresh web pages. Keep the directory in place and do not uninstall the extension to update it.

## Browser differences

- MV3 uses the shared module service worker, content scripts and permissions.
- The build removes Chrome's public `key` and any `update_url`. Edge Add-ons assigns its own store ID and manages updates. Do not use the Firefox ZIP.
- An unpacked Edge ID depends on its directory. Keep the fixed debug path; different devices' unpacked installs are not guaranteed to have the same ID. Store installs will share the assigned Edge ID. A store install may coexist with the debug extension and does not inherit its local data.
- `src/browser.ts` selects Edge/Microsoft labels and `edge://extensions/shortcuts` using the desktop Edge UA token; Firefox identification remains based on the extension scheme. This is a display/navigation distinction, not an authorization check. It also handles the Chrome build when installed in Edge.
- Edge uses the Chromium favicon interface and trusted local/session storage. API keys retain the same local encryption and content-script isolation as Chrome.
- Optional encrypted configuration sync uses Edge Sync with a Microsoft account. It requires the same extension ID and enabled extension sync on both devices. It does not exchange settings with Chrome or Firefox. Site permissions remain local.

## Validation

```sh
npm test
npm run test:edge
```

`test:edge` uses an installed Microsoft Edge through Playwright's `msedge` channel, isolated profiles and local mock model responses. Set `EDGE_PATH` to override the executable. It checks the packaged manifest, runtime identification, favicon, shortcut registration/settings, local key encryption and restart, inline translation, Quick Q&A, text translation, website controls/dark mode, and configuration merge/encryption between two isolated profiles.

The sync test transfers encrypted `storage.sync` entries between profiles; it does **not** log in to Microsoft or prove delivery through the real Edge Sync service. Before release, validate that separately with two devices on the same Microsoft account and extension ID. Windows device testing was confirmed by the maintainer on November 3, 2026. Automated browser checks use a current Edge release, not every version back to 120.

## Distribution

Version-tag builds attach an independent Edge ZIP to the draft GitHub Release alongside Chrome and Firefox artifacts. They do not submit it to Edge Add-ons. Submit the Edge ZIP through Microsoft Partner Center after testing, using the [published privacy policy](https://worldtheater.github.io/aside/privacy.html), which includes Edge Sync.
