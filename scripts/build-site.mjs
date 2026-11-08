import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { format } from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (name) =>
  JSON.parse(await readFile(path.join(root, name), "utf8"));
const languages = await readJson("website/languages.json");
const reference = await readJson("website/locales/en.json");
const { feedback: feedbackUrls, homepage: site } =
  await readJson("website/links.json");
const screenshotCopy = await readJson("scripts/fixtures/store-assets.json");
// Public download links must not advance when the next release is still a draft.
const { version, browsers } = await readJson("website/release.json");
const browserIcons = Object.fromEntries(
  await Promise.all(
    browsers.map(async ({ id }) => [
      id,
      (
        await readFile(
          path.join(root, "docs/assets/browsers", `${id}.svg`),
          "utf8",
        )
      )
        .replace(/<!--[\s\S]*?-->\s*/g, "")
        .replace("<svg", '<svg aria-hidden="true" focusable="false"'),
    ]),
  ),
);
const publishedBrowsers = browsers.filter(({ storeUrl }) => storeUrl);
const template = await readFile(
  path.join(root, "website/template.html"),
  "utf8",
);
const repo = "https://github.com/worldtheater/aside";
const check = process.argv.includes("--check");
const url = (locale) => site + (locale.path ? locale.path + "/" : "");
const extensionDownloadUrl = (suffix = "") =>
  `${repo}/releases/download/v${version}/aside-${version}${suffix}.zip`;
const downloadUrl = extensionDownloadUrl();

async function writeOrCheck(file, output) {
  if (check) {
    if ((await readFile(file, "utf8")) !== output)
      throw Error(`${file} is out of date. Run npm run build:site.`);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, output);
  }
}

const assetVersions = Object.fromEntries(
  await Promise.all(
    ["home.css", "home.js"].map(async (file) => [
      file,
      createHash("sha256")
        .update(await readFile(path.join(root, "docs", file)))
        .digest("hex")
        .slice(0, 12),
    ]),
  ),
);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const languageIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h11M8 3v2M5 8c1 4 4 7 8 9M11 5c-1 5-4 9-8 11M13 21l4-10 4 10M14.5 17h5"/></svg>';
const checkIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const ogLocales = {
  en: "en_US",
  "zh-CN": "zh_CN",
  "zh-TW": "zh_TW",
  ja: "ja_JP",
  ko: "ko_KR",
  fr: "fr_FR",
  de: "de_DE",
  es: "es_ES",
  "pt-BR": "pt_BR",
  ru: "ru_RU",
  id: "id_ID",
  it: "it_IT",
  tr: "tr_TR",
  th: "th_TH",
  vi: "vi_VN",
};
for (const language of languages) {
  const copy = await readJson(`website/locales/${language.code}.json`);
  const missing = Object.keys(reference).filter(
    (key) => typeof copy[key] !== "string" || !copy[key].trim(),
  );
  const extra = Object.keys(copy).filter((key) => !(key in reference));
  if (missing.length || extra.length)
    throw Error(`${language.code}: missing [${missing}], extra [${extra}]`);
  const prefix = language.path ? "../" : "./";
  const screenshotPath = path.posix.join("assets", language.screenshots || "");
  const qaSource =
    screenshotCopy[language.screenshots || "en"].philosophySource;
  const screenshotDimensions = {};
  for (const [name, filename] of [
    ["translation", "translation.png"],
    ["qa", "quick-qa.png"],
    ["collection", "collection.png"],
    ["dark", "dark-reading.png"],
  ]) {
    const png = await readFile(
      path.join(root, "docs", screenshotPath, filename),
    );
    // PNG's IHDR stores the actual dimensions of each localized capture.
    screenshotDimensions[`${name}Width`] = png.readUInt32BE(16);
    screenshotDimensions[`${name}Height`] = png.readUInt32BE(20);
  }
  const fragments = {
    version: escape(version),
    darkReader:
      '<a href="https://github.com/darkreader/darkreader">Dark Reader</a>',
    tabsShortcut: "<kbd>Alt</kbd> + <kbd>W</kbd>",
    qaShortcut: "<kbd>Alt</kbd> + <kbd>Q</kbd>",
    textShortcut: "<kbd>Alt</kbd> + <kbd>T</kbd>",
    ollamaLink:
      '<a href="https://docs.ollama.com/api/openai-compatibility">Ollama</a>',
    privacyLink: `<a href="${prefix}privacy.html">${escape(copy.privacyRead)}</a>`,
    developerMode: `<strong>${escape(copy.developerMode)}</strong>`,
    loadUnpacked: `<strong>${escape(copy.loadUnpacked)}</strong>`,
  };
  const renderCopy = (key, parameters = {}, inlineFragments = {}) =>
    escape(copy[key]).replace(/\{(\w+)\}/g, (_, name) => {
      if (name in parameters) return escape(parameters[name]);
      if (name in inlineFragments) return inlineFragments[name];
      if (!(name in fragments))
        throw Error(`${language.code}.${key}: unknown placeholder ${name}`);
      return fragments[name];
    });
  const renderBrowserOptions = (placement) =>
    `<div class="browser-options" role="group" aria-label="${escape(copy.browserLabel)}" hidden>${browsers
      .map(
        (
          browser,
          index,
        ) => `<label class="browser-option" title="${escape(browser.name)}">
        <input type="radio" name="${placement}-browser" value="${escape(browser.id)}"
          aria-label="${escape(browser.name)}" aria-controls="${placement}-install-${escape(browser.id)}"${index === 0 ? " checked" : ""} />
        <span>${browserIcons[browser.id]}</span>
      </label>`,
      )
      .join("")}</div>`;
  const renderStoreInstall = () => `<div class="browser-install">
    ${renderBrowserOptions("hero")}
    ${browsers
      .map((browser, index) => {
        const parameters = {
          browser: browser.name,
          minimumVersion: browser.minimumVersion,
          version: browser.version,
        };
        const action = browser.storeUrl
          ? `<a class="button primary" href="${escape(browser.storeUrl)}">${renderCopy("storeLink", parameters)}</a>`
          : `<button class="button" type="button" disabled>${escape(browser.name)} · ${renderCopy("storePending")}</button>`;
        return `<div id="hero-install-${escape(browser.id)}" data-install-browser="${escape(browser.id)}"${index === 0 ? "" : " hidden"}>
        <div class="install-actions">${action}<a class="text-link" href="#install">${renderCopy("installLink")}</a></div>
        <p class="browser-note">${renderCopy("browserCompatibility", parameters)}${browser.version ? ` ${renderCopy("versionLink", parameters)}` : ""}</p>
      </div>`;
      })
      .join("")}
  </div>`;
  const renderManualInstall = () => `<div class="browser-install">
    ${renderBrowserOptions("manual")}
    ${browsers
      .map((browser, index) => {
        const { manual } = browser;
        const parameters = {
          browser: browser.name,
        };
        const inlineFragments = {
          extensions: `<code>${escape(manual.managementUrl)}</code>`,
          manifest: "<code>manifest.json</code>",
        };
        const steps = [
          ["downloadTitle", "downloadText"],
          ["managerTitle", "managerText"],
          [
            manual.temporary ? "temporaryTitle" : "loadTitle",
            manual.temporary ? "temporaryText" : "loadText",
          ],
        ];
        return `<div id="manual-install-${escape(browser.id)}" data-install-browser="${escape(browser.id)}"${index === 0 ? "" : " hidden"}>
        <ol class="install-steps">${steps.map(([title, description]) => `<li><h3>${renderCopy(title, parameters)}</h3><p>${renderCopy(description, parameters, inlineFragments)}</p></li>`).join("")}</ol>
        <div class="install-actions">
          <a class="button primary" href="${escape(extensionDownloadUrl(manual.archiveSuffix))}">${renderCopy("browserDownload", parameters)}</a>
          <a class="text-link" href="${escape(manual.guideUrl)}">${renderCopy("manualGuide")}</a>
        </div>
        <p class="manual-note">${renderCopy(manual.temporary ? "temporaryNote" : "manualUpdate")}</p>
      </div>`;
      })
      .join("")}
  </div>`;
  const values = {
    language: escape(language.code),
    root: prefix,
    screenshotRoot: `${prefix}${screenshotPath}/`,
    ...screenshotDimensions,
    qaSourceUrl: escape(qaSource.url),
    qaSourceLabel: escape(qaSource.label),
    styleVersion: assetVersions["home.css"],
    scriptVersion: assetVersions["home.js"],
    canonical: url(language),
    ogLocale: ogLocales[language.code],
    brandName: language.code.startsWith("zh") ? "旁白" : "Aside",
    brandSecondary: language.code.startsWith("zh") ? "Aside" : "旁白",
    releaseUrl: `${repo}/releases/tag/v${version}`,
    downloadUrl,
    heroInstall: renderStoreInstall(),
    feedbackUrl: escape(
      feedbackUrls[language.code.startsWith("zh") ? "zh" : "en"],
    ),
    manualInstall: renderManualInstall(),
    structuredData: `<script type="application/ld+json">${JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": `${site}#application`,
        name: "Aside",
        alternateName: "旁白",
        description: copy.seoDescription,
        url: url(language),
        applicationCategory: "BrowserApplication",
        operatingSystem: ["Windows", "macOS", "Linux", "ChromeOS"],
        softwareRequirements: publishedBrowsers
          .map(({ name, minimumVersion }) => `${name} ${minimumVersion}+`)
          .join(" / "),
        softwareVersion: version,
        inLanguage: languages.map(({ code }) => code),
        isAccessibleForFree: true,
        license: `${repo}/blob/main/LICENSE`,
        downloadUrl,
        installUrl: publishedBrowsers.map(({ storeUrl }) => storeUrl),
        sameAs: publishedBrowsers.map(({ storeUrl }) => storeUrl),
        image: `${site}assets/social-preview.png`,
      },
      null,
      2,
    ).replaceAll("<", "\\u003c")}</script>`,
    alternates:
      languages
        .map(
          (item) =>
            `<link rel="alternate" hreflang="${item.code}" href="${url(item)}" />`,
        )
        .join("\n") +
      `<link rel="alternate" hreflang="x-default" href="${site}" />`,
    languageMenu: `<details class="language-menu"><summary aria-label="${escape(copy.languageLabel)}">${languageIcon}<span>${escape(language.short)}</span></summary><div class="language-options" role="navigation" aria-label="${escape(copy.languageLabel)}">${languages.map((item) => `<a href="${prefix}${item.path ? item.path + "/" : ""}" lang="${item.code}" hreflang="${item.code}"${item.code === language.code ? ' aria-current="page"' : ""}><span>${escape(item.name)}</span>${item.code === language.code ? checkIcon : ""}</a>`).join("")}</div></details>`,
  };
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in values) return values[key];
    if (key in copy) return renderCopy(key);
    throw Error(`Unknown template field: ${key}`);
  });
  const output = await format(html, { parser: "html", printWidth: 80 });
  await writeOrCheck(
    path.join(root, "docs", language.path, "index.html"),
    output,
  );
}
const sitemapUrls = [...languages.map(url), `${site}privacy.html`];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((pageUrl) => `  <url><loc>${escape(pageUrl)}</loc></url>`).join("\n")}
</urlset>
`;
await writeOrCheck(path.join(root, "docs", "sitemap.xml"), sitemap);
console.log(
  `${check ? "Checked" : "Built"} ${languages.length} localized product pages and sitemap.`,
);
