import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.platform !== "darwin")
  throw new Error("Safari builds require macOS and Xcode.");
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  await readFile(path.join(root, "safari/config.json"), "utf8"),
);
const output = path.join(root, "artifacts/safari");
await mkdir(output, { recursive: true });
execFileSync(
  "xcodebuild",
  [
    "-project",
    path.join(output, "project", config.appName, `${config.appName}.xcodeproj`),
    "-scheme",
    config.appName,
    "-configuration",
    "Debug",
    "-destination",
    "platform=macOS",
    "-derivedDataPath",
    path.join(output, "DerivedData"),
    "-quiet",
    "build",
    "CODE_SIGN_IDENTITY=-",
    "CODE_SIGN_STYLE=Manual",
    "DEVELOPMENT_TEAM=",
    `CONFIGURATION_BUILD_DIR=${path.join(output, "Debug")}`,
  ],
  { cwd: root, stdio: "inherit" },
);
const app = path.join(output, "Debug", `${config.appName}.app`);
execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
  stdio: "inherit",
});
console.log(`Safari debug app: ${app}`);
