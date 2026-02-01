import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { remoteTestIosTool } from "../../tools/remote-test-ios.js";
import { exec } from "child_process";
import * as fs from "fs";

// Mock child_process.exec - must be done before importing the module
vi.mock("child_process", () => {
    type ExecCallback = ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
    type ExecOptions = Record<string, unknown> | undefined;

    interface ExecError extends Error {
        stdout?: string;
        stderr?: string;
    }

    const exec = vi.fn((command: string, optionsOrCallback?: ExecOptions | ExecCallback, callback?: ExecCallback) => {
        const actualCallback: ExecCallback = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
        if (actualCallback) {
            actualCallback(null, "", "");
        }
        return {} as ReturnType<typeof import("child_process").exec>;
    });
    // @ts-expect-error - Symbol.for is not recognized by TypeScript for this use case
    exec[Symbol.for('nodejs.util.promisify.custom')] = vi.fn((command: string, options?: ExecOptions, _callback?: ExecCallback) => {
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            const actualOptions: ExecOptions = typeof options === 'object' ? options : {};

            exec(command, actualOptions, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    if (error instanceof Error) {
                        const execError = error as ExecError;
                        execError.stdout = stdout;
                        execError.stderr = stderr;
                    }
                    reject(error instanceof Error ? error : new Error(String(error)));
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
    });
    return { exec };
});

// Mock fs operations
vi.mock("fs", async () => {
    const actual = await vi.importActual<typeof fs>("fs");
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("data")),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn().mockReturnValue([]),
        rmSync: vi.fn(),
        statSync: vi.fn().mockReturnValue({ size: 1000 }),
    };
});

// Mock os.homedir
vi.mock("os", () => ({
    homedir: vi.fn(() => "/home/test"),
}));

// Use vi.hoisted to define mocks that need to be available in vi.mock
const mocks = vi.hoisted(() => {
    const mockFile = {
        save: vi.fn().mockResolvedValue(undefined),
    };
    const mockBucket = {
        file: vi.fn().mockReturnValue(mockFile),
    };
    const mockStorageInstance = {
        bucket: vi.fn().mockReturnValue(mockBucket),
    };
    const mockLoggerWarn = vi.fn();
    return {
        mockFile,
        mockBucket,
        mockStorageInstance,
        mockLoggerWarn,
    };
});

// Mock @google-cloud/storage
vi.mock("@google-cloud/storage", () => ({
    // Use a regular function, not an arrow function, to ensure it can be used as a constructor
    Storage: vi.fn().mockImplementation(function () {
        return mocks.mockStorageInstance;
    }),
}));

// Mock crypto.randomUUID
vi.mock("crypto", () => ({
    randomUUID: vi.fn(() => "test-uuid-123"),
}));

// Mock logger
vi.mock("../../utils/Logger.js", () => ({
    logger: {
        warn: mocks.mockLoggerWarn,
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("remoteTestIosTool", () => {
    const mockExec = vi.mocked(exec);
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockReaddirSync = vi.mocked(fs.readdirSync);
    const mockStatSync = vi.mocked(fs.statSync);
    const mockLoggerWarn = mocks.mockLoggerWarn;

    interface CommandResponse {
        stdout: string;
        stderr: string;
        error?: Error;
    }
    let commandResponses: { pattern: string | RegExp; response: CommandResponse }[] = [];

    const testArgs = {
        project_id: "test-project",
        test_name: "testScrollingDownGesture",
    };

    const SIMULATOR_UDID = "ABC123-4567-8901";
    const SIMULATOR_NAME = "iPhone 17 Pro Max";
    const simulatorListOutput = `== Devices ==
-- iOS 26.1 --
    ${SIMULATOR_NAME} (${SIMULATOR_UDID}) (Booted)
    iPhone 15 Pro (DEF456-7890-1234) (Shutdown)`;

    const simulatorListAvailableOutput = `== Devices ==
-- iOS 26.1 --
    ${SIMULATOR_NAME} (${SIMULATOR_UDID}) (Available)
    iPhone 15 Pro (DEF456-7890-1234) (Available)`;

    beforeEach(() => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
        mockReaddirSync.mockReturnValue([]);
        mockReadFileSync.mockReturnValue(Buffer.from("data"));
        mockStatSync.mockReturnValue({ size: 1000 } as fs.Stats);
        mockLoggerWarn.mockClear();

        vi.spyOn(console, "error").mockImplementation(() => { });
        vi.spyOn(console, "warn").mockImplementation(() => { });

        commandResponses = [];
        mockExec.mockImplementation((command, opts, cb) => {
            const callback = typeof opts === 'function' ? opts : cb;
            const match = [...commandResponses].reverse().find(r =>
                typeof r.pattern === 'string' ? command.includes(r.pattern) : r.pattern.test(command)
            );

            let res: { stdout: string; stderr: string; error?: Error } = { stdout: "", stderr: "" };
            if (match) {
                res = match.response;
            } else if (command.includes("xcrun simctl list devices available")) {
                res = { stdout: simulatorListAvailableOutput, stderr: "" };
            } else if (command.includes("xcrun simctl list devices")) {
                res = { stdout: simulatorListOutput, stderr: "" };
            } else if (command.includes("xcodebuild test")) {
                res = { stdout: "Test Suite 'All tests' passed", stderr: "" };
            } else if (command.includes("xcparse attachments")) {
                res = { stdout: "", stderr: "" };
            } else if (command.includes("ffmpeg")) {
                res = { stdout: "", stderr: "" };
            }

            if (callback) {
                callback(res.error || null, res.stdout || "", res.stderr || "");
            }
            return {} as ReturnType<typeof import("child_process").exec>;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const mockExecResponse = (stdout: string = "", stderr: string = "", shouldThrow: boolean = false, pattern: string | RegExp = /.*/) => {
        const response = shouldThrow ? {
            error: new Error("Command failed"),
            stdout,
            stderr
        } : {
            stdout,
            stderr
        };
        commandResponses.push({ pattern, response });
    };

    describe("Project Directory Validation", () => {
        it("should return error when project directory doesn't exist", async () => {
            mockExistsSync.mockReturnValue(false);
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Project directory not found");
        });

        it("should proceed when project directory exists", async () => {
            vi.useFakeTimers();
            const handlerPromise = remoteTestIosTool.handler(testArgs);
            await vi.advanceTimersByTimeAsync(130000);
            await handlerPromise;
            expect(mockExec).toHaveBeenCalled();
        });
    });

    describe("Simulator Management", () => {
        it("should return error when xcrun simctl list devices available fails", async () => {
            mockExecResponse("", "", true, "xcrun simctl list devices available");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Failed to list simulators");
        });

        it("should return error when simulator not found", async () => {
            mockExecResponse("== Devices ==\n-- iOS 26.1 --\n    iPhone 15 Pro (DEF456-7890-1234) (Available)", "", false, "xcrun simctl list devices available");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Simulator \"iPhone 17 Pro Max\" with OS 26.1 not found");
        });

        it("should parse simulator UDID correctly", async () => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            await remoteTestIosTool.handler(testArgs);
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining("xcrun simctl list devices available"),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it("should detect simulator is already booted", async () => {
            mockExecResponse(simulatorListOutput, "", false, "xcrun simctl list devices");
            await remoteTestIosTool.handler(testArgs);
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining("xcrun simctl list devices"),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it("should boot simulator when not already booted", async () => {
            let callCount = 0;
            mockExec.mockImplementation((command, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                let res = { stdout: "", stderr: "" };
                if (command.includes("xcrun simctl list devices available")) {
                    res = { stdout: simulatorListAvailableOutput, stderr: "" };
                } else if (command.includes("xcrun simctl list devices")) {
                    callCount++;
                    if (callCount === 1) {
                        // First call: simulator is shutdown
                        res = { stdout: `== Devices ==\n-- iOS 26.1 --\n    ${SIMULATOR_NAME} (${SIMULATOR_UDID}) (Shutdown)`, stderr: "" };
                    } else {
                        // Subsequent calls: simulator is booted
                        res = { stdout: simulatorListOutput, stderr: "" };
                    }
                } else if (command.includes("xcrun simctl boot")) {
                    res = { stdout: "", stderr: "" };
                }
                if (callback) callback(null, res.stdout, res.stderr);
                return {} as ReturnType<typeof import("child_process").exec>;
            });

            vi.useFakeTimers();
            const handlerPromise = remoteTestIosTool.handler(testArgs);
            await vi.advanceTimersByTimeAsync(10000);
            await handlerPromise;
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining("xcrun simctl boot"),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it("should return error when simulator boot fails", async () => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            let callCount = 0;
            mockExec.mockImplementation((command, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                let res: { stdout: string; stderr: string; error?: Error } = { stdout: "", stderr: "" };
                if (command.includes("xcrun simctl list devices available")) {
                    res = { stdout: simulatorListAvailableOutput, stderr: "" };
                } else if (command.includes("xcrun simctl list devices")) {
                    callCount++;
                    if (callCount === 1) {
                        res = { stdout: `== Devices ==\n-- iOS 26.1 --\n    ${SIMULATOR_NAME} (${SIMULATOR_UDID}) (Shutdown)`, stderr: "" };
                    } else {
                        res = { stdout: `== Devices ==\n-- iOS 26.1 --\n    ${SIMULATOR_NAME} (${SIMULATOR_UDID}) (Shutdown)`, stderr: "" };
                    }
                } else if (command.includes("xcrun simctl boot")) {
                    res = { stdout: "", stderr: "", error: new Error("Boot failed") };
                }
                if (callback) callback(res.error ?? null, res.stdout || "", res.stderr || "");
                return {} as ReturnType<typeof import("child_process").exec>;
            });
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Failed to boot simulator");
        });

        it("should return error when simulator fails to boot within timeout", async () => {
            mockExec.mockImplementation((command, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                let res = { stdout: "", stderr: "" };
                if (command.includes("xcrun simctl list devices available")) {
                    res = { stdout: simulatorListAvailableOutput, stderr: "" };
                } else if (command.includes("xcrun simctl list devices")) {
                    // Always return shutdown status
                    res = { stdout: `== Devices ==\n-- iOS 26.1 --\n    ${SIMULATOR_NAME} (${SIMULATOR_UDID}) (Shutdown)`, stderr: "" };
                } else if (command.includes("xcrun simctl boot")) {
                    res = { stdout: "", stderr: "" };
                }
                if (callback) callback(null, res.stdout, res.stderr);
                return {} as ReturnType<typeof import("child_process").exec>;
            });

            vi.useFakeTimers();
            const handlerPromise = remoteTestIosTool.handler(testArgs);
            await vi.advanceTimersByTimeAsync(130000);
            const result = await handlerPromise;
            expect(result.success).toBe(false);
            expect(result.output).toContain("Simulator failed to boot within");
        });

        it("should return error when checking simulator status fails", async () => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            mockExec.mockImplementation((command, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                let res: { stdout: string; stderr: string; error?: Error } = { stdout: "", stderr: "" };
                if (command.includes("xcrun simctl list devices available")) {
                    res = { stdout: simulatorListAvailableOutput, stderr: "" };
                } else if (command.includes("xcrun simctl list devices") && !command.includes("available")) {
                    res = { stdout: "", stderr: "", error: new Error("Command failed") };
                }
                if (callback) callback(res.error ?? null, res.stdout || "", res.stderr || "");
                return {} as ReturnType<typeof import("child_process").exec>;
            });
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Failed to check simulator status");
        });
    });

    describe("Test Execution", () => {
        beforeEach(() => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            mockExecResponse(simulatorListOutput, "", false, "xcrun simctl list devices");
        });

        it("should execute xcodebuild test successfully", async () => {
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            await remoteTestIosTool.handler(testArgs);
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining("xcodebuild test"),
                expect.objectContaining({
                    cwd: expect.stringContaining("test-project") as unknown as string,
                }),
                expect.any(Function)
            );
        });

        it("should capture output when test passes", async () => {
            mockExecResponse("Test Suite 'All tests' passed\nTest Succeeded", "", false, "xcodebuild test");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
        });

        it("should capture output when test fails", async () => {
            mockExecResponse("Test Suite 'All tests' failed\nTest Failed", "", true, "xcodebuild test");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Test Suite 'All tests' failed");
        });

        it("should handle xcodebuild command failure", async () => {
            mockExecResponse("Build failed", "Error details", true, "xcodebuild test");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Build failed");
        });
    });

    describe("Result Bundle Processing", () => {
        beforeEach(() => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            mockExecResponse(simulatorListOutput, "", false, "xcrun simctl list devices");
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
        });

        it("should extract attachments using xcparse", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                return false;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            await remoteTestIosTool.handler(testArgs);
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining("xcparse attachments"),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it("should handle xcparse failure gracefully", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                return false;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "xcparse not found", true, "xcparse attachments");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(mockLoggerWarn).toHaveBeenCalledWith(
                expect.objectContaining({
                    project_id: "test-project",
                    simulator_udid: SIMULATOR_UDID,
                }),
                expect.stringContaining("Could not extract attachments using xcparse")
            );
        });

        it("should detect and select largest video file", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video files exist
                if (pathStr.includes("video1.mp4")) return true;
                if (pathStr.includes("video2.mp4")) return true;
                // Frames directory exists
                if (pathStr.includes("frames_")) return true;
                // Frame files exist
                if (pathStr.includes("frame_")) return true;
                return false;
            });
            mockReaddirSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                if (pathStr.includes("results_")) {
                    return ["video1.mp4", "video2.mp4"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                if (pathStr.includes("frames_")) {
                    return ["frame_0001.jpg"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [] as unknown as ReturnType<typeof fs.readdirSync>;
            });
            mockStatSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                if (pathStr.includes("video1.mp4")) {
                    return { size: 1000 } as fs.Stats;
                }
                if (pathStr.includes("video2.mp4")) {
                    return { size: 2000 } as fs.Stats;
                }
                return { size: 0 } as fs.Stats;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            mockExecResponse("", "", false, "ffmpeg");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
        });

        it("should handle when no attachments exist", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                return false;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(result.screenrecord).toBeUndefined();
            expect(result.images).toBeUndefined();
        });

        it("should filter video files correctly (.mp4, .mov, .m4v)", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video files exist
                if (pathStr.includes("video.mp4") || pathStr.includes("video.mov") || pathStr.includes("video.m4v")) return true;
                // Frames directory exists
                if (pathStr.includes("frames_")) return true;
                // Frame files exist
                if (pathStr.includes("frame_")) return true;
                return false;
            });
            mockReaddirSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                if (pathStr.includes("results_")) {
                    return ["video.mp4", "video.mov", "video.m4v", "image.png", "other.txt"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                if (pathStr.includes("frames_")) {
                    return ["frame_0001.jpg"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [] as unknown as ReturnType<typeof fs.readdirSync>;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            mockExecResponse("", "", false, "ffmpeg");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
        });
    });

    describe("Video Processing", () => {
        beforeEach(() => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            mockExecResponse(simulatorListOutput, "", false, "xcrun simctl list devices");
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
        });

        it("should upload video to GCS", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video file exists
                if (pathStr.includes("video.mp4")) return true;
                // Frames directory exists
                if (pathStr.includes("frames_")) return true;
                // Frame files exist
                if (pathStr.includes("frame_")) return true;
                return false;
            });
            mockReaddirSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                if (pathStr.includes("results_")) {
                    return ["video.mp4"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                if (pathStr.includes("frames_")) {
                    return ["frame_0001.jpg", "frame_0002.jpg"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [] as unknown as ReturnType<typeof fs.readdirSync>;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            mockExecResponse("", "", false, "ffmpeg");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(result.screenrecord).toBeDefined();
            expect(result.screenrecord).toContain("storage.googleapis.com");
        });

        it("should extract frames using ffmpeg", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video file exists
                if (pathStr.includes("video.mp4")) return true;
                // Frames directory exists
                if (pathStr.includes("frames_")) return true;
                // Frame files exist
                if (pathStr.includes("frame_")) return true;
                return false;
            });
            mockReaddirSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                if (pathStr.includes("results_")) {
                    return ["video.mp4"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                if (pathStr.includes("frames_")) {
                    return ["frame_0001.jpg", "frame_0002.jpg"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [] as unknown as ReturnType<typeof fs.readdirSync>;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            mockExecResponse("", "", false, "ffmpeg");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining("ffmpeg"),
                expect.any(Object),
                expect.any(Function)
            );
            expect(result.images).toBeDefined();
            expect(result.images?.length).toBe(2);
        });

        it("should convert frames to base64", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video file exists
                if (pathStr.includes("video.mp4")) return true;
                // Frames directory exists
                if (pathStr.includes("frames_")) return true;
                // Frame files exist
                if (pathStr.includes("frame_")) return true;
                return false;
            });
            mockReaddirSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                if (pathStr.includes("results_")) {
                    return ["video.mp4"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                if (pathStr.includes("frames_")) {
                    return ["frame_0001.jpg"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [] as unknown as ReturnType<typeof fs.readdirSync>;
            });
            mockReadFileSync.mockReturnValue(Buffer.from("frame-data"));
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            mockExecResponse("", "", false, "ffmpeg");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.images).toBeDefined();
            expect(result.images?.length).toBe(1);
            expect(mockReadFileSync).toHaveBeenCalled();
        });

        it("should handle GCS upload failure gracefully", async () => {
            mocks.mockFile.save.mockRejectedValueOnce(new Error("Upload failed"));
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video file exists
                if (pathStr.includes("video.mp4")) return true;
                return false;
            });
            mockReaddirSync.mockReturnValue(["video.mp4"] as unknown as ReturnType<typeof fs.readdirSync>);
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(mockLoggerWarn).toHaveBeenCalledWith(
                expect.objectContaining({
                    project_id: "test-project",
                }),
                expect.stringContaining("Could not upload video to GCS")
            );
        });

        it("should handle ffmpeg failure gracefully", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video file exists
                if (pathStr.includes("video.mp4")) return true;
                return false;
            });
            mockReaddirSync.mockReturnValue(["video.mp4"] as unknown as ReturnType<typeof fs.readdirSync>);
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            mockExecResponse("", "ffmpeg not found", true, "ffmpeg");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(mockLoggerWarn).toHaveBeenCalledWith(
                expect.objectContaining({
                    project_id: "test-project",
                }),
                expect.stringContaining("Could not extract frames from video")
            );
        });
    });

    describe("Error Handling", () => {
        beforeEach(() => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            mockExecResponse(simulatorListOutput, "", false, "xcrun simctl list devices");
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
        });

        it("should handle missing result bundle gracefully", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle doesn't exist
                if (pathStr.includes(".xcresult")) return false;
                return false;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(result.screenrecord).toBeUndefined();
            expect(result.images).toBeUndefined();
        });

        it("should handle attachment processing failures gracefully", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                return false;
            });
            mockReaddirSync.mockImplementation(() => {
                throw new Error("Failed to read directory");
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(mockLoggerWarn).toHaveBeenCalledWith(
                expect.objectContaining({
                    project_id: "test-project",
                }),
                expect.stringContaining("Could not process attachments")
            );
        });

        it("should handle cleanup failures gracefully", async () => {
            const mockRmSync = vi.mocked(fs.rmSync);
            mockRmSync.mockImplementation(() => {
                throw new Error("Cleanup failed");
            });
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                return false;
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(mockLoggerWarn).toHaveBeenCalled();
        });

        it("should handle video file stats failure gracefully", async () => {
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video file exists
                if (pathStr.includes("video.mp4")) return true;
                return false;
            });
            mockReaddirSync.mockReturnValue(["video.mp4"] as unknown as ReturnType<typeof fs.readdirSync>);
            mockStatSync.mockImplementation(() => {
                throw new Error("Stats failed");
            });
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(mockLoggerWarn).toHaveBeenCalledWith(
                expect.objectContaining({
                    project_id: "test-project",
                    video_file: "video.mp4",
                }),
                expect.stringContaining("Could not get video file stats")
            );
        });
    });

    describe("Full Happy Path", () => {
        it("should complete full happy path successfully", async () => {
            mockExecResponse(simulatorListAvailableOutput, "", false, "xcrun simctl list devices available");
            mockExecResponse(simulatorListOutput, "", false, "xcrun simctl list devices");
            mockExecResponse("Test Suite 'All tests' passed", "", false, "xcodebuild test");
            mockExecResponse("", "", false, "xcparse attachments");
            mockExistsSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                // Project directory exists
                if (pathStr.includes("iosApp") && !pathStr.includes(".xcresult")) return true;
                // Result bundle exists
                if (pathStr.includes(".xcresult")) return true;
                // Attachments directory exists
                if (pathStr.includes("results_")) return true;
                // Video file exists
                if (pathStr.includes("video.mp4")) return true;
                // Frames directory exists
                if (pathStr.includes("frames_")) return true;
                // Frame files exist
                if (pathStr.includes("frame_")) return true;
                return false;
            });
            mockReaddirSync.mockImplementation((path: fs.PathLike) => {
                const pathStr = String(path);
                if (pathStr.includes("results_")) {
                    return ["video.mp4"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                if (pathStr.includes("frames_")) {
                    return ["frame_0001.jpg", "frame_0002.jpg"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [] as unknown as ReturnType<typeof fs.readdirSync>;
            });
            mockExecResponse("", "", false, "ffmpeg");
            const result = await remoteTestIosTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(result.screenrecord).toBeDefined();
            expect(result.images).toBeDefined();
            expect(result.images?.length).toBe(2);
        });
    });
});
