import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";
import { withDeviceLock } from "../utils/DeviceLockUtils.js";
import { logger } from "../utils/Logger.js";

const SCHEME = "iosApp";
const SIMULATOR_NAME = "iPhone 17 Pro Max";
const SIMULATOR_OS = "26.2";
const DESTINATION = `platform=iOS Simulator,name=${SIMULATOR_NAME},OS=${SIMULATOR_OS}`;

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
 * Parses simulator UDID from xcrun simctl list devices output
 */
function parseSimulatorUDID(stdout: string, simulatorName: string): string | null {
    const lines = stdout.split("\n");
    for (const line of lines) {
        // Look for lines like: "    iPhone 17 Pro Max (UDID) (Booted)" or "    iPhone 17 Pro Max (UDID) (Shutdown)"
        const match = line.match(new RegExp(`\\s+${simulatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\(([A-F0-9-]+)\\)`));
        if (match) {
            // Check if OS version matches (this is a simplified check - in practice, we might need to check the full device list structure)
            // For now, we'll just get the first matching device name
            return match[1];
        }
    }
    return null;
}

/**
 * Checks if simulator is booted
 */
function isSimulatorBooted(stdout: string, udid: string): boolean {
    return stdout.includes(udid) && stdout.includes("(Booted)");
}

/**
 * Tool for running iOS XCUITest on a remote server
 */
export const remoteTestIosTool = {
    name: "remote_test_ios",
    description: "Run an XCUITest in iosApp/iosAppUITests/iosAppUITests.swift",
    inputSchema: z.object({
        project_id: z
            .string()
            .describe("The ID of the project"),
        test_name: z
            .string()
            .describe("The test name inside iosAppUITests.swift (e.g., 'testScrollingDownGesture')"),
    }),
    handler: async (args: { project_id: string; test_name: string }) => {
        const { project_id, test_name } = args;

        // Construct the full test path
        const test_path = `iosAppUITests/iosAppUITests/${test_name}`;

        const projectsPath = join(homedir(), "PistachioMCPProjects");
        const projectPath = join(projectsPath, project_id, "iosApp");

        // Check if project directory exists
        if (!existsSync(projectPath)) {
            return {
                output: `Error: Project directory not found for project_id: ${project_id}. Please verify the project exists.`,
                screenrecord: undefined,
                images: undefined,
                success: false,
            };
        }

        // Get simulator UDID
        let simulatorUDID: string | null = null;
        try {
            const { stdout } = await execAsync("xcrun simctl list devices available");
            simulatorUDID = parseSimulatorUDID(stdout, SIMULATOR_NAME);
            if (!simulatorUDID) {
                return {
                    output: `Error: Simulator "${SIMULATOR_NAME}" with OS ${SIMULATOR_OS} not found. Please ensure the simulator is available.`,
                    screenrecord: undefined,
                    images: undefined,
                    success: false,
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                output: `Error: Failed to list simulators: ${errorMessage}. Please ensure Xcode command line tools are installed.`,
                screenrecord: undefined,
                images: undefined,
                success: false,
            };
        }

        // Use device lock with simulator UDID
        return await withDeviceLock(simulatorUDID, async () => {
            // Check if simulator is already booted
            let isBooted = false;
            try {
                const { stdout } = await execAsync("xcrun simctl list devices");
                isBooted = isSimulatorBooted(stdout, simulatorUDID);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    output: `Error: Failed to check simulator status: ${errorMessage}`,
                    screenrecord: undefined,
                    images: undefined,
                    success: false,
                };
            }

            // Boot simulator if not already booted
            if (!isBooted) {
                try {
                    await execAsync(`xcrun simctl boot ${simulatorUDID}`);

                    // Wait for simulator to be ready
                    let deviceReady = false;
                    const maxWaitTime = 120000; // 2 minutes
                    const pollInterval = 2000; // 2 seconds
                    const startTime = Date.now();

                    while (!deviceReady && Date.now() - startTime < maxWaitTime) {
                        await new Promise((resolve) => setTimeout(resolve, pollInterval));
                        try {
                            const { stdout } = await execAsync("xcrun simctl list devices");
                            if (isSimulatorBooted(stdout, simulatorUDID)) {
                                deviceReady = true;
                                break;
                            }
                        } catch {
                            // Continue polling
                        }
                    }

                    if (!deviceReady) {
                        return {
                            output: `Error: Simulator failed to boot within ${maxWaitTime / 1000} seconds. Please check simulator logs.`,
                            screenrecord: undefined,
                            images: undefined,
                            success: false,
                        };
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        output: `Error: Failed to boot simulator: ${errorMessage}`,
                        screenrecord: undefined,
                        images: undefined,
                        success: false,
                    };
                }
            }

            // Prepare result bundle path
            const testResultUuid = randomUUID();
            const resultBundleName = `${testResultUuid}.xcresult`;
            const resultBundlePath = join(homedir(), "PistachioMCPProjects", resultBundleName);
            const attachmentsOutputDir = join(homedir(), "PistachioMCPProjects", `results_${testResultUuid}`);

            // Run xcodebuild test
            let output = "";
            let testSuccess = false;
            try {
                const { stdout, stderr } = await execAsync(
                    `xcodebuild test -scheme ${SCHEME} -destination '${DESTINATION}' -resultBundlePath "${resultBundlePath}" -only-testing:${test_path}`,
                    {
                        cwd: projectPath,
                    }
                );

                // Combine stdout and stderr for complete output
                output = stdout + (stderr ? `\n${stderr}` : "");

                // Check for test success/failure indicators
                // xcodebuild returns exit code 0 on success, but we also check output for explicit test results

                // Check for all failure indicators
                const hasFailureIndicators =
                    // Explicit test failure messages
                    output.includes("Test Suite 'All tests' failed") ||
                    output.includes("Test Failed") ||
                    // Other test suite failure patterns (variations we might have missed)
                    /Test Suite '[^']+' failed/.test(output) ||
                    // Test failure patterns (case-insensitive, more specific than just "FAILED")
                    /\bTest\s+.*\s+failed\b/i.test(output) ||
                    // Build failures that would prevent tests from running
                    output.includes("BUILD FAILED") ||
                    output.includes("xcodebuild: error:");

                // Check for explicit success indicators
                const hasExplicitSuccess =
                    output.includes("Test Suite 'All tests' passed") ||
                    output.includes("Test Succeeded");

                // If execAsync succeeded (no exception), exit code was 0, which typically means success
                // But we prefer explicit indicators in the output
                if (hasFailureIndicators) {
                    testSuccess = false;
                } else if (hasExplicitSuccess) {
                    testSuccess = true;
                } else {
                    // No explicit indicators found, but command succeeded (exit code 0)
                    // Default to success since exit code indicates success
                    testSuccess = true;
                }
            } catch (error) {
                // Even if the command fails, we still want to capture the output
                const errorMessage = error instanceof Error ? error.message : String(error);

                // Try to extract stdout/stderr from the error if available
                if (isExecError(error)) {
                    output = (error.stdout || "") + (error.stderr ? `\n${error.stderr}` : "");
                } else {
                    output = errorMessage;
                }

                // If command failed, test likely failed
                testSuccess = false;
            }

            // Extract attachments using xcparse
            let screenRecordGcsUrl: string | null = null;
            const imageSequence: string[] = [];

            if (existsSync(resultBundlePath)) {
                try {
                    // Create output directory for attachments
                    mkdirSync(attachmentsOutputDir, { recursive: true });

                    // Run xcparse to extract attachments
                    await execAsync(`xcparse attachments "${resultBundlePath}" "${attachmentsOutputDir}"`);
                } catch (error) {
                    // xcparse might not be installed or attachments might not exist
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.warn({
                        project_id,
                        simulator_udid: simulatorUDID,
                        result_bundle_path: resultBundlePath,
                        error_message: errorMessage,
                    }, "Could not extract attachments using xcparse");
                }

                // Process extracted attachments
                if (existsSync(attachmentsOutputDir)) {
                    try {
                        const attachmentFiles = readdirSync(attachmentsOutputDir, { recursive: true });

                        // Convert to strings and filter out non-string entries
                        const attachmentFileStrings = attachmentFiles
                            .map((file) => (typeof file === "string" ? file : String(file)))
                            .filter((file): file is string => typeof file === "string");

                        // Find video files (screen recordings)
                        const videoFiles = attachmentFileStrings.filter((file) =>
                            file.endsWith(".mp4") || file.endsWith(".mov") || file.endsWith(".m4v")
                        );

                        // Find the largest video file
                        let largestVideoFile: string | null = null;
                        let largestVideoSize = 0;
                        for (const videoFile of videoFiles) {
                            const videoPath = join(attachmentsOutputDir, videoFile);
                            if (existsSync(videoPath)) {
                                try {
                                    const stats = statSync(videoPath);
                                    if (stats.size > largestVideoSize) {
                                        largestVideoSize = stats.size;
                                        largestVideoFile = videoFile;
                                    }
                                } catch (error) {
                                    // Skip if we can't get stats
                                    const errorMessage = error instanceof Error ? error.message : String(error);
                                    logger.warn({
                                        project_id,
                                        video_file: videoFile,
                                        error_message: errorMessage,
                                    }, "Could not get video file stats");
                                }
                            }
                        }

                        // Process only the largest video (upload to GCS and extract frames)
                        if (largestVideoFile) {
                            const videoFile = largestVideoFile;
                            const videoPath = join(attachmentsOutputDir, videoFile);
                            if (existsSync(videoPath)) {
                                try {
                                    // Read the video file
                                    const fileBuffer = readFileSync(videoPath);

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

                                    // Get the public URL (use largest video found)
                                    screenRecordGcsUrl = `https://storage.googleapis.com/${finalBucketName}/${project_id}/${filename}`;

                                } catch (error) {
                                    // Log but don't fail if upload fails
                                    const errorMessage = error instanceof Error ? error.message : String(error);
                                    logger.warn({
                                        project_id,
                                        video_file: videoFile,
                                        error_message: errorMessage,
                                    }, "Could not upload video to GCS");
                                }

                                // Extract frames at 1fps and convert to base64
                                try {
                                    const framesDir = join(projectsPath, `frames_${randomUUID()}`);
                                    mkdirSync(framesDir, { recursive: true });

                                    // Extract frames using ffmpeg
                                    await execAsync(
                                        `ffmpeg -i "${videoPath}" -vf "fps=1,scale=320:-1" -q:v 6 "${join(framesDir, "frame_%04d.jpg")}"`
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
                            }
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.warn({
                            project_id,
                            attachments_output_dir: attachmentsOutputDir,
                            error_message: errorMessage,
                        }, "Could not process attachments");
                    }

                    // Clean up attachments directory
                    try {
                        rmSync(attachmentsOutputDir, { recursive: true, force: true });
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.warn({
                            project_id,
                            attachments_output_dir: attachmentsOutputDir,
                            error_message: errorMessage,
                        }, "Could not delete attachments directory");
                    }
                }

                // Clean up result bundle
                try {
                    rmSync(resultBundlePath, { recursive: true, force: true });
                } catch (error) {
                    logger.warn({
                        project_id,
                        result_bundle_path: resultBundlePath,
                        error_message: error instanceof Error ? error.message : String(error),
                    }, "Could not delete result bundle");
                }
            }

            // Return structured result with extracted data
            return {
                output: testSuccess ? "" : output.trim(),
                success: testSuccess,
                screenrecord: screenRecordGcsUrl || undefined,
                images: imageSequence.length > 0 ? imageSequence : undefined,
            };
        });
    },
};
