import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { remoteTestAndroidTool } from "../../tools/remote-test-android.js";
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
        unlinkSync: vi.fn(),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn().mockReturnValue([]),
        rmSync: vi.fn(),
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
    return {
        mockFile,
        mockBucket,
        mockStorageInstance,
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

describe("remoteTestAndroidTool", () => {
    const mockExec = vi.mocked(exec);
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockReaddirSync = vi.mocked(fs.readdirSync);

    interface CommandResponse {
        stdout: string;
        stderr: string;
        error?: Error;
    }
    let commandResponses: { pattern: string | RegExp; response: CommandResponse }[] = [];

    const testArgs = {
        project_id: "test-project",
        test_name: "ScrollingInstrumentedTest",
        package_name: "com.jetbrains.kmpapp",
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
        mockReaddirSync.mockReturnValue([]);
        mockReadFileSync.mockReturnValue(Buffer.from("data"));

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
            } else if (command.includes("adb devices")) {
                res = { stdout: "List of devices attached\n\n", stderr: "" };
            } else if (command.includes("emulator -list-avds")) {
                res = { stdout: "Pixel_7_API_31\n", stderr: "" };
            } else if (command.includes("gradlew")) {
                res = { stdout: "BUILD SUCCESSFUL", stderr: "" };
            } else if (command.includes("instrument")) {
                res = { stdout: "INSTRUMENTATION_CODE: 0", stderr: "" };
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
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Project directory not found");
        });

        it("should proceed when project directory exists", async () => {
            vi.useFakeTimers();
            const handlerPromise = remoteTestAndroidTool.handler(testArgs);
            await vi.advanceTimersByTimeAsync(130000);
            await handlerPromise;
            expect(mockExec).toHaveBeenCalled();
        });
    });

    describe("ADB Devices Check (Step 1)", () => {
        it("should return error when adb command fails", async () => {
            mockExecResponse("", "", true, "adb devices");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("adb command not found");
        });

        it("should detect running emulator", async () => {
            mockExecResponse("List of devices attached\nemulator-5554\tdevice\n\n", "", false, "adb devices");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("adb devices"), expect.any(Object), expect.any(Function));
        });

        it("should proceed to emulator start when no device is running", async () => {
            vi.useFakeTimers();
            const handlerPromise = remoteTestAndroidTool.handler(testArgs);
            await vi.advanceTimersByTimeAsync(130000);
            const result = await handlerPromise;
            expect(result.success).toBe(false);
            expect(result.output).toContain("Emulator failed to start within");
        });
    });

    describe("Emulator Management (Step 2)", () => {
        it("should return error when emulator -list-avds fails", async () => {
            mockExecResponse("", "", true, "emulator -list-avds");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Failed to start emulator");
        });

        it("should return error when no AVDs are found", async () => {
            mockExecResponse("\n", "", false, "emulator -list-avds");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("No Android Virtual Devices");
        });

        it("should return error when specified AVD doesn't exist", async () => {
            mockExecResponse("Other_AVD\nAnother_AVD\n", "", false, "emulator -list-avds");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("AVD \"Pixel_7_API_31\" not found");
        });

        it("should return error when emulator fails to start", async () => {
            vi.useFakeTimers();
            mockExecResponse("", "", true, "emulator -avd");
            const handlerPromise = remoteTestAndroidTool.handler(testArgs);
            await vi.advanceTimersByTimeAsync(130000);
            const result = await handlerPromise;
            expect(result.success).toBe(false);
            expect(result.output).toContain("Emulator failed to start within");
        });

        it("should succeed when emulator starts and becomes ready", async () => {
            let callCount = 0;
            mockExec.mockImplementation((command, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                let res = { stdout: "SUCCESS", stderr: "" };
                if (command.includes("adb devices")) {
                    callCount++;
                    if (callCount < 3) res = { stdout: "List of devices attached\n\n", stderr: "" };
                    else res = { stdout: "List of devices attached\nemulator-5554\tdevice\n\n", stderr: "" };
                } else if (command.includes("emulator -list-avds")) {
                    res = { stdout: "Pixel_7_API_31\n", stderr: "" };
                }
                if (callback) callback(null, res.stdout, res.stderr);
                return {} as ReturnType<typeof import("child_process").exec>;
            });

            vi.useFakeTimers();
            const handlerPromise = remoteTestAndroidTool.handler(testArgs);
            await vi.advanceTimersByTimeAsync(10000);
            const result = await handlerPromise;
            expect(result.success).toBe(true);
        });
    });

    describe("Gradle Commands", () => {
        beforeEach(() => {
            mockExecResponse("List of devices attached\nemulator-5554\tdevice\n\n", "", false, "adb devices");
        });

        it("should return error when ./gradlew installDebug fails", async () => {
            mockExecResponse("", "Error", true, "installDebug");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Failed to install debug APK");
        });

        it("should return error when ./gradlew assembleDebugAndroidTest fails", async () => {
            mockExecResponse("", "Error", true, "assembleDebugAndroidTest");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Failed to assemble debug Android test APK");
        });
    });

    describe("Test Execution (Step 6)", () => {
        beforeEach(() => {
            mockExecResponse("List of devices attached\nemulator-5554\tdevice\n\n", "", false, "adb devices");
        });

        it("should capture output when test passes", async () => {
            mockExecResponse("Tests run: 1, Failures: 0\nINSTRUMENTATION_CODE: 0", "", false, "instrument");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(result.output).toContain("INSTRUMENTATION_CODE: 0");
        });

        it("should capture output when test fails", async () => {
            mockExecResponse("Tests run: 1, Failures: 1\nFAILURES!!!", "Error details", true, "instrument");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(false);
            expect(result.output).toContain("FAILURES!!!");
        });

        it("should extract logcat errors from output", async () => {
            mockExecResponse("ERROR_LOGS_START\nError line 1\nERROR_LOGS_END", "", false, "instrument");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.output).toBe("Error line 1");
        });
    });

    describe("Screen Recording (Step 8)", () => {
        beforeEach(() => {
            mockExecResponse("List of devices attached\nemulator-5554\tdevice\n\n", "", false, "adb devices");
        });

        it("should handle screen recording pull failure gracefully", async () => {
            mockExecResponse("", "Pull failed", true, "pull");
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Could not pull screen recording"));
        });

        it("should upload video to GCS and extract frames", async () => {
            mockReaddirSync.mockReturnValue(["frame_0001.jpg"] as unknown as ReturnType<typeof fs.readdirSync>);
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(result.screenrecord).toBeDefined();
            expect(result.images).toBeDefined();
        });
    });

    describe("Full Happy Path", () => {
        it("should complete full happy path successfully", async () => {
            mockExecResponse("List of devices attached\nemulator-5554\tdevice\n\n", "", false, "adb devices");
            mockReaddirSync.mockReturnValue(["frame_0001.jpg"] as unknown as ReturnType<typeof fs.readdirSync>);
            const result = await remoteTestAndroidTool.handler(testArgs);
            expect(result.success).toBe(true);
            expect(result.images?.length).toBe(1);
        });
    });
});
