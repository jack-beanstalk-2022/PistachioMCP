import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, unlinkSync, mkdirSync, readdirSync, rmSync } from "fs";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";
import { withDeviceLock } from "../utils/DeviceLockUtils.js";
import { logger } from "../utils/Logger.js";

const AVD_NAME = "Medium_Phone_API_36.1";

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
 * Tool for running Android tests on a remote server
 */
// TODO: this needs to run in a container so that user cannot inject malicious code into gradle scripts or APK
export const remoteTestAndroidTool = {
    name: "remote_test_android",
    description: "Run an test in composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/AndroidInstrumentedTest.kt",
    inputSchema: z.object({
        project_id: z
            .string()
            .describe("The ID of the project"),
        package_name: z
            .string()
            .describe("The package name of the Android app (e.g., 'com.jetbrains.kmpapp')"),
        test_name: z
            .string()
            .describe("The test name inside AndroidInstrumentedTest.kt (e.g., 'testScrollingDownGesture')"),
    }),
    handler: async (args: { project_id: string; test_name: string; package_name: string }) => {
        const { project_id, test_name, package_name } = args;
        const serial = `emulator-${PORT}`;

        const projectsPath = join(homedir(), "PistachioMCPProjects");
        const projectPath = join(projectsPath, project_id);

        // Check if project directory exists
        if (!existsSync(projectPath)) {
            return {
                output: `Error: Project directory not found for project_id: ${project_id}. Please verify the project exists.`,
                screenrecord: undefined,
                images: undefined,
                success: false,
            };
        }

        // Step 1: Build debug APK (doesn't require device lock)
        try {
            await execAsync(`./gradlew --no-daemon assembleDebug`, {
                cwd: projectPath,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                output: `Error: Failed to assemble debug APK: ${errorMessage}`,
                screenrecord: undefined,
                images: undefined,
                success: false,
            };
        }

        // Step 2: Build test APK (doesn't require device lock)
        try {
            await execAsync(`./gradlew --no-daemon assembleDebugAndroidTest`, {
                cwd: projectPath,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                output: `Error: Failed to assemble debug Android test APK: ${errorMessage}`,
                screenrecord: undefined,
                images: undefined,
                success: false,
            };
        }

        // Now acquire device lock for device-dependent operations
        return await withDeviceLock(serial, async () => {
            // Step 3: Check if the specific emulator is already running
            let hasRunningEmulator = false;
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
                return {
                    output: `Error: adb command not found. Please ensure Android SDK platform-tools are installed and available in PATH.`,
                    screenrecord: undefined,
                    images: undefined,
                    success: false,
                };
            }

            // Step 4: Start emulator if the specific one is not running
            if (!hasRunningEmulator) {
                try {
                    // List available AVDs
                    const { stdout: avdList } = await execAsync("emulator -list-avds");
                    const avds = avdList
                        .split("\n")
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0);

                    if (avds.length === 0) {
                        return {
                            output: `Error: No Android Virtual Devices (AVDs) found. Please create an AVD using Android Studio.`,
                            screenrecord: undefined,
                            images: undefined,
                            success: false,
                        };
                    }

                    // Check if the specified AVD exists
                    if (!avds.includes(AVD_NAME)) {
                        return {
                            output: `Error: AVD "${AVD_NAME}" not found. Available AVDs: ${avds.join(", ")}`,
                            screenrecord: undefined,
                            images: undefined,
                            success: false,
                        };
                    }

                    // Start the specified AVD in the background with the unique port and unique AVD home
                    exec(`emulator -avd ${AVD_NAME} -port ${PORT} -no-snapshot-load -no-audio`, (error) => {
                        if (error) {
                            console.error(`Error starting emulator on port ${PORT}: ${error.message}`);
                        }
                    });

                    // Wait for emulator to boot (poll adb devices for specific serial)
                    let deviceReady = false;
                    const maxWaitTime = 120000; // 2 minutes
                    const pollInterval = 2000; // 2 seconds
                    const startTime = Date.now();

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
                        return {
                            output: `Error: Emulator failed to start within ${maxWaitTime / 1000} seconds. Please check emulator logs.`,
                            screenrecord: undefined,
                            images: undefined,
                            success: false,
                        };
                    }
                } catch (error) {
                    return {
                        output: `Error: Failed to start emulator: ${error instanceof Error ? error.message : String(error)}`,
                        screenrecord: undefined,
                        images: undefined,
                        success: false,
                    };
                }
            }

            // Step 5: Install debug APK to specific serial
            const debugApkPath = join(projectPath, "composeApp/build/outputs/apk/debug/composeApp-debug.apk");
            try {
                await execAsync(`adb -s ${serial} install -r "${debugApkPath}"`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    output: `Error: Failed to install debug APK: ${errorMessage}`,
                    screenrecord: undefined,
                    images: undefined,
                    success: false,
                };
            }

            // Step 6: Install test APK
            const testApkPath = join(projectPath, "composeApp/build/outputs/apk/androidTest/debug/composeApp-debug-androidTest.apk");
            try {
                await execAsync(`adb -s ${serial} install -r "${testApkPath}"`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    output: `Error: Failed to install test APK: ${errorMessage}`,
                    screenrecord: undefined,
                    images: undefined,
                    success: false,
                };
            }

            // Step 7: Run adb shell am instrument with test_name
            let output = "";
            try {
                const { stdout, stderr } = await execAsync(
                    `adb -s ${serial} shell am instrument -w -r -e class "${package_name}.AndroidInstrumentedTest#${test_name}" ${package_name}.test/androidx.test.runner.AndroidJUnitRunner`
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
            const logcatErrors = logcatErrorsMatches.map(match => match[1]).join('\n').trim();

            // Step 9: Run adb pull to get the screen recording
            const screenRecordPath = `/storage/emulated/0/Android/data/${package_name}/files/screenrecord_${test_name}.mp4`;
            const localScreenRecordPath = join(projectsPath, `screenrecord_${project_id}_${test_name}.mp4`);
            let screenRecordGcsUrl: string | null = null;
            const imageSequence: string[] = [];
            try {
                await execAsync(`adb -s ${serial} pull "${screenRecordPath}" "${localScreenRecordPath}"`);
            } catch (error) {
                // Screen recording might not exist, so we don't fail the whole test
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn({
                    project_id,
                    serial,
                    screen_record_path: screenRecordPath,
                    error_message: errorMessage,
                }, "Could not pull screen recording");
            }
            // Upload video to GCS if file was successfully pulled
            if (existsSync(localScreenRecordPath)) {
                try {
                    // Read the video file
                    const fileBuffer = readFileSync(localScreenRecordPath);

                    // Upload to GCS
                    const storage = new Storage();
                    const bucketName =
                        process.env.GCS_BUCKET_WEEKLY_EXPIRING ||
                        "dev-pistachio-assets-weekly-expiring";

                    // Strip gs:// prefix if present
                    let finalBucketName = bucketName;
                    if (finalBucketName.startsWith("gs://")) {
                        finalBucketName = finalBucketName.substring(5);
                    }
                    const bucket = storage.bucket(finalBucketName);

                    // Generate filename
                    const filename = `${randomUUID()}.mp4`;
                    const file = bucket.file(`${project_id}/${filename}`);

                    // Upload the buffer to GCS
                    await file.save(fileBuffer, {
                        metadata: {
                            contentType: "video/mp4",
                        },
                    });

                    // Get the public URL
                    screenRecordGcsUrl = `https://storage.googleapis.com/${finalBucketName}/${project_id}/${filename}`;
                } catch (error) {
                    // Log but don't fail if upload fails
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.warn({
                        project_id,
                        error_message: errorMessage,
                    }, "Could not upload screen recording to GCS");
                }

                // Extract frames at 1fps and convert to base64
                try {
                    const framesDir = join(projectsPath, `frames_${randomUUID()}`);
                    mkdirSync(framesDir, { recursive: true });

                    // Extract frames using ffmpeg
                    await execAsync(
                        `ffmpeg -i "${localScreenRecordPath}" -vf "fps=1,scale=320:-1" -q:v 6 "${join(framesDir, "frame_%04d.jpg")}"`
                    );

                    // Read all frame files and convert to base64
                    const frameFiles = readdirSync(framesDir)
                        .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
                        .sort();

                    for (const frameFile of frameFiles) {
                        const framePath = join(framesDir, frameFile);
                        const frameBuffer = readFileSync(framePath);
                        const base64 = frameBuffer.toString("base64");
                        imageSequence.push(base64);
                    }

                    // Clean up temporary directory
                    try {
                        rmSync(framesDir, { recursive: true, force: true });
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.warn({
                            project_id,
                            frames_dir: framesDir,
                            error_message: errorMessage,
                        }, "Could not delete frames directory");
                    }
                } catch (error) {
                    // Log but don't fail if frame extraction fails
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.warn({
                        project_id,
                        error_message: errorMessage,
                    }, "Could not extract frames from video");
                }

                // Delete the local file after successful upload
                try {
                    unlinkSync(localScreenRecordPath);
                } catch (error) {
                    // Log but don't fail if deletion fails
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.warn({
                        project_id,
                        local_screen_record_path: localScreenRecordPath,
                        error_message: errorMessage,
                    }, "Failed to delete screen recording file");
                }
            }


            // Determine success based on whether the test passed.
            //
            // NOTE: `adb shell am instrument` output is not perfectly standardized across runners / versions.
            // In particular, `INSTRUMENTATION_CODE` values can be confusing and should not be the sole signal.
            // Prefer explicit JUnit summary markers and obvious instrumentation failure markers.
            const hasFailureIndicators =
                // JUnit-style summary (common with AndroidJUnitRunner)
                output.includes("FAILURES!!!") ||
                /Tests run:\s*\d+,\s*Failures:\s*[1-9]\d*/.test(output) ||
                // Instrumentation-level failures / crashes
                /INSTRUMENTATION_(?:FAILED|STATUS_CODE:\s*-1)\b/.test(output) ||
                /INSTRUMENTATION_RESULT:.*(?:shortMsg|longMsg)=.*(?:fail|crash|exception)/i.test(output) ||
                // Generic failure strings (app/framework dependent)
                output.includes("Test failed") ||
                /(java\.lang\.\w+(?:Exception|Error)|kotlin\.\w+Exception)/.test(output);

            // Step 10: Clean up - uninstall test and binary
            try {
                // Uninstall test APK
                await execAsync(`adb -s ${serial} uninstall ${package_name}.test`);
            } catch (error) {
                // Log but don't fail if uninstall fails
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn({
                    project_id,
                    serial,
                    package_name: `${package_name}.test`,
                    error_message: errorMessage,
                }, "Could not uninstall test APK");
            }

            try {
                // Uninstall main app
                await execAsync(`adb -s ${serial} uninstall ${package_name}`);
            } catch (error) {
                // Log but don't fail if uninstall fails
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn({
                    project_id,
                    serial,
                    package_name,
                    error_message: errorMessage,
                }, "Could not uninstall main app");
            }

            // Return structured result with extracted data
            return {
                output: logcatErrors.length > 0 ? logcatErrors : output.trim(),
                success: !hasFailureIndicators,
                screenrecord: screenRecordGcsUrl || undefined,
                images: imageSequence.length > 0 ? imageSequence : undefined,
            };
        });
    },
};
