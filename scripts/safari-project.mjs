import { cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

if (process.platform !== "darwin")
  throw new Error("Safari packaging requires macOS and Xcode.");
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  await readFile(path.join(root, "safari/config.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(path.join(root, "dist/safari/manifest.json"), "utf8"),
);
const teamId = process.env.SAFARI_TEAM_ID;
const buildNumber = process.env.SAFARI_BUILD_NUMBER ?? "1";
if (teamId && !/^[A-Z0-9]{10}$/.test(teamId))
  throw new Error(
    "SAFARI_TEAM_ID must be a 10-character Apple team identifier.",
  );
if (!/^[1-9][0-9]{0,8}$/.test(buildNumber))
  throw new Error(
    "SAFARI_BUILD_NUMBER must be a positive integer (up to 9 digits).",
  );
const output = path.join(root, "artifacts/safari/project");
// This directory is disposable. Keep native customizations in safari/host.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
execFileSync(
  "xcrun",
  [
    "safari-web-extension-converter",
    "--project-location",
    output,
    "--app-name",
    config.appName,
    "--bundle-identifier",
    config.bundleIdentifier,
    "--macos-only",
    "--swift",
    "--copy-resources",
    "--no-open",
    "--no-prompt",
    path.join(root, "dist/safari"),
  ],
  { stdio: "inherit" },
);
const project = path.join(output, config.appName);
await cp(path.join(root, "safari/host"), path.join(project, config.appName), {
  recursive: true,
});
await cp(
  path.join(root, "safari/SafariWebExtensionHandler.swift"),
  path.join(
    project,
    `${config.appName} Extension/SafariWebExtensionHandler.swift`,
  ),
);
for (const target of [config.appName, `${config.appName} Extension`]) {
  await cp(
    path.join(root, "safari/Localizable.xcstrings"),
    path.join(project, target, "Localizable.xcstrings"),
  );
  await cp(
    path.join(root, "safari/TranslationLanguages.swift"),
    path.join(project, target, "TranslationLanguages.swift"),
  );
}
const plist = path.join(project, config.appName, "Info.plist");
for (const [key, type, value] of [
  ["CFBundleURLTypes", "array", ""],
  ["CFBundleURLTypes:0", "dict", ""],
  ["CFBundleURLTypes:0:CFBundleURLName", "string", config.bundleIdentifier],
  ["CFBundleURLTypes:0:CFBundleURLSchemes", "array", ""],
  [
    "CFBundleURLTypes:0:CFBundleURLSchemes:0",
    "string",
    config.bundleIdentifier,
  ],
])
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Add ${key} ${type} ${value}`,
    plist,
  ]);
execFileSync("/usr/libexec/PlistBuddy", [
  "-c",
  `Add AsideExtensionIdentifier string ${config.extensionBundleIdentifier}`,
  plist,
]);
execFileSync("/usr/libexec/PlistBuddy", [
  "-c",
  `Add LSApplicationCategoryType string ${config.applicationCategory}`,
  plist,
]);
for (const info of [
  plist,
  path.join(project, `${config.appName} Extension/Info.plist`),
]) {
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Add AsideURLScheme string ${config.bundleIdentifier}`,
    info,
  ]);
  // All cryptography uses Safari Web Crypto / the OS, with no bundled crypto implementation.
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Add ITSAppUsesNonExemptEncryption bool false",
    info,
  ]);
}
const pbx = path.join(project, `${config.appName}.xcodeproj/project.pbxproj`);
let contents = await readFile(pbx, "utf8");
// The converter emits explicit PBX groups, not synchronized folders. Register
// our additional source/catalog files in the same groups and build phases.
function addFile(name, groupAnchor, phaseAnchor, fileType, identity) {
  const id = (suffix) =>
    createHash("sha1")
      .update(identity + suffix)
      .digest("hex")
      .slice(0, 24)
      .toUpperCase();
  const fileId = id("file"),
    buildId = id("build");
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileAnchor = contents.match(
    new RegExp(
      `([A-F0-9]{24}) /\\* ${escaped(groupAnchor)} \\*/ = \\{isa = PBXFileReference;`,
    ),
  )?.[1];
  const buildAnchor = contents.match(
    new RegExp(
      `([A-F0-9]{24}) /\\* ${escaped(phaseAnchor)} \\*/ = \\{isa = PBXBuildFile;`,
    ),
  )?.[1];
  if (!fileAnchor || !buildAnchor)
    throw new Error(`Safari converter project layout changed: ${name}`);
  const phase = phaseAnchor.endsWith("Sources") ? "Sources" : "Resources";
  contents = contents.replace(
    "/* End PBXFileReference section */",
    `\t\t${fileId} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = ${fileType}; path = ${name}; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
  );
  contents = contents.replace(
    "/* End PBXBuildFile section */",
    `\t\t${buildId} /* ${name} in ${phase} */ = {isa = PBXBuildFile; fileRef = ${fileId}; };\n/* End PBXBuildFile section */`,
  );
  contents = contents.replace(
    `${fileAnchor} /* ${groupAnchor} */,`,
    `${fileAnchor} /* ${groupAnchor} */,\n\t\t\t\t${fileId} /* ${name} */,`,
  );
  contents = contents.replace(
    `${buildAnchor} /* ${phaseAnchor} */,`,
    `${buildAnchor} /* ${phaseAnchor} */,\n\t\t\t\t${buildId} /* ${name} in ${phase} */,`,
  );
}
addFile(
  "TranslationPreparation.swift",
  "ViewController.swift",
  "ViewController.swift in Sources",
  "sourcecode.swift",
  "host-preparation",
);
addFile(
  "TranslationLanguages.swift",
  "ViewController.swift",
  "ViewController.swift in Sources",
  "sourcecode.swift",
  "host-languages",
);
addFile(
  "TranslationLanguages.swift",
  "SafariWebExtensionHandler.swift",
  "SafariWebExtensionHandler.swift in Sources",
  "sourcecode.swift",
  "extension-languages",
);
addFile(
  "Localizable.xcstrings",
  "ViewController.swift",
  "Script.js in Resources",
  "text.json.xcstrings",
  "host-copy",
);
addFile(
  "Localizable.xcstrings",
  "SafariWebExtensionHandler.swift",
  "manifest.json in Resources",
  "text.json.xcstrings",
  "extension-copy",
);
// The packager can capitalize the app identifier. Keep identities and version
// stable across rebuilds so a debug update retains Safari's local settings.
contents = contents.replace(
  /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
  (line) =>
    `PRODUCT_BUNDLE_IDENTIFIER = ${line.includes(".Extension;") ? config.extensionBundleIdentifier : config.bundleIdentifier};`,
);
contents = contents.replace(
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${manifest.version};`,
);
contents = contents.replace(
  /MACOSX_DEPLOYMENT_TARGET = [^;]+;/g,
  `MACOSX_DEPLOYMENT_TARGET = ${config.minimumMacOSVersion};`,
);
contents = contents.replace(
  /CURRENT_PROJECT_VERSION = [^;]+;/g,
  `CURRENT_PROJECT_VERSION = ${buildNumber};`,
);
contents = contents.replace(
  /INFOPLIST_KEY_NSHumanReadableCopyright = [^;]+;/g,
  `INFOPLIST_KEY_NSHumanReadableCopyright = ${JSON.stringify(config.copyright)};`,
);
if (teamId) {
  contents = contents.replaceAll(
    "CODE_SIGN_STYLE = Automatic;",
    `CODE_SIGN_STYLE = Automatic;\n\t\t\t\tDEVELOPMENT_TEAM = ${teamId};`,
  );
}
await writeFile(pbx, contents);
console.log(path.join(project, `${config.appName}.xcodeproj`));
