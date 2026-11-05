import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.platform !== "darwin")
  throw new Error("Safari distribution requires macOS and Xcode.");
const command = process.argv[2];
if (!["archive", "export"].includes(command) || process.argv.length !== 3)
  throw new Error("Usage: node scripts/safari-release.mjs archive|export");
const teamId = process.env.SAFARI_TEAM_ID;
const buildNumber = process.env.SAFARI_BUILD_NUMBER;
if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId))
  throw new Error(
    "Set SAFARI_TEAM_ID to your 10-character Apple team identifier.",
  );
if (!buildNumber || !/^[1-9][0-9]{0,8}$/.test(buildNumber))
  throw new Error(
    "Set SAFARI_BUILD_NUMBER to a positive integer (up to 9 digits). Increment it for each upload.",
  );
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  await readFile(path.join(root, "safari/config.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
);
const output = path.join(
  root,
  "artifacts/safari/release",
  `${manifest.version}-${buildNumber}`,
);
const archive = path.join(output, `${config.appName}.xcarchive`);
const app = path.join(
  archive,
  "Products/Applications",
  `${config.appName}.app`,
);
const extension = path.join(
  app,
  "Contents/PlugIns",
  `${config.appName} Extension.appex`,
);
const options = path.join(output, "ExportOptions.plist");
const run = (tool, args) =>
  execFileSync(tool, args, { cwd: root, stdio: "inherit" });
const plistValue = (file, key) =>
  execFileSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", file], {
    encoding: "utf8",
  }).trim();

function verifyArchive() {
  for (const [bundle, id] of [
    [app, config.bundleIdentifier],
    [extension, config.extensionBundleIdentifier],
  ]) {
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
    const signature = spawnSync("/usr/bin/codesign", ["-dv", bundle], {
      encoding: "utf8",
    });
    if (
      signature.status !== 0 ||
      !signature.stderr.includes(`TeamIdentifier=${teamId}\n`)
    )
      throw new Error(`Unexpected signing team: ${bundle}`);
    const info = path.join(bundle, "Contents/Info.plist");
    if (
      plistValue(info, "CFBundleIdentifier") !== id ||
      plistValue(info, "CFBundleShortVersionString") !== manifest.version ||
      plistValue(info, "CFBundleVersion") !== buildNumber
    )
      throw new Error(
        `Archive identity/version does not match this release: ${bundle}`,
      );
    const binary = path.join(
      bundle,
      "Contents/MacOS",
      plistValue(info, "CFBundleExecutable"),
    );
    const architectures = execFileSync("/usr/bin/lipo", ["-archs", binary], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/);
    if (!["arm64", "x86_64"].every((arch) => architectures.includes(arch)))
      throw new Error(
        `Archive must support Apple silicon and Intel: ${bundle}`,
      );
  }
}

if (command === "archive") {
  if (existsSync(archive))
    throw new Error(
      `Archive already exists: ${archive}. Use a new build number to keep this build.`,
    );
  await mkdir(output, { recursive: true });
  run("npm", ["run", "build:safari"]);
  run(process.execPath, [path.join(root, "scripts/safari-project.mjs")]);
  run("xcodebuild", [
    "-project",
    path.join(
      root,
      "artifacts/safari/project",
      config.appName,
      `${config.appName}.xcodeproj`,
    ),
    "-scheme",
    config.appName,
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=macOS",
    "-archivePath",
    archive,
    "-derivedDataPath",
    path.join(root, "artifacts/safari/ReleaseDerivedData"),
    "-allowProvisioningUpdates",
    "-quiet",
    "archive",
    `DEVELOPMENT_TEAM=${teamId}`,
    "CODE_SIGN_STYLE=Automatic",
    "ONLY_ACTIVE_ARCH=NO",
  ]);
  verifyArchive();
  await writeFile(
    options,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>teamID</key><string>${teamId}</string>
<key>signingStyle</key><string>automatic</string>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>uploadSymbols</key><true/>
</dict></plist>
`,
  );
  console.log(`Verified Safari archive: ${archive}`);
} else {
  verifyArchive();
  if (
    plistValue(options, "destination") !== "export" ||
    plistValue(options, "method") !== "app-store-connect" ||
    plistValue(options, "teamID") !== teamId
  )
    throw new Error(
      "Export options must use local App Store Connect export and the archive's team.",
    );
  run("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archive,
    "-exportPath",
    path.join(output, "export"),
    "-exportOptionsPlist",
    options,
    "-allowProvisioningUpdates",
  ]);
  console.log(`Safari App Store package: ${path.join(output, "export")}`);
}
