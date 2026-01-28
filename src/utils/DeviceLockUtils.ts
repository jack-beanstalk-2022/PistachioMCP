/**
 * Map to track lock status for each device serial.
 * true means the device is currently locked.
 */
const locks: Map<string, boolean> = new Map();

/**
 * Executes an action with a lock on the specified device serial.
 * Only one action can be executed at a time for a given serial.
 * This implementation uses polling to wait for the lock to become available.
 * 
 * @param serial The device serial (e.g., "emulator-5554")
 * @param action The async action to perform
 * @returns The result of the action
 */
export async function withDeviceLock<R>(serial: string, action: () => Promise<R>): Promise<R> {
    // Poll until the lock is free
    while (locks.get(serial)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Acquire the lock
    locks.set(serial, true);

    try {
        return await action();
    } finally {
        // Release the lock
        locks.set(serial, false);
    }
}
