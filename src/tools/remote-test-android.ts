import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, unlinkSync, mkdirSync, readdirSync, rmSync } from "fs";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

const AVD_NAME = "Pixel_7_API_31";

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
export const remoteTestAndroidTool = {
    name: "remote_test_android",
    description: "Run an test in composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/",
    inputSchema: z.object({
        project_id: z
            .string()
            .describe("The ID of the project"),
        package_name: z
            .string()
            .describe("The package name of the Android app (e.g., 'com.jetbrains.kmpapp')"),
        test_name: z
            .string()
            .describe("The name of the test (e.g., 'ScrollingInstrumentedTest')"),
    }),
    handler: async (args: { project_id: string; test_name: string; package_name: string }) => {
        const { project_id, test_name, package_name } = args;

        try {
            const documentsPath = join(homedir(), "Documents");
            const projectPath = join(documentsPath, project_id);

            // Check if project directory exists
            if (!existsSync(projectPath)) {
                return {
                    output: `Error: Project directory not found for project_id: ${project_id}. Please verify the project exists.`,
                    success: false,
                };
            }

            // Step 1: Check for running emulators
            let hasRunningEmulator = false;
            try {
                const { stdout } = await execAsync("adb devices");
                // Parse output to check for "device" status (not "offline" or empty)
                const lines = stdout.split("\n").filter((line) => line.trim());
                for (const line of lines) {
                    if (line.includes("\tdevice")) {
                        hasRunningEmulator = true;
                        break;
                    }
                }
            } catch {
                return {
                    output: `Error: adb command not found. Please ensure Android SDK platform-tools are installed and available in PATH.`,
                    success: false,
                };
            }

            // Step 2: Start emulator if none is running
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
                            success: false,
                        };
                    }

                    // Check if the specified AVD exists
                    if (!avds.includes(AVD_NAME)) {
                        return {
                            output: `Error: AVD "${AVD_NAME}" not found. Available AVDs: ${avds.join(", ")}`,
                            success: false,
                        };
                    }

                    // Start the specified AVD in the background
                    exec(`emulator -avd ${AVD_NAME}`, (error) => {
                        if (error) {
                            console.error(`Error starting emulator: ${error.message}`);
                        }
                    });

                    // Wait for emulator to boot (poll adb devices)
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
                                if (line.includes("\tdevice")) {
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
                            success: false,
                        };
                    }
                } catch (error) {
                    return {
                        output: `Error: Failed to start emulator: ${error instanceof Error ? error.message : String(error)}`,
                        success: false,
                    };
                }
            }

            // Step 3: Run ./gradlew installDebug
            try {
                await execAsync(`./gradlew installDebug`, {
                    cwd: projectPath,
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    output: `Error: Failed to install debug APK: ${errorMessage}`,
                    success: false,
                };
            }

            // Step 4: Run ./gradlew assembleDebugAndroidTest
            try {
                await execAsync(`./gradlew assembleDebugAndroidTest`, {
                    cwd: projectPath,
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    output: `Error: Failed to assemble debug Android test APK: ${errorMessage}`,
                    success: false,
                };
            }

            // Step 5: Run adb install -r composeApp/build/outputs/apk/androidTest/debug/composeApp-debug-androidTest.apk
            const testApkPath = join(projectPath, "composeApp/build/outputs/apk/androidTest/debug/composeApp-debug-androidTest.apk");
            try {
                await execAsync(`adb install -r "${testApkPath}"`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    output: `Error: Failed to install test APK: ${errorMessage}`,
                    success: false,
                };
            }

            // Step 6: Run adb shell am instrument with test_name
            let output = "";
            try {
                const { stdout, stderr } = await execAsync(
                    `adb shell am instrument -w -r -e class "${package_name}.${test_name}" ${package_name}.test/androidx.test.runner.AndroidJUnitRunner`
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

            // Step 7: Parse logcatErrors from the output
            const logcatErrorsRegex = /ERROR_LOGS_START\s*([\s\S]*?)\s*ERROR_LOGS_END/g;
            const logcatErrorsMatches = Array.from(output.matchAll(logcatErrorsRegex));
            const logcatErrors = logcatErrorsMatches.map(match => match[1]).join('\n').trim();

            // Step 8: Run adb pull to get the screen recording
            const screenRecordPath = `/storage/emulated/0/Android/data/${package_name}/files/screenrecord_${test_name}.mp4`;
            const localScreenRecordPath = join(documentsPath, `screenrecord_${test_name}.mp4`);
            let screenRecordGcsUrl: string | null = null;
            const imageSequence: string[] = [];
            try {
                await execAsync(`adb pull "${screenRecordPath}" "${localScreenRecordPath}"`);

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
                        console.warn(`Warning: Could not upload screen recording to GCS: ${error instanceof Error ? error.message : String(error)}`);
                    }

                    // Extract frames at 1fps and convert to base64
                    try {
                        const framesDir = join(documentsPath, `frames_${randomUUID()}`);
                        mkdirSync(framesDir, { recursive: true });

                        // Extract frames using ffmpeg
                        await execAsync(
                            `ffmpeg -i "${localScreenRecordPath}" -vf fps=1 -q:v 4 "${join(framesDir, "frame_%04d.jpg")}"`
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
                            console.warn(`Warning: Could not delete frames directory: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    } catch (error) {
                        // Log but don't fail if frame extraction fails
                        console.warn(`Warning: Could not extract frames from video: ${error instanceof Error ? error.message : String(error)}`);
                    }

                    // Delete the local file after successful upload
                    try {
                        unlinkSync(localScreenRecordPath);
                    } catch (error) {
                        // Log but don't fail if deletion fails
                        console.warn(`Failed to delete screen recording file: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            } catch (error) {
                // Screen recording might not exist, so we don't fail the whole test
                console.warn(`Warning: Could not pull screen recording: ${error instanceof Error ? error.message : String(error)}`);
            }


            // Determine success based on whether the test passed
            // Check for test failure indicators in adb shell am instrument output
            const hasFailureIndicators =
                output.includes("FAILURES!!!") ||
                output.includes("INSTRUMENTATION_STATUS_CODE: -1") ||
                output.includes("INSTRUMENTATION_FAILED") ||
                output.includes("Test failed") ||
                /Tests run: \d+,.*Failures: [1-9]/.test(output);

            // Step 9: Clean up - uninstall test and binary
            try {
                // Uninstall test APK
                await execAsync(`adb uninstall ${package_name}.test`);
            } catch (error) {
                // Log but don't fail if uninstall fails
                console.warn(`Warning: Could not uninstall test APK: ${error instanceof Error ? error.message : String(error)}`);
            }

            try {
                // Uninstall main app
                await execAsync(`adb uninstall ${package_name}`);
            } catch (error) {
                // Log but don't fail if uninstall fails
                console.warn(`Warning: Could not uninstall main app: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Return structured result with extracted data
            return {
                output: logcatErrors.length > 0 ? logcatErrors : output.trim(),
                success: !hasFailureIndicators,
                screenrecord: screenRecordGcsUrl || undefined,
                images: imageSequence.length > 0 ? imageSequence : undefined,
            };
        } catch (error) {
            return {
                output: `Error: ${error instanceof Error ? error.message : String(error)}`,
                success: false,
            };
        }
    },
};
