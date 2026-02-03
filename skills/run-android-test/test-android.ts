#!/usr/bin/env tsx

import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync, unlinkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const PORT = 5554;
const execAsync = promisify(exec);

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

/**
 * Parse command line arguments
 */
function parseArgs(): { project_dir: string; package_name: string; test_name: string; test_suite_name: string } {
    const args = process.argv.slice(2);

    if (args.length !== 4) {
        console.error("Usage: tsx test-android.ts <project_dir> <package_name> <test_suite_name> <test_name>");
        console.error("");
        console.error("Example:");
        console.error("  tsx test-android.ts /path/to/project com.jetbrains.kmpapp ListScreenExampleTest testListScreenDisplaysContentAndScrolling");
        process.exit(1);
    }

    const [project_dir, package_name, test_suite_name, test_name] = args;

    // Validate arguments
    if (!project_dir || project_dir.trim().length === 0) {
        console.error("Invalid arguments:");
        console.error("  - project_dir: must be a non-empty string");
        process.exit(1);
    }
    if (!package_name || package_name.trim().length === 0) {
        console.error("Invalid arguments:");
        console.error("  - package_name: must be a non-empty string");
        process.exit(1);
    }
    if (!test_suite_name || test_suite_name.trim().length === 0) {
        console.error("Invalid arguments:");
        console.error("  - test_suite_name: must be a non-empty string");
        process.exit(1);
    }
    if (!test_name || test_name.trim().length === 0) {
        console.error("Invalid arguments:");
        console.error("  - test_name: must be a non-empty string");
        process.exit(1);
    }

    return { project_dir, package_name, test_suite_name, test_name };
}

/**
 * Main function to run the Android test
 */
async function main() {
    const { project_dir, package_name, test_suite_name, test_name } = parseArgs();
    const serial = `emulator-${PORT}`;

    console.log(`Running Android test: ${test_name}`);
    console.log(`Project Directory: ${project_dir}`);
    console.log(`Package: ${package_name}`);
    console.log(`Device: ${serial}`);
    console.log("");

    // Check if project directory exists
    if (!existsSync(project_dir)) {
        console.error(`Error: Project directory not found: ${project_dir}`);
        process.exit(1);
    }

    // Acquire global lock for build and device operations to prevent race conditions
    const lockDir = join(tmpdir(), `pistachio-device-lock-${serial}`);
    const lockPidFile = join(lockDir, "pid");
    let lockAcquired = false;

    const releaseLock = (): void => {
        if (!lockAcquired) return;
        try {
            if (existsSync(lockDir)) {
                rmSync(lockDir, { recursive: true, force: true });
                console.log("✓ Device lock released");
            }
        } catch {
            // Ignore cleanup errors
        } finally {
            lockAcquired = false;
        }
    };

    process.on("exit", releaseLock);
    process.on("SIGINT", () => {
        releaseLock();
        process.exit(130);
    });
    process.on("SIGTERM", () => {
        releaseLock();
        process.exit(143);
    });

    // Declare variables that need to be accessible after the try block
    let output = "";
    let logcatErrors = "";
    let hasFailureIndicators = false;
    let frameCount: number = 0;
    let framesDir: string | undefined;

    console.log("Acquiring device lock...");
    const lockTimeout = 30000; // 30 seconds
    const lockPollInterval = 1000; // 1 second
    const lockStartTime = Date.now();

    while (!lockAcquired) {
        // Check if timeout has been exceeded
        if (Date.now() - lockStartTime >= lockTimeout) {
            console.error(`Error: Failed to acquire device lock within ${lockTimeout / 1000} seconds. Please try again later.`);
            process.exit(1);
        }

        try {
            // mkdir is atomic across processes - only one process can create the directory
            mkdirSync(lockDir);
            writeFileSync(lockPidFile, process.pid.toString());
            lockAcquired = true;
            console.log("✓ Device lock acquired");
        } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "EEXIST") {
                // Lock already exists: check if owner process is still alive (stale lock detection)
                try {
                    const lockedPid = parseInt(readFileSync(lockPidFile, "utf8"), 10);
                    if (!Number.isNaN(lockedPid)) {
                        // process.kill(pid, 0) checks if process exists without killing it
                        process.kill(lockedPid, 0);
                    }
                    // Owner is still alive, wait and retry
                    await new Promise((resolve) => setTimeout(resolve, lockPollInterval));
                } catch {
                    // PID invalid, missing, or process no longer exists — treat as stale lock
                    console.log("Removing stale device lock...");
                    try {
                        rmSync(lockDir, { recursive: true, force: true });
                    } catch {
                        // Ignore; next iteration may succeed or we may timeout
                    }
                }
            } else {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error(`Error acquiring device lock: ${errorMessage}`);
                process.exit(1);
            }
        }
    }

    try {
        // Step 1: Build debug APK
        console.log("Step 1: Building debug APK...");
        try {
            await execAsync(`./gradlew assembleDebug`, {
                cwd: project_dir,
            });
            console.log("✓ Debug APK built successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error: Failed to assemble debug APK: ${errorMessage}`);
            process.exit(1);
        }

        // Step 2: Build test APK
        console.log("Step 2: Building test APK...");
        try {
            await execAsync(`./gradlew assembleDebugAndroidTest`, {
                cwd: project_dir,
            });
            console.log("✓ Test APK built successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error: Failed to assemble debug Android test APK: ${errorMessage}`);
            process.exit(1);
        }
        // Step 3: Check if the specific emulator is already running
        let hasRunningEmulator = false;
        console.log("Step 3: Checking for running emulator...");
        try {
            const { stdout } = await execAsync("adb devices");
            // Parse output to check for "device" status for the specific serial
            const lines = stdout.split("\n").filter((line) => line.trim());
            for (const line of lines) {
                if (line.includes(serial) && line.includes("\tdevice")) {
                    hasRunningEmulator = true;
                    break;
                }
            }
        } catch {
            console.error(`Error: adb command not found. Please ensure Android SDK platform-tools are installed and available in PATH.`);
            process.exit(1);
        }

        // Step 4: Start emulator if the specific one is not running
        if (!hasRunningEmulator) {
            console.log("Step 4: Starting emulator...");
            try {
                // List available AVDs
                const { stdout: avdList } = await execAsync("emulator -list-avds");
                const avds = avdList
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);

                if (avds.length === 0) {
                    console.error(`Error: No Android Virtual Devices (AVDs) found. Please create an AVD using Android Studio.`);
                    process.exit(1);
                }

                // Use the first available AVD
                const avdName = avds[0];
                console.log(`Using AVD: ${avdName}`);

                // Start the first AVD in the background with the unique port and unique AVD home
                exec(`emulator -avd ${avdName} -port ${PORT} -no-snapshot-load -no-audio`, (error) => {
                    if (error) {
                        console.error(`Error starting emulator on port ${PORT}: ${error.message}`);
                    }
                });

                // Wait for emulator to boot (poll adb devices for specific serial)
                let deviceReady = false;
                const maxWaitTime = 120000; // 2 minutes
                const pollInterval = 2000; // 2 seconds
                const startTime = Date.now();

                console.log("Waiting for emulator to boot...");
                while (!deviceReady && Date.now() - startTime < maxWaitTime) {
                    await new Promise((resolve) => setTimeout(resolve, pollInterval));
                    try {
                        const { stdout } = await execAsync("adb devices");
                        const lines = stdout.split("\n").filter((line) => line.trim());
                        for (const line of lines) {
                            if (line.includes(serial) && line.includes("\tdevice")) {
                                deviceReady = true;
                                break;
                            }
                        }
                    } catch {
                        // Continue polling
                    }
                }

                if (!deviceReady) {
                    console.error(`Error: Emulator failed to start within ${maxWaitTime / 1000} seconds. Please check emulator logs.`);
                    process.exit(1);
                }
                console.log("✓ Emulator started successfully");
            } catch (error) {
                console.error(`Error: Failed to start emulator: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        } else {
            console.log("✓ Emulator already running");
        }

        // Step 5: Install debug APK to specific serial
        console.log("Step 5: Installing debug APK...");
        const debugApkPath = join(project_dir, "composeApp/build/outputs/apk/debug/composeApp-debug.apk");
        try {
            await execAsync(`adb -s ${serial} install -r "${debugApkPath}"`);
            console.log("✓ Debug APK installed successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error: Failed to install debug APK: ${errorMessage}`);
            process.exit(1);
        }

        // Step 6: Install test APK
        console.log("Step 6: Installing test APK...");
        const testApkPath = join(project_dir, "composeApp/build/outputs/apk/androidTest/debug/composeApp-debug-androidTest.apk");
        try {
            await execAsync(`adb -s ${serial} install -r "${testApkPath}"`);
            console.log("✓ Test APK installed successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error: Failed to install test APK: ${errorMessage}`);
            process.exit(1);
        }

        // Step 7: Run adb shell am instrument with test_name
        console.log(`Step 7: Running test: ${test_name}...`);
        output = "";
        try {
            const { stdout, stderr } = await execAsync(
                `adb -s ${serial} shell am instrument -w -r -e class "${package_name}.${test_suite_name}#${test_name}" ${package_name}.test/androidx.test.runner.AndroidJUnitRunner`
            );

            // Combine stdout and stderr for complete output
            output = stdout + (stderr ? `\n${stderr}` : "");
        } catch (error) {
            // Even if the command fails, we still want to capture the output
            // Test failures still produce output with error logs
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Try to extract stdout/stderr from the error if available
            if (isExecError(error)) {
                output = (error.stdout || "") + (error.stderr ? `\n${error.stderr}` : "");
            } else {
                output = errorMessage;
            }
        }

        // Step 8: Parse logcatErrors from the output
        const logcatErrorsRegex = /ERROR_LOGS_START\s*([\s\S]*?)\s*ERROR_LOGS_END/g;
        const logcatErrorsMatches = Array.from(output.matchAll(logcatErrorsRegex));
        logcatErrors = logcatErrorsMatches.map(match => match[1]).join('\n').trim();

        // Step 8: Run adb pull to get the screen recording
        console.log("Step 8: Retrieving screen recording...");
        const screenRecordPath = `/storage/emulated/0/Android/data/${package_name}/files/screenrecord_${test_name}.mp4`;
        const localScreenRecordPath = join(project_dir, `screenrecord_${test_name}.mp4`);
        frameCount = 0;
        framesDir = undefined;
        try {
            await execAsync(`adb -s ${serial} pull "${screenRecordPath}" "${localScreenRecordPath}"`);
            console.log("✓ Screen recording retrieved");
        } catch (error) {
            // Screen recording might not exist, so we don't fail the whole test
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Could not pull screen recording: ${errorMessage}`);
        }
        // Extract frames at 1fps to count them if file was successfully pulled
        if (existsSync(localScreenRecordPath)) {
            // Extract frames at 1fps to count them
            try {
                console.log("Extracting frames from video...");
                framesDir = join(project_dir, `frames_${test_name}`);
                mkdirSync(framesDir, { recursive: true });

                // Get video duration to handle short videos
                let duration = 0;
                try {
                    const { stdout: durationStr } = await execAsync(
                        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localScreenRecordPath}"`
                    );
                    duration = parseFloat(durationStr.trim());
                } catch {
                    // ffprobe might not be available
                }

                if (duration > 0 && duration < 1) {
                    // Extract all frames
                    await execAsync(
                        `ffmpeg -i "${localScreenRecordPath}" -vf "scale=320:-1" -vsync vfr -q:v 6 "${join(framesDir, "frame_%05d.jpg")}"`
                    );
                    const frameFiles = readdirSync(framesDir)
                        .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
                        .sort();
                    // Keep only the last frame
                    for (let i = 0; i < frameFiles.length - 1; i++) {
                        unlinkSync(join(framesDir, frameFiles[i]));
                    }
                    frameCount = frameFiles.length > 0 ? 1 : 0;
                } else {
                    // Extract frames using ffmpeg at 1fps
                    await execAsync(
                        `ffmpeg -i "${localScreenRecordPath}" -vf "fps=1,scale=320:-1" -q:v 6 "${join(framesDir, "frame_%04d.jpg")}"`
                    );
                    const frameFiles = readdirSync(framesDir)
                        .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
                        .sort();
                    frameCount = frameFiles.length
                }


                // If no frames were extracted (e.g., video was short but ffprobe failed or returned 0)
                if (frameCount === 0) {
                    // Extract all frames
                    await execAsync(
                        `ffmpeg -i "${localScreenRecordPath}" -vf "scale=320:-1" -vsync vfr -q:v 6 "${join(framesDir, "frame_%05d.jpg")}"`
                    );
                    const frameFiles = readdirSync(framesDir)
                        .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
                        .sort();
                    // Keep only the last frame
                    for (let i = 0; i < frameFiles.length - 1; i++) {
                        unlinkSync(join(framesDir, frameFiles[i]));
                    }
                    frameCount = frameFiles.length > 0 ? 1 : 0;
                }
            } catch (error) {
                // Log but don't fail if frame extraction fails
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.warn(`Could not extract frames from video: ${errorMessage}`);
            }

            // Delete the local file after processing
            try {
                unlinkSync(localScreenRecordPath);
            } catch (error) {
                // Log but don't fail if deletion fails
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.warn(`Failed to delete screen recording file: ${errorMessage}`);
            }
        }

        // Determine success based on whether the test passed.
        //
        // NOTE: `adb shell am instrument` output is not perfectly standardized across runners / versions.
        // In particular, `INSTRUMENTATION_CODE` values can be confusing and should not be the sole signal.
        // Prefer explicit JUnit summary markers and obvious instrumentation failure markers.
        hasFailureIndicators =
            // JUnit-style summary (common with AndroidJUnitRunner)
            output.includes("FAILURES!!!") ||
            /Tests run:\s*\d+,\s*Failures:\s*[1-9]\d*/.test(output) ||
            // Instrumentation-level failures / crashes
            /INSTRUMENTATION_(?:FAILED|STATUS_CODE:\s*-1)\b/.test(output) ||
            /INSTRUMENTATION_RESULT:.*(?:shortMsg|longMsg)=.*(?:fail|crash|exception)/i.test(output) ||
            // Generic failure strings (app/framework dependent)
            output.includes("Test failed") ||
            /(java\.lang\.\w+(?:Exception|Error)|kotlin\.\w+Exception)/.test(output);

        // Step 9: Clean up - uninstall test and binary
        console.log("Step 9: Cleaning up...");
        try {
            // Uninstall test APK
            await execAsync(`adb -s ${serial} uninstall ${package_name}.test`);
        } catch (error) {
            // Log but don't fail if uninstall fails
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Could not uninstall test APK: ${errorMessage}`);
        }

        try {
            // Uninstall main app
            await execAsync(`adb -s ${serial} uninstall ${package_name}`);
        } catch (error) {
            // Log but don't fail if uninstall fails
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Could not uninstall main app: ${errorMessage}`);
        }
    } finally {
        releaseLock();
    }

    // Print results
    console.log("");
    console.log("TEST RESULTS");
    console.log(`Status: ${!hasFailureIndicators ? "✓ PASSED" : "✗ FAILED"}`);
    if (frameCount > 0) {
        console.log(`Frames Extracted: ${frameCount}${framesDir ? ` (from ${framesDir})` : ""}`);
    }
    console.log("");
    if (hasFailureIndicators) {
        console.log("Output:");
        console.log("-".repeat(60));
        if (logcatErrors && logcatErrors.length > 0) {
            console.log(logcatErrors);
        } else {
            console.log(output);
        }
        console.log("-".repeat(60));
    }

    // Exit with appropriate code
    process.exit(hasFailureIndicators ? 1 : 0);
}

// Run the script
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
