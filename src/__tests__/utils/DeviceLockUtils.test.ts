import { describe, it, expect } from "vitest";
import { withDeviceLock } from "../../utils/DeviceLockUtils.js";

describe("DeviceLockUtils", () => {
    it("should execute actions sequentially for the same serial", async () => {
        const serial = "emulator-5554";
        const executionOrder: number[] = [];

        const action1 = async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            executionOrder.push(1);
            return "result1";
        };

        const action2 = () => {
            executionOrder.push(2);
            return Promise.resolve("result2");
        };

        // Start both actions
        const p1 = withDeviceLock(serial, action1);
        const p2 = withDeviceLock(serial, action2);

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toBe("result1");
        expect(r2).toBe("result2");
        expect(executionOrder).toEqual([1, 2]);
    });

    it("should execute actions concurrently for different serials", async () => {
        const serial1 = "emulator-5554";
        const serial2 = "emulator-5556";
        const executionOrder: number[] = [];

        const action1 = async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            executionOrder.push(1);
            return "result1";
        };

        const action2 = () => {
            executionOrder.push(2);
            return Promise.resolve("result2");
        };

        // Start both actions for different serials
        const p1 = withDeviceLock(serial1, action1);
        const p2 = withDeviceLock(serial2, action2);

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toBe("result1");
        expect(r2).toBe("result2");
        // Since action2 has no delay and they are on different serials, 
        // action2 should finish before action1 finishes its timeout
        expect(executionOrder).toEqual([2, 1]);
    });

    it("should handle errors in actions and continue with next in queue", async () => {
        const serial = "emulator-5554";

        const action1 = () => {
            return Promise.reject(new Error("Action 1 failed"));
        };

        const action2 = () => {
            return Promise.resolve("result2");
        };

        const p1 = withDeviceLock(serial, action1);
        const p2 = withDeviceLock(serial, action2);

        await expect(p1).rejects.toThrow("Action 1 failed");
        expect(await p2).toBe("result2");
    });
});
