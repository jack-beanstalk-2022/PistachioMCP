import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { exec } from "child_process";
import * as fs from "fs";

// Mock child_process.exec and promisify(exec) - must be before importing the module
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
    exec[Symbol.for("nodejs.util.promisify.custom")] = vi.fn((command: string, options?: ExecOptions, _callback?: ExecCallback) => {
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            const actualOptions: ExecOptions = typeof options === "object" ? options : {};
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

vi.mock("fs", async () => {
    const actual = await vi.importActual<typeof fs>("fs");
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue("12345"),
        unlinkSync: vi.fn(),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn().mockReturnValue([]),
        rmSync: vi.fn(),
        writeFileSync: vi.fn(),
    };
});

vi.mock("os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("os")>();
    return {
        ...actual,
        tmpdir: vi.fn(() => "/tmp"),
    };
});

import {
    parseArgs,
    acquireDeviceLock,
    hasTestFailureIndicators,
    extractLogcatErrors,
    extractFramesFromVideo,
    runAndroidTest,
} from "../../../skills/run-android-test/test-android.js";

describe("test-android (skills/run-android-test)", () => {
    const mockExec = vi.mocked(exec);
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockReaddirSync = vi.mocked(fs.readdirSync);
    const mockMkdirSync = vi.mocked(fs.mkdirSync);
    const mockRmSync = vi.mocked(fs.rmSync);
    const mockWriteFileSync = vi.mocked(fs.writeFileSync);
    const mockUnlinkSync = vi.mocked(fs.unlinkSync);

    interface CommandResponse {
        stdout: string;
        stderr: string;
        error?: Error;
    }
    let commandResponses: { pattern: string | RegExp; response: CommandResponse }[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
        mockReaddirSync.mockReturnValue([]);
        mockReadFileSync.mockReturnValue("12345");
        mockMkdirSync.mockImplementation(() => undefined);
        mockRmSync.mockImplementation(() => undefined);
        mockWriteFileSync.mockImplementation(() => undefined);
        mockUnlinkSync.mockImplementation(() => undefined);
        vi.spyOn(console, "log").mockImplementation(() => { });
        vi.spyOn(console, "warn").mockImplementation(() => { });
        vi.spyOn(console, "error").mockImplementation(() => { });

        commandResponses = [];
        mockExec.mockImplementation((command, opts, cb) => {
            const callback = typeof opts === "function" ? opts : cb;
            const match = [...commandResponses].reverse().find((r) =>
                typeof r.pattern === "string" ? command.includes(r.pattern) : r.pattern.test(command)
            );
            let res: { stdout: string; stderr: string; error?: Error } = { stdout: "", stderr: "" };
            if (match) res = match.response;
            if (callback) callback(res.error ?? null, res.stdout, res.stderr);
            return {} as ReturnType<typeof import("child_process").exec>;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe("parseArgs", () => {
        it("returns success with valid four arguments", () => {
            const result = parseArgs(["/path/to/project", "com.example.app", "MyTestSuite", "testMethod"]);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.project_dir).toBe("/path/to/project");
                expect(result.package_name).toBe("com.example.app");
                expect(result.test_suite_name).toBe("MyTestSuite");
                expect(result.test_name).toBe("testMethod");
            }
        });

        it("returns failure with usage message when argument count is not 4", () => {
            expect(parseArgs([]).ok).toBe(false);
            expect(parseArgs(["a", "b"]).ok).toBe(false);
            expect(parseArgs(["a", "b", "c", "d", "e"]).ok).toBe(false);
            const result = parseArgs([]);
            if (!result.ok) {
                expect(result.message).toContain("Usage:");
                expect(result.message).toContain("test-android.ts");
            }
        });

        it("returns failure when project_dir is empty or whitespace", () => {
            const r1 = parseArgs(["", "pkg", "Suite", "test"]);
            const r2 = parseArgs(["  ", "pkg", "Suite", "test"]);
            expect(r1.ok).toBe(false);
            expect(r2.ok).toBe(false);
            if (!r1.ok) expect(r1.message).toContain("project_dir");
        });

        it("returns failure when package_name is empty or whitespace", () => {
            const r = parseArgs(["/path", "", "Suite", "test"]);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.message).toContain("package_name");
        });

        it("returns failure when test_suite_name is empty or whitespace", () => {
            const r = parseArgs(["/path", "pkg", "", "test"]);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.message).toContain("test_suite_name");
        });

        it("returns failure when test_name is empty or whitespace", () => {
            const r = parseArgs(["/path", "pkg", "Suite", ""]);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.message).toContain("test_name");
        });
    });

    describe("hasTestFailureIndicators", () => {
        it("returns true when output contains FAILURES!!!", () => {
            expect(hasTestFailureIndicators("Some output\nFAILURES!!!\nmore")).toBe(true);
        });

        it("returns true when Tests run has Failures >= 1", () => {
            expect(hasTestFailureIndicators("Tests run: 3, Failures: 1")).toBe(true);
            expect(hasTestFailureIndicators("Tests run: 10, Failures: 2")).toBe(true);
        });

        it("returns false when Failures is 0", () => {
            expect(hasTestFailureIndicators("Tests run: 1, Failures: 0")).toBe(false);
        });

        it("returns true for INSTRUMENTATION_FAILED", () => {
            expect(hasTestFailureIndicators("INSTRUMENTATION_FAILED")).toBe(true);
        });

        it("returns true for INSTRUMENTATION_STATUS_CODE: -1", () => {
            expect(hasTestFailureIndicators("INSTRUMENTATION_STATUS_CODE: -1")).toBe(true);
        });

        it("returns true for Java/Kotlin exceptions", () => {
            expect(hasTestFailureIndicators("java.lang.AssertionError")).toBe(true);
            expect(hasTestFailureIndicators("kotlin.KotlinNullPointerException")).toBe(true);
        });

        it("returns true for Test failed", () => {
            expect(hasTestFailureIndicators("Test failed")).toBe(true);
        });

        it("returns false for clean success output", () => {
            expect(hasTestFailureIndicators("INSTRUMENTATION_CODE: 0\nOK (1 test)")).toBe(false);
        });
    });

    describe("extractLogcatErrors", () => {
        it("extracts content between ERROR_LOGS_START and ERROR_LOGS_END", () => {
            const output = "prefix\nERROR_LOGS_START\nError line 1\nError line 2\nERROR_LOGS_END\nsuffix";
            expect(extractLogcatErrors(output)).toBe("Error line 1\nError line 2");
        });

        it("returns empty string when no markers present", () => {
            expect(extractLogcatErrors("no markers here")).toBe("");
        });

        it("handles multiple blocks and joins with newline", () => {
            const output = "ERROR_LOGS_START\na\nERROR_LOGS_END\nERROR_LOGS_START\nb\nERROR_LOGS_END";
            expect(extractLogcatErrors(output)).toBe("a\nb");
        });
    });

    describe("acquireDeviceLock", () => {
        it("acquires lock when mkdirSync succeeds and returns release callback", async () => {
            mockMkdirSync.mockImplementation(() => undefined);
            const { release } = await acquireDeviceLock("emulator-5554");
            expect(mockMkdirSync).toHaveBeenCalled();
            release();
            expect(mockRmSync).toHaveBeenCalled();
        });

        it("removes stale lock when locked PID no longer exists", async () => {
            const originalKill = process.kill.bind(process);
            let attempt = 0;
            mockMkdirSync.mockImplementation(() => {
                attempt++;
                if (attempt === 1) {
                    const err = new Error("EEXIST") as NodeJS.ErrnoException;
                    err.code = "EEXIST";
                    throw err;
                }
                return undefined;
            });
            mockReadFileSync.mockReturnValue("99999"); // non-existent PID
            process.kill = vi.fn(() => {
                throw new Error("kill ESRCH");
            }) as typeof process.kill;

            vi.useFakeTimers();
            const lockPromise = acquireDeviceLock("emulator-5554", { timeoutMs: 5000, pollIntervalMs: 100 });
            await vi.advanceTimersByTimeAsync(150);
            const { release } = await lockPromise;
            release();
            expect(mockRmSync).toHaveBeenCalled();
            vi.useRealTimers();
            process.kill = originalKill;
        });

        it("throws after timeout when lock is held and PID is valid", async () => {
            const originalKill = process.kill.bind(process);
            mockMkdirSync.mockImplementation(() => {
                const err = new Error("EEXIST") as NodeJS.ErrnoException;
                err.code = "EEXIST";
                throw err;
            });
            mockReadFileSync.mockReturnValue(String(process.pid));
            process.kill = vi.fn(() => true) as typeof process.kill;

            vi.useFakeTimers();
            const lockPromise = acquireDeviceLock("emulator-5554", { timeoutMs: 500, pollIntervalMs: 100 });
            const outcome = lockPromise.then(
                () => ({ ok: true as const }),
                (e: Error) => ({ ok: false as const, error: e })
            );
            await vi.advanceTimersByTimeAsync(600);
            const result = await outcome;
            vi.useRealTimers();
            process.kill = originalKill;
            expect(result.ok).toBe(false);
            expect("error" in result && result.error instanceof Error ? result.error.message : "").toMatch(/Failed to acquire device lock within/);
        });

        it("throws on non-EEXIST mkdir error", async () => {
            mockMkdirSync.mockImplementation(() => {
                throw new Error("EACCES");
            });
            await expect(acquireDeviceLock("emulator-5554")).rejects.toThrow(/Error acquiring device lock/);
        });
    });

    describe("extractFramesFromVideo", () => {
        const promisifyKey = Symbol.for("nodejs.util.promisify.custom");

        function getExecPromisifyMock(): Mock<(cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>> {
            return (mockExec as unknown as Record<symbol, Mock<(cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>>>)[promisifyKey];
        }

        it("uses short-video path when duration in (0, 1) and keeps one frame", async () => {
            const execPromisify = getExecPromisifyMock();
            execPromisify.mockImplementation((cmd: string) => {
                if (cmd.includes("ffprobe")) return Promise.resolve({ stdout: "0.5", stderr: "" });
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockReaddirSync.mockReturnValue(["frame_00001.jpg", "frame_00002.jpg"] as unknown as ReturnType<typeof fs.readdirSync>);

            const result = await extractFramesFromVideo("/tmp/video.mp4", "/tmp/frames");
            expect(result.frameCount).toBe(1);
            expect(mockUnlinkSync).toHaveBeenCalled();
        });

        it("uses fps=1 path when duration >= 1 and returns frame count", async () => {
            const execPromisify = getExecPromisifyMock();
            execPromisify.mockImplementation((cmd: string) => {
                if (cmd.includes("ffprobe")) return Promise.resolve({ stdout: "2.0", stderr: "" });
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockReaddirSync.mockReturnValue(["frame_0001.jpg", "frame_0002.jpg", "frame_0003.jpg"] as unknown as ReturnType<typeof fs.readdirSync>);

            const result = await extractFramesFromVideo("/tmp/video.mp4", "/tmp/frames");
            expect(result.frameCount).toBe(3);
        });

        it("falls back to short-video path when initial frameCount is 0", async () => {
            const execPromisify = getExecPromisifyMock();
            execPromisify.mockImplementation((_cmd: string) => Promise.resolve({ stdout: "", stderr: "" }));
            mockReaddirSync
                .mockReturnValueOnce([] as unknown as ReturnType<typeof fs.readdirSync>)
                .mockReturnValueOnce(["frame_00001.jpg"] as unknown as ReturnType<typeof fs.readdirSync>);

            const result = await extractFramesFromVideo("/tmp/video.mp4", "/tmp/frames");
            expect(result.frameCount).toBe(1);
        });
    });

    describe("runAndroidTest", () => {
        const projectDir = "/tmp/project";
        const packageName = "com.example.app";
        const testSuiteName = "MySuite";
        const testName = "testFoo";
        const promisifyKey = Symbol.for("nodejs.util.promisify.custom");

        function getPromisifyExec(): Mock<(cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>> {
            return (mockExec as unknown as Record<symbol, Mock<(cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>>>)[promisifyKey];
        }

        function setupPromisifyHappyPath() {
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("adb devices")) return Promise.resolve({ stdout: "List of devices attached\nemulator-5554\tdevice\n\n", stderr: "" });
                if (cmd.includes("gradlew")) return Promise.resolve({ stdout: "BUILD SUCCESSFUL", stderr: "" });
                if (cmd.includes("instrument")) return Promise.resolve({ stdout: "INSTRUMENTATION_CODE: 0", stderr: "" });
                if (cmd.includes("pull") || cmd.includes("uninstall") || cmd.includes("install")) return Promise.resolve({ stdout: "OK", stderr: "" });
                return Promise.resolve({ stdout: "", stderr: "" });
            });
        }

        it("throws when project directory does not exist", async () => {
            mockExistsSync.mockReturnValue(false);
            await expect(runAndroidTest(projectDir, packageName, testSuiteName, testName)).rejects.toThrow(
                /Project directory not found/
            );
        });

        it("throws when assembleDebug fails", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("assembleDebug") && !cmd.includes("AndroidTest")) {
                    return Promise.reject(Object.assign(new Error("Build failed"), { stdout: "", stderr: "Build failed" }));
                }
                if (cmd.includes("gradlew") || cmd.includes("adb") || cmd.includes("install") || cmd.includes("uninstall") || cmd.includes("pull")) {
                    return Promise.resolve({ stdout: "OK", stderr: "" });
                }
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            await expect(runAndroidTest(projectDir, packageName, testSuiteName, testName)).rejects.toThrow(
                /Failed to assemble debug APK/
            );
        });

        it("throws when assembleDebugAndroidTest fails", async () => {
            mockExistsSync.mockReturnValue(true);
            let gradleCallCount = 0;
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("assembleDebug")) {
                    gradleCallCount++;
                    if (gradleCallCount === 2) {
                        return Promise.reject(Object.assign(new Error("Build failed"), { stdout: "", stderr: "Build failed" }));
                    }
                }
                if (cmd.includes("gradlew") || cmd.includes("adb") || cmd.includes("install") || cmd.includes("uninstall") || cmd.includes("pull")) {
                    return Promise.resolve({ stdout: "OK", stderr: "" });
                }
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            await expect(runAndroidTest(projectDir, packageName, testSuiteName, testName)).rejects.toThrow(
                /Failed to assemble debug Android test APK/
            );
        });

        it("throws when adb devices fails", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("adb devices")) {
                    return Promise.reject(new Error("adb command not found"));
                }
                if (cmd.includes("gradlew")) return Promise.resolve({ stdout: "BUILD SUCCESSFUL", stderr: "" });
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            await expect(runAndroidTest(projectDir, packageName, testSuiteName, testName)).rejects.toThrow(
                /adb command not found/
            );
        });

        it("tries to boot emulator when no device is running and then completes successfully", async () => {
            vi.useFakeTimers();
            mockExistsSync.mockReturnValue(true);
            let adbDevicesCallCount = 0;
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("adb devices")) {
                    adbDevicesCallCount++;
                    // First call (Step 3): no device. Later calls (boot poll): device available.
                    const noDevice = "List of devices attached\n\n";
                    const deviceReady = "List of devices attached\nemulator-5554\tdevice\n\n";
                    return Promise.resolve({
                        stdout: adbDevicesCallCount === 1 ? noDevice : deviceReady,
                        stderr: "",
                    });
                }
                if (cmd.includes("emulator -list-avds")) {
                    return Promise.resolve({ stdout: "Pixel_4_API_30\n", stderr: "" });
                }
                if (cmd.includes("gradlew")) return Promise.resolve({ stdout: "BUILD SUCCESSFUL", stderr: "" });
                if (cmd.includes("instrument")) return Promise.resolve({ stdout: "INSTRUMENTATION_CODE: 0", stderr: "" });
                if (cmd.includes("pull") || cmd.includes("uninstall") || cmd.includes("install")) {
                    return Promise.resolve({ stdout: "OK", stderr: "" });
                }
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockExec.mockImplementation((command, opts, cb) => {
                const callback = typeof opts === "function" ? opts : cb;
                if (typeof command === "string" && command.includes("emulator -avd")) {
                    if (callback) callback(null, "", "");
                    return {} as ReturnType<typeof import("child_process").exec>;
                }
                const match = [...commandResponses].reverse().find((r) =>
                    typeof r.pattern === "string" ? command.includes(r.pattern) : r.pattern.test(String(command))
                );
                const res = match ? match.response : { stdout: "", stderr: "" };
                if (callback) callback(res.error ?? null, res.stdout, res.stderr);
                return {} as ReturnType<typeof import("child_process").exec>;
            });
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("screenrecord") || pathStr.includes("frames_")) return false;
                return true;
            });

            const runPromise = runAndroidTest(projectDir, packageName, testSuiteName, testName);
            // Advance past first poll (2000ms) and boot wait (10000ms) so emulator path completes
            await vi.advanceTimersByTimeAsync(2000);
            await vi.advanceTimersByTimeAsync(10000);
            const result = await runPromise;

            expect(result.success).toBe(true);
            expect(result.output).toContain("INSTRUMENTATION_CODE: 0");
            expect(getPromisifyExec()).toHaveBeenCalledWith(expect.stringContaining("emulator -list-avds"));
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringMatching(/emulator -avd .+ -port 5554/),
                expect.any(Function)
            );
        });

        it("completes full happy path and returns success when emulator already running", async () => {
            mockExistsSync.mockReturnValue(true);
            setupPromisifyHappyPath();
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("screenrecord") || pathStr.includes("frames_")) return false;
                return true;
            });

            const result = await runAndroidTest(projectDir, packageName, testSuiteName, testName);
            expect(result.success).toBe(true);
            expect(result.output).toContain("INSTRUMENTATION_CODE: 0");
        });

        it("returns success: false and logcatErrors when instrumentation output has failure indicators", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("adb devices")) return Promise.resolve({ stdout: "List of devices attached\nemulator-5554\tdevice\n\n", stderr: "" });
                if (cmd.includes("gradlew")) return Promise.resolve({ stdout: "BUILD SUCCESSFUL", stderr: "" });
                if (cmd.includes("instrument")) {
                    const err = Object.assign(new Error("fail"), {
                        stdout: "FAILURES!!!\nERROR_LOGS_START\nActual error\nERROR_LOGS_END",
                        stderr: "",
                    });
                    return Promise.reject(err);
                }
                if (cmd.includes("pull") || cmd.includes("uninstall") || cmd.includes("install")) return Promise.resolve({ stdout: "OK", stderr: "" });
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("screenrecord") || pathStr.includes("frames_")) return false;
                return true;
            });

            const result = await runAndroidTest(projectDir, packageName, testSuiteName, testName);
            expect(result.success).toBe(false);
            expect(result.logcatErrors).toContain("Actual error");
        });

        it("returns success when test passes even if cleanup (uninstall) fails", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("adb devices")) return Promise.resolve({ stdout: "List of devices attached\nemulator-5554\tdevice\n\n", stderr: "" });
                if (cmd.includes("gradlew")) return Promise.resolve({ stdout: "BUILD SUCCESSFUL", stderr: "" });
                if (cmd.includes("instrument")) return Promise.resolve({ stdout: "INSTRUMENTATION_CODE: 0", stderr: "" });
                if (cmd.includes("pull") || cmd.includes("install")) return Promise.resolve({ stdout: "OK", stderr: "" });
                if (cmd.includes("uninstall")) return Promise.reject(new Error("uninstall failed"));
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("screenrecord") || pathStr.includes("frames_")) return false;
                return true;
            });

            const result = await runAndroidTest(projectDir, packageName, testSuiteName, testName);
            expect(result.success).toBe(true);
            expect(result.output).toContain("INSTRUMENTATION_CODE: 0");
        });
    });
});
