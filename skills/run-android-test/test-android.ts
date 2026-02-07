#!/usr/bin/env tsx

import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync, unlinkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir, platform } from "os";

// Constants
const PORT = 5554;
const LOCK_TIMEOUT_MS = 30000;
const LOCK_POLL_INTERVAL_MS = 1000;
const EMULATOR_BOOT_TIMEOUT_MS = 120000;
const EMULATOR_POLL_INTERVAL_MS = 2000;
const EMULATOR_BOOT_WAIT_MS = 10000;
const DEBUG_APK_PATH_SUFFIX = "composeApp/build/outputs/apk/debug/composeApp-debug.apk";
const TEST_APK_PATH_SUFFIX = "composeApp/build/outputs/apk/androidTest/debug/composeApp-debug-androidTest.apk";

const execAsync = promisify(exec);

/** Gradle wrapper command: gradlew.bat on Windows, ./gradlew on Unix */
const GRADLEW = platform() === "win32" ? "gradlew.bat" : "./gradlew";

/**
 * Type guard to check if an error has stdout/stderr properties
 */
interface ExecError extends Error {
    stdout?: string;
    stderr?: string;
}

function isExecError(error: unknown): error is ExecError {
    return error instanceof Error && ('stdout' in error || 'stderr' in error);
}

/** Result of successful argument parsing */
export type ParseArgsSuccess = {
    ok: true;
    project_dir: string;
    package_name: string;
    test_suite_name: string;
    test_name: string;
};

/** Result of failed argument parsing; message is full text for stderr */
export type ParseArgsFailure = { ok: false; message: string };

export type ParseArgsResult = ParseArgsSuccess | ParseArgsFailure;

/**
 * Parse command line arguments. Returns a discriminated union; does not exit or log.
 */
export function parseArgs(argv?: string[]): ParseArgsResult {
    const args = argv ?? process.argv.slice(2);

    if (args.length !== 4) {
        return {
            ok: false,
            message:
                "Usage: npx tsx test-android.ts <project_dir> <package_name> <test_suite_name> <test_name>\n\nExample:\n  npx tsx test-android.ts /path/to/{PISTACHIO_PROJECT_NAME} {PISTACHIO_PACKAGE_NAME} SvgIconExampleTest testSvgIconExampleDisplaysAllElements",
        };
    }

    const [project_dir, package_name, test_suite_name, test_name] = args;

    if (!project_dir || project_dir.trim().length === 0) {
        return { ok: false, message: "Invalid arguments:\n  - project_dir: must be a non-empty string" };
    }
    if (!package_name || package_name.trim().length === 0) {
        return { ok: false, message: "Invalid arguments:\n  - package_name: must be a non-empty string" };
    }
    if (!test_suite_name || test_suite_name.trim().length === 0) {
        return { ok: false, message: "Invalid arguments:\n  - test_suite_name: must be a non-empty string" };
    }
    if (!test_name || test_name.trim().length === 0) {
        return { ok: false, message: "Invalid arguments:\n  - test_name: must be a non-empty string" };
    }

    return { ok: true, project_dir, package_name, test_suite_name, test_name };
}

/**
 * Acquire a device lock to prevent concurrent use. Returns a release callback.
 * Throws on timeout or non-EEXIST mkdir errors.
 */
export async function acquireDeviceLock(
    serial: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<{ release: () => void }> {
    const timeoutMs = options?.timeoutMs ?? LOCK_TIMEOUT_MS;
    const pollIntervalMs = options?.pollIntervalMs ?? LOCK_POLL_INTERVAL_MS;
    const lockDir = join(tmpdir(), `pistachio-device-lock-${serial}`);
    const lockPidFile = join(lockDir, "pid");
    let acquired = false;

    const release = (): void => {
        if (!acquired) return;
        try {
            if (existsSync(lockDir)) {
                rmSync(lockDir, { recursive: true, force: true });
                console.log("✓ Device lock released");
            }
        } catch {
            // Ignore cleanup errors
        } finally {
            acquired = false;
        }
    };

    console.log("Acquiring device lock...");
    const lockStartTime = Date.now();

    while (!acquired) {
        if (Date.now() - lockStartTime >= timeoutMs) {
            throw new Error(`Failed to acquire device lock within ${timeoutMs / 1000} seconds. Please try again later.`);
        }

        try {
            mkdirSync(lockDir);
            writeFileSync(lockPidFile, process.pid.toString());
            acquired = true;
            console.log("✓ Device lock acquired");
        } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "EEXIST") {
                try {
                    const lockedPid = parseInt(readFileSync(lockPidFile, "utf8"), 10);
                    if (!Number.isNaN(lockedPid)) {
                        // process.kill(pid, 0) checks if process exists without killing it
                        process.kill(lockedPid, 0);
                    }
                    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                } catch {
                    // PID invalid, missing, or process no longer exists — treat as stale lock
                    console.log("Removing stale device lock...");
                    try {
                        rmSync(lockDir, { recursive: true, force: true });
                    } catch {
                        // Ignore
                    }
                }
            } else {
                const errorMessage = err instanceof Error ? err.message : String(err);
                throw new Error(`Error acquiring device lock: ${errorMessage}`);
            }
        }
    }

    return { release };
}

/** Result returned by runAndroidTest when the test run has completed */
export type RunAndroidTestResult = {
    success: boolean;
    output: string;
    logcatErrors: string;
    frameCount: number;
    framesDir?: string;
};

/**
 * Check instrumentation output for test failure indicators.
 */
export function hasTestFailureIndicators(output: string): boolean {
    return (
        output.includes("FAILURES!!!") ||
        /Tests run:\s*\d+,\s*Failures:\s*[1-9]\d*/.test(output) ||
        /INSTRUMENTATION_(?:FAILED|STATUS_CODE:\s*-1)\b/.test(output) ||
        /INSTRUMENTATION_RESULT:.*(?:shortMsg|longMsg)=.*(?:fail|crash|exception)/i.test(output) ||
        output.includes("Test failed") ||
        /(java\.lang\.\w+(?:Exception|Error)|kotlin\.\w+Exception)/.test(output)
    );
}

/**
 * Extract logcat error content between ERROR_LOGS_START and ERROR_LOGS_END.
 */
export function extractLogcatErrors(output: string): string {
    const regex = /ERROR_LOGS_START\s*([\s\S]*?)\s*ERROR_LOGS_END/g;
    const matches = Array.from(output.matchAll(regex));
    return matches.map((match) => match[1]).join("\n").trim();
}

/**
 * Extract frames from a screen recording video. Caller is responsible for deleting the video file.
 */
export async function extractFramesFromVideo(
    localScreenRecordPath: string,
    framesDir: string
): Promise<{ frameCount: number }> {
    mkdirSync(framesDir, { recursive: true });

    let duration = 0;
    try {
        const { stdout: durationStr } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localScreenRecordPath}"`
        );
        duration = parseFloat(durationStr.trim());
    } catch {
        // ignore ffprobe errors
    }

    let frameCount = 0;

    if (duration > 0 && duration < 1) {
        await execAsync(
            `ffmpeg -i "${localScreenRecordPath}" -vf "scale=320:-1" -vsync vfr -q:v 6 "${join(framesDir, "frame_%05d.jpg")}"`
        );
        const frameFiles = readdirSync(framesDir)
            .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
            .sort();
        for (let i = 0; i < frameFiles.length - 1; i++) {
            unlinkSync(join(framesDir, frameFiles[i]));
        }
        frameCount = frameFiles.length > 0 ? 1 : 0;
    } else {
        await execAsync(
            `ffmpeg -i "${localScreenRecordPath}" -vf "fps=1,scale=320:-1" -q:v 6 "${join(framesDir, "frame_%04d.jpg")}"`
        );
        const frameFiles = readdirSync(framesDir)
            .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
            .sort();
        frameCount = frameFiles.length;
    }

    if (frameCount === 0) {
        await execAsync(
            `ffmpeg -i "${localScreenRecordPath}" -vf "scale=320:-1" -vsync vfr -q:v 6 "${join(framesDir, "frame_%05d.jpg")}"`
        );
        const frameFiles = readdirSync(framesDir)
            .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
            .sort();
        for (let i = 0; i < frameFiles.length - 1; i++) {
            unlinkSync(join(framesDir, frameFiles[i]));
        }
        frameCount = frameFiles.length > 0 ? 1 : 0;
    }

    return { frameCount };
}

/**
 * Run the Android test (build, emulator, install, instrument, screen record, cleanup).
 * Throws on fatal errors; returns a result when the test run has completed (pass or fail).
 */
export async function runAndroidTest(
    project_dir: string,
    package_name: string,
    test_suite_name: string,
    test_name: string
): Promise<RunAndroidTestResult> {
    const serial = `emulator-${PORT}`;

    if (!existsSync(project_dir)) {
        throw new Error(`Project directory not found: ${project_dir}`);
    }

    // Step 1: Build debug APK
    console.log("Step 1: Building debug APK...");
    try {
        await execAsync(`${GRADLEW} assembleDebug`, { cwd: project_dir });
        console.log("✓ Debug APK built successfully");
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to assemble debug APK: ${errorMessage}`);
    }

    // Step 2: Build test APK
    console.log("Step 2: Building test APK...");
    try {
        await execAsync(`${GRADLEW} assembleDebugAndroidTest`, { cwd: project_dir });
        console.log("✓ Test APK built successfully");
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to assemble debug Android test APK: ${errorMessage}`);
    }

    // Step 3: Check if an emulator is already running
    let hasRunningEmulator = false;
    console.log("Step 3: Checking for running emulator...");
    try {
        const { stdout } = await execAsync("adb devices");
        const lines = stdout.split("\n").filter((line) => line.trim());
        for (const line of lines) {
            if (line.includes(serial) && line.includes("\tdevice")) {
                hasRunningEmulator = true;
                break;
            }
        }
    } catch {
        throw new Error(
            "adb command not found. Please ensure Android SDK platform-tools are installed and available in PATH."
        );
    }

    // Step 4: Start emulator if one is not running
    if (!hasRunningEmulator) {
        console.log("Step 4: Starting emulator...");
        try {
            const { stdout: avdList } = await execAsync("emulator -list-avds");
            const avds = avdList
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            if (avds.length === 0) {
                throw new Error(
                    "No Android Virtual Devices (AVDs) found. Please create an AVD using Android Studio."
                );
            }

            const avdName = avds[0];
            console.log(`Using AVD: ${avdName}`);

            exec(`emulator -avd ${avdName} -port ${PORT} -no-snapshot-load -no-audio`, (error) => {
                if (error) {
                    console.error(`Error starting emulator on port ${PORT}: ${error.message}`);
                }
            });

            let deviceAvailable = false;
            const startTime = Date.now();
            console.log("Waiting for emulator to boot...");
            while (!deviceAvailable && Date.now() - startTime < EMULATOR_BOOT_TIMEOUT_MS) {
                await new Promise((resolve) => setTimeout(resolve, EMULATOR_POLL_INTERVAL_MS));
                try {
                    const { stdout } = await execAsync("adb devices");
                    const lines = stdout.split("\n").filter((line) => line.trim());
                    for (const line of lines) {
                        if (line.includes(serial) && line.includes("\tdevice")) {
                            deviceAvailable = true;
                            break;
                        }
                    }
                } catch {
                    // Continue polling
                }
            }

            if (!deviceAvailable) {
                throw new Error(
                    `Emulator failed to start within ${EMULATOR_BOOT_TIMEOUT_MS / 1000} seconds. Please check emulator logs.`
                );
            }
            // Wait for Android to finish booting
            await new Promise((resolve) => setTimeout(resolve, EMULATOR_BOOT_WAIT_MS));
            console.log("✓ Emulator started successfully");
        } catch (error) {
            if (error instanceof Error) throw error;
            throw new Error(`Failed to start emulator: ${String(error)}`);
        }
    } else {
        console.log("✓ Emulator already running");
    }

    // Step 5: Install debug APK
    console.log("Step 5: Installing debug APK...");
    const debugApkPath = join(project_dir, DEBUG_APK_PATH_SUFFIX);
    try {
        await execAsync(`adb -s ${serial} install -r "${debugApkPath}"`);
        console.log("✓ Debug APK installed successfully");
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to install debug APK: ${errorMessage}`);
    }

    // Step 6: Install test APK
    console.log("Step 6: Installing test APK...");
    const testApkPath = join(project_dir, TEST_APK_PATH_SUFFIX);
    try {
        await execAsync(`adb -s ${serial} install -r "${testApkPath}"`);
        console.log("✓ Test APK installed successfully");
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to install test APK: ${errorMessage}`);
    }

    // Step 7: Run instrument
    console.log(`Step 7: Running test: ${test_name}...`);
    let output = "";
    try {
        const { stdout, stderr } = await execAsync(
            `adb -s ${serial} shell am instrument -w -r -e class "${package_name}.${test_suite_name}#${test_name}" ${package_name}.test/androidx.test.runner.AndroidJUnitRunner`
        );
        output = stdout + (stderr ? `\n${stderr}` : "");
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isExecError(error)) {
            output = (error.stdout || "") + (error.stderr ? `\n${error.stderr}` : "");
        } else {
            output = errorMessage;
        }
    }

    const logcatErrors = extractLogcatErrors(output);

    // Step 8: Screen recording and frames
    const screenRecordPath = `/storage/emulated/0/Android/data/${package_name}/files/screenrecord_${test_name}.mp4`;
    const localScreenRecordPath = join(project_dir, `screenrecord_${test_name}.mp4`);
    let frameCount = 0;
    let framesDir: string | undefined;
    try {
        await execAsync(`adb -s ${serial} pull "${screenRecordPath}" "${localScreenRecordPath}"`);
        console.log("✓ Screen recording retrieved");
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Could not pull screen recording: ${errorMessage}`);
    }

    if (existsSync(localScreenRecordPath)) {
        try {
            console.log("Extracting frames from video...");
            framesDir = join(project_dir, `frames_${test_name}`);
            const result = await extractFramesFromVideo(localScreenRecordPath, framesDir);
            frameCount = result.frameCount;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Could not extract frames from video: ${errorMessage}`);
        }
        try {
            unlinkSync(localScreenRecordPath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to delete screen recording file: ${errorMessage}`);
        }
    }

    const success = !hasTestFailureIndicators(output);

    // Step 9: Clean up
    console.log("Step 9: Cleaning up...");
    try {
        await execAsync(`adb -s ${serial} uninstall ${package_name}.test`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Could not uninstall test APK: ${errorMessage}`);
    }
    try {
        await execAsync(`adb -s ${serial} uninstall ${package_name}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Could not uninstall main app: ${errorMessage}`);
    }

    return { success, output, logcatErrors, frameCount, framesDir };
}

/**
 * Main function to run the Android test (CLI entrypoint)
 */
async function main() {
    const parsed = parseArgs();
    if (!parsed.ok) {
        console.error(parsed.message);
        process.exit(1);
    }

    const { project_dir, package_name, test_suite_name, test_name } = parsed;
    const serial = `emulator-${PORT}`;

    console.log(`Running Android test: ${test_name}`);
    console.log(`Project Directory: ${project_dir}`);
    console.log(`Package: ${package_name}`);
    console.log(`Device: ${serial}`);
    console.log("");

    if (!existsSync(project_dir)) {
        console.error(`Error: Project directory not found: ${project_dir}`);
        process.exit(1);
    }

    let release: () => void;
    try {
        const lock = await acquireDeviceLock(serial);
        release = lock.release;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(message);
        process.exit(1);
    }

    process.on("exit", release);
    process.on("SIGINT", () => {
        release();
        process.exit(130);
    });
    process.on("SIGTERM", () => {
        release();
        process.exit(143);
    });

    let result: RunAndroidTestResult;
    try {
        result = await runAndroidTest(project_dir, package_name, test_suite_name, test_name);
    } catch (e) {
        console.error("Fatal error:", e);
        process.exit(1);
    } finally {
        release();
    }

    console.log("");
    console.log("TEST RESULTS");
    console.log(`Status: ${result.success ? "✓ PASSED" : "✗ FAILED"}`);
    if (result.frameCount > 0) {
        console.log(
            `Frames Extracted: ${result.frameCount}${result.framesDir ? ` (from ${result.framesDir})` : ""}`
        );
    }
    console.log("");
    if (!result.success) {
        console.log("Output:");
        console.log("-".repeat(60));
        if (result.logcatErrors && result.logcatErrors.length > 0) {
            console.log(result.logcatErrors);
        } else {
            console.log(result.output);
        }
        console.log("-".repeat(60));
    }

    process.exit(result.success ? 0 : 1);
}

// CLI entrypoint — only run when executed directly (not when imported for tests)
if (process.argv[1]?.endsWith("test-android.ts")) {
    void main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
