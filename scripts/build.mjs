import { build } from "esbuild";
import ts from "typescript";
import { readdir, rm, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
execFileSync(
  process.execPath,
  [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit"],
  { cwd: root, stdio: "inherit" },
);
// Preserve the unpacked extension's path (and therefore its ID and local settings).
// All root-level .js files are generated; source and tooling live in src/ and scripts/.
for (const name of await readdir(root)) {
  if (name.endsWith(".js")) await rm(path.join(root, name));
}
const modules = (await readdir(path.join(root, "src"))).filter(
  (name) =>
    name.endsWith(".ts") &&
    !name.endsWith(".d.ts") &&
    !["content.ts", "extract.ts", "theme-bootstrap.ts", "lights.ts"].includes(
      name,
    ),
);
await build({
  entryPoints: modules.map((name) => path.join(root, "src", name)),
  outdir: root,
  format: "esm",
  bundle: true,
  splitting: true,
  target: "chrome120",
  loader: { ".svg": "text" },
});
// The website API shim must not wrap this extension's Promise-based chrome API.
// Keep its compatibility runtime private, and execute its CSSOM proxy as a local
// MAIN-world script so strict page CSP does not block an inline script element.
const darkReaderPath = path.join(
  root,
  "node_modules/darkreader/darkreader.mjs",
);
const darkReaderSource = await readFile(darkReaderPath, "utf8");
const parsedDarkReader = ts.createSourceFile(
  darkReaderPath,
  darkReaderSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const proxy = parsedDarkReader.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "injectProxy",
);
if (!proxy)
  throw new Error(
    "Dark Reader API proxy was not found; review the pinned dependency before updating.",
  );
await writeFile(
  path.join(root, "lights-proxy.js"),
  `${proxy.getText(parsedDarkReader)}
if (document.documentElement.dataset.darkreaderMode === "dynamic") {
  document.dispatchEvent(new CustomEvent("__darkreader__cleanUp"));
  injectProxy(true, true);
}
`,
);
const inlineProxy =
  /const proxyScript = createOrUpdateScript\("darkreader--proxy"\);[\s\S]*?proxyScript\.remove\(\);/g;
if ([...darkReaderSource.matchAll(inlineProxy)].length !== 1)
  throw new Error("Dark Reader proxy integration needs review.");
// SVG presentation attributes are absent from element.style. Register their
// variable uses in the engine's existing matching queue before it emits typed
// dark variables; otherwise first render falls back until the element mutates.
let patchedDarkReader = darkReaderSource.replace(/\r\n/g, "\n");
for (const [before, after] of [
  // The API shim logs every failed fetch as a runtime error even though the
  // engine already skips unavailable resources. Preserve that rejection and
  // its diagnostics, while keeping expected bridge failures out of Chrome's
  // extension error list (which also collects console.warn).
  [
    `        } catch (error) {
            console.error(error);
            messageListeners.forEach((cb) =>`,
    `        } catch (error) {
            if (error?.code === "networkError" || error?.code === "invalidInput") {
                console.info(error.message);
            } else {
                console.error(error);
            }
            messageListeners.forEach((cb) =>`,
  ],
  [
    "this.inlineStyleQueue.push(style);",
    "this.inlineStyleQueue.push(() => this.collectVarsFromCSSDeclarations(style));",
  ],
  [
    "    matchVariablesAndDependents() {",
    `    addVarDependantForMatching(property, value) {
        this.inlineStyleQueue.push(() => this.inspectVarDependant(property, value));
    }
    matchVariablesAndDependents() {`,
  ],
  [
    `this.inlineStyleQueue.forEach((style) => {
            this.collectVarsFromCSSDeclarations(style);
        });`,
    "this.inlineStyleQueue.forEach((collect) => collect());",
  ],
  [
    "    function setCustomProp(targetCSSProp, modifierCSSProp, cssVal) {",
    `    function setCustomProp(targetCSSProp, modifierCSSProp, cssVal) {
        if (!isVariable(modifierCSSProp) && isVarDependant(cssVal)) {
            variablesStore.addVarDependantForMatching(modifierCSSProp, cssVal);
        }`,
  ],
]) {
  // The dependency is pinned; never silently apply a partial compatibility fix.
  if (patchedDarkReader.split(before).length !== 2)
    throw new Error("Dark Reader compatibility integration needs review.");
  patchedDarkReader = patchedDarkReader.replace(before, after);
}
const darkReaderPlugin = {
  name: "extension-darkreader",
  setup(build) {
    build.onLoad({ filter: /[\/]darkreader[\/]darkreader\.mjs$/ }, () => ({
      contents:
        `const chrome = { runtime: {} };\n` +
        patchedDarkReader.replace(
          inlineProxy,
          `void globalThis.chrome.runtime.sendMessage({ type: "lights.proxy" }).catch(console.warn);`,
        ),
      loader: "js",
      resolveDir: path.dirname(darkReaderPath),
    }));
  },
};

// Chrome content scripts are classic scripts; bundle imports into each isolated entry.
await build({
  entryPoints: ["content", "extract", "theme-bootstrap", "lights"].map((name) =>
    path.join(root, "src", `${name}.ts`),
  ),
  outdir: root,
  bundle: true,
  format: "iife",
  plugins: [darkReaderPlugin],
  target: "chrome120",
  loader: { ".svg": "text" },
});
console.log(`Built Aside extension in ${root}`);
