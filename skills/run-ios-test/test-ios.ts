#!/usr/bin/env tsx

import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Constants
const SCHEME = "iosApp";
const MIN_SIMULATOR_OS = "15.3";
const LOCK_TIMEOUT_MS = 30000;
const LOCK_POLL_INTERVAL_MS = 1000;
const SIMULATOR_BOOT_TIMEOUT_MS = 120000;
const SIMULATOR_POLL_INTERVAL_MS = 2000;

const execAsync = promisify(exec);

/**
 * Returns true if version string a is >= b (e.g. "26.1" >= "26.1", "27.0" >= "26.1").
 */
function isOsVersionAtLeast(version: string, min: string): boolean {
    const aParts = version.split(".").map(Number);
    const bParts = min.split(".").map(Number);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
        const a = aParts[i] ?? 0;
        const b = bParts[i] ?? 0;
        if (a > b) return true;
        if (a < b) return false;
    }
    return true;
}

/**
 * Result of finding the first available iPhone simulator
 */
export interface FirstIphoneSimulator {
    name: string;
    os: string;
    udid: string;
}

/**
 * Parses xcrun simctl list devices output and returns the first available iPhone simulator.
 */
export function getFirstIphoneSimulator(stdout: string): FirstIphoneSimulator | null {
    const lines = stdout.split("\n");
    let currentOs: string | null = null;
    for (const line of lines) {
        const osMatch = line.match(/^--\s+iOS\s+([\d.]+)\s+--/);
        if (osMatch) {
            currentOs = osMatch[1];
            continue;
        }
        const deviceMatch = line.match(/\s+(iPhone[^(]+?)\s+\(([A-F0-9-]+)\)/);
        if (deviceMatch && currentOs && isOsVersionAtLeast(currentOs, MIN_SIMULATOR_OS)) {
            return {
                name: deviceMatch[1].trim(),
                os: currentOs,
                udid: deviceMatch[2],
            };
        }
    }
    return null;
}

/**
 * Type guard to check if an error has stdout/stderr properties
 */
interface ExecError extends Error {
    stdout?: string;
    stderr?: string;
}

function isExecError(error: unknown): error is ExecError {
    return error instanceof Error && ("stdout" in error || "stderr" in error);
}

/**
 * Checks if simulator is booted
 */
export function isSimulatorBooted(stdout: string, udid: string): boolean {
    return stdout.includes(udid) && stdout.includes("(Booted)");
}

/** Result of successful argument parsing */
export type ParseArgsSuccess = {
    ok: true;
    project_dir: string;
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

    if (args.length !== 2) {
        return {
            ok: false,
            message:
                "Usage: npx tsx test-ios.ts <project_dir> <test_name>\n\nExample:\n  npx tsx test-ios.ts /path/to/iosApp testScrollingDownGesture",
        };
    }

    const [project_dir, test_name] = args;

    if (!project_dir || project_dir.trim().length === 0) {
        return { ok: false, message: "Invalid arguments:\n  - project_dir: must be a non-empty string (path to iosApp directory)" };
    }
    if (!test_name || test_name.trim().length === 0) {
        return { ok: false, message: "Invalid arguments:\n  - test_name: must be a non-empty string" };
    }

    return { ok: true, project_dir, test_name };
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
                        process.kill(lockedPid, 0);
                    }
                    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                } catch {
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

/** Result returned by runIosTest when the test run has completed */
export type RunIosTestResult = {
    success: boolean;
    output: string;
    frameCount: number;
    framesDir?: string;
};

/**
 * Check xcodebuild/test output for test failure indicators.
 */
export function hasTestFailureIndicators(output: string): boolean {
    return (
        output.includes("Test Suite 'All tests' failed") ||
        output.includes("Test Failed") ||
        /Test Suite '[^']+' failed/.test(output) ||
        /\bTest\s+.*\s+failed\b/i.test(output) ||
        output.includes("BUILD FAILED") ||
        output.includes("xcodebuild: error:")
    );
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
 * Run the iOS test (simulator check/boot, xcodebuild test, extract attachments/frames, cleanup).
 * Throws on fatal errors; returns a result when the test run has completed (pass or fail).
 */
export async function runIosTest(
    project_dir: string,
    test_name: string,
    simulator: FirstIphoneSimulator
): Promise<RunIosTestResult> {
    const { udid, name, os } = simulator;
    const destination = `platform=iOS Simulator,name=${name},OS=${os}`;
    const test_path = `iosAppUITests/iosAppUITests/${test_name}`;

    if (!existsSync(project_dir)) {
        throw new Error(`Project directory not found: ${project_dir}`);
    }

    const testResultUuid = randomUUID();
    const resultBundleName = `${testResultUuid}.xcresult`;
    const resultBundlePath = join(project_dir, resultBundleName);
    const attachmentsOutputDir = join(project_dir, `results_${testResultUuid}`);

    // Step 1: Check simulator and boot if needed
    console.log("Step 1: Checking simulator...");
    let isBooted = false;
    try {
        const { stdout } = await execAsync("xcrun simctl list devices");
        isBooted = isSimulatorBooted(stdout, udid);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to check simulator status: ${errorMessage}`);
    }

    if (!isBooted) {
        console.log("Booting simulator...");
        try {
            await execAsync(`xcrun simctl boot ${udid}`);

            let deviceReady = false;
            const startTime = Date.now();
            while (!deviceReady && Date.now() - startTime < SIMULATOR_BOOT_TIMEOUT_MS) {
                await new Promise((resolve) => setTimeout(resolve, SIMULATOR_POLL_INTERVAL_MS));
                try {
                    const { stdout } = await execAsync("xcrun simctl list devices");
                    if (isSimulatorBooted(stdout, udid)) {
                        deviceReady = true;
                        break;
                    }
                } catch {
                    // Continue polling
                }
            }

            if (!deviceReady) {
                throw new Error(
                    `Simulator failed to boot within ${SIMULATOR_BOOT_TIMEOUT_MS / 1000} seconds. Please check simulator logs.`
                );
            }
            console.log("✓ Simulator booted");
        } catch (error) {
            if (error instanceof Error) throw error;
            throw new Error(`Failed to boot simulator: ${String(error)}`);
        }
    } else {
        console.log("✓ Simulator already running");
    }

    // Step 2: Run xcodebuild test
    console.log(`Step 2: Running test: ${test_name}...`);
    let output = "";
    try {
        const { stdout, stderr } = await execAsync(
            `xcodebuild test -scheme ${SCHEME} -destination '${destination}' -resultBundlePath "${resultBundlePath}" -only-testing:${test_path}`,
            { cwd: project_dir }
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

    const success = !hasTestFailureIndicators(output);

    // Step 3: Extract attachments with xcparse and frames from largest video
    let frameCount = 0;
    let framesDir: string | undefined;

    if (existsSync(resultBundlePath)) {
        try {
            mkdirSync(attachmentsOutputDir, { recursive: true });
            await execAsync(`xcparse attachments "${resultBundlePath}" "${attachmentsOutputDir}"`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Could not extract attachments with xcparse: ${errorMessage}`);
        }

        if (existsSync(attachmentsOutputDir)) {
            try {
                const attachmentFiles = readdirSync(attachmentsOutputDir, { recursive: true });
                const attachmentFileStrings = attachmentFiles
                    .map((file) => (typeof file === "string" ? file : String(file)))
                    .filter((file): file is string => typeof file === "string");

                const videoFiles = attachmentFileStrings.filter(
                    (file) => file.endsWith(".mp4") || file.endsWith(".mov") || file.endsWith(".m4v")
                );

                let largestVideoPath: string | null = null;
                let largestVideoSize = 0;
                for (const videoFile of videoFiles) {
                    const videoPath = join(attachmentsOutputDir, videoFile);
                    if (existsSync(videoPath)) {
                        try {
                            const stats = statSync(videoPath);
                            if (stats.size > largestVideoSize) {
                                largestVideoSize = stats.size;
                                largestVideoPath = videoPath;
                            }
                        } catch {
                            // Skip
                        }
                    }
                }

                if (largestVideoPath) {
                    framesDir = join(project_dir, `frames_${test_name}`);
                    try {
                        console.log("Extracting frames from video...");
                        const result = await extractFramesFromVideo(largestVideoPath, framesDir);
                        frameCount = result.frameCount;
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        console.warn(`Could not extract frames from video: ${msg}`);
                    }
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`Could not process attachments: ${msg}`);
            }

            try {
                rmSync(attachmentsOutputDir, { recursive: true, force: true });
            } catch {
                // Ignore
            }
        }

        try {
            rmSync(resultBundlePath, { recursive: true, force: true });
        } catch {
            console.warn("Could not delete result bundle");
        }
    } else {
        console.warn(`No result bundle found in ${resultBundlePath}`);
    }

    return { success, output, frameCount, framesDir };
}

/**
 * Main function to run the iOS test (CLI entrypoint)
 */
async function main() {
    const parsed = parseArgs();
    if (!parsed.ok) {
        console.error(parsed.message);
        process.exit(1);
    }

    const { project_dir, test_name } = parsed;

    let simulator: FirstIphoneSimulator;
    try {
        const { stdout } = await execAsync("xcrun simctl list devices available");
        const sim = getFirstIphoneSimulator(stdout);
        if (!sim) {
            console.error(`Error: No available iPhone simulator found (OS >= ${MIN_SIMULATOR_OS}).`);
            process.exit(1);
        }
        simulator = sim;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error: Failed to list simulators: ${errorMessage}`);
        process.exit(1);
    }

    const destination = `platform=iOS Simulator,name=${simulator.name},OS=${simulator.os}`;

    console.log(`Running iOS test: ${test_name}`);
    console.log(`Project Directory: ${project_dir}`);
    console.log(`Destination: ${destination}`);
    console.log("");

    if (!existsSync(project_dir)) {
        console.error(`Error: Project directory not found: ${project_dir}`);
        process.exit(1);
    }

    let release: () => void;
    try {
        const lock = await acquireDeviceLock(simulator.udid);
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

    let result: RunIosTestResult;
    try {
        result = await runIosTest(project_dir, test_name, simulator);
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
        console.log(result.output);
        console.log("-".repeat(60));
    }

    process.exit(result.success ? 0 : 1);
}

// CLI entrypoint — only run when executed directly (not when imported for tests)
if (process.argv[1]?.endsWith("test-ios.ts")) {
    void main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
