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
const { version } = await readJson("package.json");
const { minimum_chrome_version: minimumChromeVersion } =
  await readJson("manifest.json");
const template = await readFile(
  path.join(root, "website/template.html"),
  "utf8",
);
const site = "https://worldtheater.github.io/aside/";
const repo = "https://github.com/worldtheater/aside";
const check = process.argv.includes("--check");
const url = (locale) => site + (locale.path ? locale.path + "/" : "");
const downloadUrl = `${repo}/releases/download/v${version}/aside-${version}.zip`;

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
  const fragments = {
    version: escape(version),
    darkReader:
      '<a href="https://github.com/darkreader/darkreader">Dark Reader</a>',
    tabsShortcut: "<kbd>Alt</kbd> + <kbd>W</kbd>",
    qaShortcut: "<kbd>Alt</kbd> + <kbd>Q</kbd>",
    ollamaLink:
      '<a href="https://docs.ollama.com/api/openai-compatibility">Ollama</a>',
    privacyLink: `<a href="${prefix}privacy.html">${escape(copy.privacyRead)}</a>`,
    extensions: "<code>chrome://extensions</code>",
    developerMode: `<strong>${escape(copy.developerMode)}</strong>`,
    loadUnpacked: `<strong>${escape(copy.loadUnpacked)}</strong>`,
  };
  const renderCopy = (key) =>
    escape(copy[key]).replace(/\{(\w+)\}/g, (_, name) => {
      if (!(name in fragments))
        throw Error(`${language.code}.${key}: unknown placeholder ${name}`);
      return fragments[name];
    });
  const values = {
    language: escape(language.code),
    root: prefix,
    styleVersion: assetVersions["home.css"],
    scriptVersion: assetVersions["home.js"],
    canonical: url(language),
    ogLocale: ogLocales[language.code],
    brandName: language.code.startsWith("zh") ? "旁白" : "Aside",
    brandSecondary: language.code.startsWith("zh") ? "Aside" : "旁白",
    releaseUrl: `${repo}/releases/tag/v${version}`,
    downloadUrl,
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
        softwareRequirements: `Google Chrome ${minimumChromeVersion}+`,
        softwareVersion: version,
        inLanguage: languages.map(({ code }) => code),
        isAccessibleForFree: true,
        license: `${repo}/blob/main/LICENSE`,
        downloadUrl,
        installUrl: `${url(language)}#install`,
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
