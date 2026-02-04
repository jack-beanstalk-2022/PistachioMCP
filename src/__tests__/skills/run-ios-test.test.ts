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
        statSync: vi.fn().mockReturnValue({ size: 1000 }),
    };
});

vi.mock("os", () => ({
    tmpdir: vi.fn(() => "/tmp"),
}));

vi.mock("crypto", () => ({
    randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import {
    parseArgs,
    getFirstIphoneSimulator,
    isSimulatorBooted,
    acquireDeviceLock,
    hasTestFailureIndicators,
    extractFramesFromVideo,
    runIosTest,
} from "../../../skills/run-ios-test/test-ios.js";

describe("test-ios (skills/run-ios-test)", () => {
    const mockExec = vi.mocked(exec);
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockReaddirSync = vi.mocked(fs.readdirSync);
    const mockMkdirSync = vi.mocked(fs.mkdirSync);
    const mockRmSync = vi.mocked(fs.rmSync);
    const mockWriteFileSync = vi.mocked(fs.writeFileSync);
    const mockUnlinkSync = vi.mocked(fs.unlinkSync);
    const mockStatSync = vi.mocked(fs.statSync);

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
        mockStatSync.mockReturnValue({ size: 1000 } as ReturnType<typeof fs.statSync>);
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
        it("returns success with valid two arguments", () => {
            const result = parseArgs(["/path/to/iosApp", "testScrollingDownGesture"]);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.project_dir).toBe("/path/to/iosApp");
                expect(result.test_name).toBe("testScrollingDownGesture");
            }
        });

        it("returns failure with usage message when argument count is not 2", () => {
            expect(parseArgs([]).ok).toBe(false);
            expect(parseArgs(["a"]).ok).toBe(false);
            expect(parseArgs(["a", "b", "c"]).ok).toBe(false);
            const result = parseArgs([]);
            if (!result.ok) {
                expect(result.message).toContain("Usage:");
                expect(result.message).toContain("test-ios.ts");
            }
        });

        it("returns failure when project_dir is empty or whitespace", () => {
            const r1 = parseArgs(["", "testName"]);
            const r2 = parseArgs(["  ", "testName"]);
            expect(r1.ok).toBe(false);
            expect(r2.ok).toBe(false);
            if (!r1.ok) expect(r1.message).toContain("project_dir");
        });

        it("returns failure when test_name is empty or whitespace", () => {
            const r = parseArgs(["/path", ""]);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.message).toContain("test_name");
        });
    });

    describe("getFirstIphoneSimulator", () => {
        it("returns first iPhone simulator when OS version is >= 26.1", () => {
            const stdout = [
                "-- iOS 26.1 --",
                "    iPhone 16 Pro (A1B2C3D4-E5F6-7890-ABCD-EF1234567890) (Booted)",
                "    iPhone 16 (X1Y2Z3A4-B5C6-7890-ABCD-EF1234567891) (Shutdown)",
            ].join("\n");
            const result = getFirstIphoneSimulator(stdout);
            expect(result).not.toBeNull();
            if (result) {
                expect(result.name).toBe("iPhone 16 Pro");
                expect(result.os).toBe("26.1");
                expect(result.udid).toBe("A1B2C3D4-E5F6-7890-ABCD-EF1234567890");
            }
        });

        it("returns null when no iOS section meets minimum OS version", () => {
            const stdout = [
                "-- iOS 25.0 --",
                "    iPhone 15 (A1B2C3D4-E5F6-7890-ABCD-EF1234567890) (Shutdown)",
            ].join("\n");
            const result = getFirstIphoneSimulator(stdout);
            expect(result).toBeNull();
        });

        it("returns first matching device when multiple OS sections", () => {
            const stdout = [
                "-- iOS 25.0 --",
                "    iPhone 15 (A1B2C3D4-0000-0000-0000-000000000001) (Shutdown)",
                "-- iOS 26.1 --",
                "    iPhone 16 (A1B2C3D4-0000-0000-0000-000000000002) (Shutdown)",
            ].join("\n");
            const result = getFirstIphoneSimulator(stdout);
            expect(result).not.toBeNull();
            if (result) {
                expect(result.name).toBe("iPhone 16");
                expect(result.udid).toBe("A1B2C3D4-0000-0000-0000-000000000002");
            }
        });

        it("returns null for empty or non-matching output", () => {
            expect(getFirstIphoneSimulator("")).toBeNull();
            expect(getFirstIphoneSimulator("No devices here")).toBeNull();
        });
    });

    describe("isSimulatorBooted", () => {
        it("returns true when stdout contains udid and (Booted)", () => {
            const stdout = "    iPhone 16 (ABC-123) (Booted)";
            expect(isSimulatorBooted(stdout, "ABC-123")).toBe(true);
        });

        it("returns false when udid is present but not Booted", () => {
            const stdout = "    iPhone 16 (ABC-123) (Shutdown)";
            expect(isSimulatorBooted(stdout, "ABC-123")).toBe(false);
        });

        it("returns false when udid is not in stdout", () => {
            expect(isSimulatorBooted("iPhone 16 (OTHER-UUID) (Booted)", "ABC-123")).toBe(false);
        });
    });

    describe("hasTestFailureIndicators", () => {
        it("returns true when output contains Test Suite 'All tests' failed", () => {
            expect(hasTestFailureIndicators("Test Suite 'All tests' failed")).toBe(true);
        });

        it("returns true when output contains Test Failed", () => {
            expect(hasTestFailureIndicators("Test Failed")).toBe(true);
        });

        it("returns true for Test Suite 'SomeSuite' failed pattern", () => {
            expect(hasTestFailureIndicators("Test Suite 'iosAppUITests' failed")).toBe(true);
        });

        it("returns true for BUILD FAILED", () => {
            expect(hasTestFailureIndicators("BUILD FAILED")).toBe(true);
        });

        it("returns true for xcodebuild: error:", () => {
            expect(hasTestFailureIndicators("xcodebuild: error: something went wrong")).toBe(true);
        });

        it("returns false for clean success output", () => {
            expect(hasTestFailureIndicators("Test Suite 'All tests' passed\nExecuted 1 test")).toBe(false);
        });
    });

    describe("acquireDeviceLock", () => {
        it("acquires lock when mkdirSync succeeds and returns release callback", async () => {
            mockMkdirSync.mockImplementation(() => undefined);
            const { release } = await acquireDeviceLock("simulator-udid-123");
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
            mockReadFileSync.mockReturnValue("99999");
            process.kill = vi.fn(() => {
                throw new Error("kill ESRCH");
            }) as typeof process.kill;

            vi.useFakeTimers();
            const lockPromise = acquireDeviceLock("simulator-udid", { timeoutMs: 5000, pollIntervalMs: 100 });
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
            const lockPromise = acquireDeviceLock("simulator-udid", { timeoutMs: 500, pollIntervalMs: 100 });
            const outcome = lockPromise.then(
                () => ({ ok: true as const }),
                (e: Error) => ({ ok: false as const, error: e })
            );
            await vi.advanceTimersByTimeAsync(600);
            const result = await outcome;
            vi.useRealTimers();
            process.kill = originalKill;
            expect(result.ok).toBe(false);
            expect("error" in result && result.error instanceof Error ? result.error.message : "").toMatch(
                /Failed to acquire device lock within/
            );
        });

        it("throws on non-EEXIST mkdir error", async () => {
            mockMkdirSync.mockImplementation(() => {
                throw new Error("EACCES");
            });
            await expect(acquireDeviceLock("simulator-udid")).rejects.toThrow(/Error acquiring device lock/);
        });
    });

    describe("extractFramesFromVideo", () => {
        const promisifyKey = Symbol.for("nodejs.util.promisify.custom");

        function getExecPromisifyMock(): Mock<
            (cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>
        > {
            return (mockExec as unknown as Record<
                symbol,
                Mock<(cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>>
            >)[promisifyKey];
        }

        it("uses short-video path when duration in (0, 1) and keeps one frame", async () => {
            const execPromisify = getExecPromisifyMock();
            execPromisify.mockImplementation((cmd: string) => {
                if (cmd.includes("ffprobe")) return Promise.resolve({ stdout: "0.5", stderr: "" });
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockReaddirSync.mockReturnValue(["frame_00001.jpg", "frame_00002.jpg"] as unknown as ReturnType<
                typeof fs.readdirSync
            >);

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
            mockReaddirSync.mockReturnValue(["frame_0001.jpg", "frame_0002.jpg", "frame_0003.jpg"] as unknown as ReturnType<
                typeof fs.readdirSync
            >);

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

    describe("runIosTest", () => {
        const projectDir = "/tmp/iosApp";
        const testName = "testScrollingDownGesture";
        const simulator = { name: "iPhone 16 Pro", os: "26.1", udid: "ABC-123-DEF" };
        const promisifyKey = Symbol.for("nodejs.util.promisify.custom");

        function getPromisifyExec(): Mock<
            (cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>
        > {
            return (mockExec as unknown as Record<
                symbol,
                Mock<(cmd: string, opts?: object) => Promise<{ stdout: string; stderr: string }>>
            >)[promisifyKey];
        }

        function setupPromisifyHappyPath() {
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("simctl list devices")) {
                    return Promise.resolve({
                        stdout: `    iPhone 16 Pro (ABC-123-DEF) (Booted)`,
                        stderr: "",
                    });
                }
                if (cmd.includes("xcodebuild test")) {
                    return Promise.resolve({ stdout: "Test Suite 'All tests' passed", stderr: "" });
                }
                if (cmd.includes("xcparse") || cmd.includes("ffprobe") || cmd.includes("ffmpeg")) {
                    return Promise.resolve({ stdout: "", stderr: "" });
                }
                return Promise.resolve({ stdout: "", stderr: "" });
            });
        }

        it("throws when project directory does not exist", async () => {
            mockExistsSync.mockReturnValue(false);
            await expect(runIosTest(projectDir, testName, simulator)).rejects.toThrow(/Project directory not found/);
        });

        it("throws when simctl list devices fails", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("simctl list devices")) {
                    return Promise.reject(new Error("xcrun failed"));
                }
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            await expect(runIosTest(projectDir, testName, simulator)).rejects.toThrow(/Failed to check simulator status/);
        });

        it("boots simulator when not booted and then completes successfully", async () => {
            vi.useFakeTimers();
            mockExistsSync.mockReturnValue(true);
            let listDevicesCallCount = 0;
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("simctl list devices") && !cmd.includes("boot")) {
                    listDevicesCallCount++;
                    const notBooted = "    iPhone 16 Pro (ABC-123-DEF) (Shutdown)";
                    const booted = "    iPhone 16 Pro (ABC-123-DEF) (Booted)";
                    return Promise.resolve({
                        stdout: listDevicesCallCount === 1 ? notBooted : booted,
                        stderr: "",
                    });
                }
                if (cmd.includes("simctl boot")) {
                    return Promise.resolve({ stdout: "", stderr: "" });
                }
                if (cmd.includes("xcodebuild test")) {
                    return Promise.resolve({ stdout: "Test Suite 'All tests' passed", stderr: "" });
                }
                if (cmd.includes("xcparse") || cmd.includes("ffprobe") || cmd.includes("ffmpeg")) {
                    return Promise.resolve({ stdout: "", stderr: "" });
                }
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("results_") || pathStr.includes("frames_")) return false;
                return true;
            });
            mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

            const runPromise = runIosTest(projectDir, testName, simulator);
            await vi.advanceTimersByTimeAsync(2500);
            const result = await runPromise;

            expect(result.success).toBe(true);
            expect(result.output).toContain("Test Suite 'All tests' passed");
            expect(getPromisifyExec()).toHaveBeenCalledWith(expect.stringContaining("simctl boot"));
        });

        it("completes full happy path when simulator already booted", async () => {
            mockExistsSync.mockReturnValue(true);
            setupPromisifyHappyPath();
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("results_") || pathStr.includes("frames_")) return false;
                return true;
            });
            mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

            const result = await runIosTest(projectDir, testName, simulator);
            expect(result.success).toBe(true);
            expect(result.output).toContain("Test Suite 'All tests' passed");
        });

        it("returns success: false when xcodebuild output has failure indicators", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("simctl list devices")) {
                    return Promise.resolve({ stdout: "    iPhone 16 Pro (ABC-123-DEF) (Booted)", stderr: "" });
                }
                if (cmd.includes("xcodebuild test")) {
                    const err = Object.assign(new Error("test failed"), {
                        stdout: "Test Suite 'All tests' failed",
                        stderr: "",
                    });
                    return Promise.reject(err);
                }
                if (cmd.includes("xcparse") || cmd.includes("ffprobe") || cmd.includes("ffmpeg")) {
                    return Promise.resolve({ stdout: "", stderr: "" });
                }
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("results_") || pathStr.includes("frames_")) return false;
                return true;
            });
            mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

            const result = await runIosTest(projectDir, testName, simulator);
            expect(result.success).toBe(false);
            expect(result.output).toContain("Test Suite 'All tests' failed");
        });

        it("extracts frames from largest video when result bundle and attachments exist", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("simctl list devices")) {
                    return Promise.resolve({ stdout: "    iPhone 16 Pro (ABC-123-DEF) (Booted)", stderr: "" });
                }
                if (cmd.includes("xcodebuild test")) {
                    return Promise.resolve({ stdout: "Test Suite 'All tests' passed", stderr: "" });
                }
                if (cmd.includes("xcparse")) return Promise.resolve({ stdout: "", stderr: "" });
                if (cmd.includes("ffprobe")) return Promise.resolve({ stdout: "2.0", stderr: "" });
                if (cmd.includes("ffmpeg")) return Promise.resolve({ stdout: "", stderr: "" });
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockExistsSync.mockImplementation(() => true);
            mockReaddirSync.mockImplementation((path: fs.PathLike, _opts?: unknown) => {
                const pathStr = typeof path === "string" ? path : path.toString();
                if (pathStr.includes("results_")) {
                    return ["recording.mp4"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                if (pathStr.includes("frames_")) {
                    return ["frame_0001.jpg", "frame_0002.jpg"] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [] as unknown as ReturnType<typeof fs.readdirSync>;
            });
            mockStatSync.mockReturnValue({ size: 5000 } as ReturnType<typeof fs.statSync>);

            const result = await runIosTest(projectDir, testName, simulator);
            expect(result.success).toBe(true);
            expect(result.frameCount).toBe(2);
            expect(result.framesDir).toBeDefined();
        });

        it("returns success when test passes even if xcparse or cleanup fails", async () => {
            mockExistsSync.mockReturnValue(true);
            getPromisifyExec().mockImplementation((cmd: string) => {
                if (cmd.includes("simctl list devices")) {
                    return Promise.resolve({ stdout: "    iPhone 16 Pro (ABC-123-DEF) (Booted)", stderr: "" });
                }
                if (cmd.includes("xcodebuild test")) {
                    return Promise.resolve({ stdout: "Test Suite 'All tests' passed", stderr: "" });
                }
                if (cmd.includes("xcparse")) return Promise.reject(new Error("xcparse not found"));
                return Promise.resolve({ stdout: "", stderr: "" });
            });
            mockExistsSync.mockImplementation((p: fs.PathLike) => {
                const pathStr = typeof p === "string" ? p : p.toString();
                if (pathStr.includes("results_") || pathStr.includes("frames_")) return false;
                return true;
            });
            mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

            const result = await runIosTest(projectDir, testName, simulator);
            expect(result.success).toBe(true);
            expect(result.output).toContain("Test Suite 'All tests' passed");
        });
    });
});
