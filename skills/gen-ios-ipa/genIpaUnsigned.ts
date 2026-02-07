#!/usr/bin/env tsx

/**
 * Usage: npx tsx genIpaUnsigned.ts [project_dir] [app_name] [export_path]
 * Pass path to Pistachio project. app_name must match iosApp/Configuration/Config.xcconfig. IPA is written to export_path (default: project_dir).
 */

import { execSync, type ExecSyncOptions } from "child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync, unlinkSync } from "fs";
import { join } from "path";
import { platform } from "os";

const PROJECT_DIR = process.argv[2] ?? ".";
const APP_NAME = process.argv[3] ?? "KMP App";
const EXPORT_PATH = process.argv[4] ?? PROJECT_DIR;
const WORK_DIR = join(PROJECT_DIR, "iosApp");
const ARCHIVE_PATH = join(WORK_DIR, "iosApp.xcarchive");
const PAYLOAD_DIR = join(EXPORT_PATH, "Payload");
const APP_SOURCE = join(ARCHIVE_PATH, "Products", "Applications", `${APP_NAME}.app`);
const APP_DEST = join(PAYLOAD_DIR, `${APP_NAME}.app`);

function run(cmd: string, cwd?: string): void {
  const opts: ExecSyncOptions = {
    cwd: cwd ?? process.cwd(),
    stdio: "inherit",
    shell: platform() === "win32" ? "cmd.exe" : "/bin/sh",
  };
  execSync(cmd, opts);
}

// 1. Clean
run(
  "xcodebuild clean -project iosApp.xcodeproj -scheme iosApp -configuration Release",
  WORK_DIR
);

// 2. Archive (unsigned)
run(
  [
    "xcodebuild archive",
    "-project iosApp.xcodeproj",
    "-scheme iosApp",
    "-configuration Release",
    "-sdk iphoneos",
    `-archivePath "${ARCHIVE_PATH}"`,
    'CODE_SIGN_IDENTITY=""',
    "CODE_SIGNING_REQUIRED=NO",
    "CODE_SIGNING_ALLOWED=NO",
  ].join(" "),
  WORK_DIR
);

// 3. Assemble unsigned IPA
mkdirSync(PAYLOAD_DIR, { recursive: true });
if (existsSync(PAYLOAD_DIR)) {
  for (const name of readdirSync(PAYLOAD_DIR)) {
    rmSync(join(PAYLOAD_DIR, name), { recursive: true });
  }
}
cpSync(APP_SOURCE, APP_DEST, { recursive: true });

const codeSignaturePath = join(APP_DEST, "_CodeSignature");
if (existsSync(codeSignaturePath)) {
  rmSync(codeSignaturePath, { recursive: true });
}

const embeddedPath = join(APP_DEST, "embedded.mobileprovision");
if (existsSync(embeddedPath)) {
  unlinkSync(embeddedPath);
}

run(`zip -q -r -y "${APP_NAME}.ipa" Payload`, EXPORT_PATH);

const ipaPath = join(EXPORT_PATH, `${APP_NAME}.ipa`);
console.log(`Created ${ipaPath}`);
console.log(
  "This is unsigned IPA. To install on iOS device, use Sideloadly or other sideloading tool."
);
