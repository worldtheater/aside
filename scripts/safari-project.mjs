import { cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
const plist = path.join(project, config.appName, "Info.plist");
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
  // All cryptography uses Safari Web Crypto / the OS, with no bundled crypto implementation.
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Add ITSAppUsesNonExemptEncryption bool false",
    info,
  ]);
}
const pbx = path.join(project, `${config.appName}.xcodeproj/project.pbxproj`);
let contents = await readFile(pbx, "utf8");
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
