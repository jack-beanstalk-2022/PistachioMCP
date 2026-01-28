import { describe, it, expect, vi } from "vitest";
import { TaskQueue } from "../../utils/TaskQueueUtils.js";

describe("TaskQueue", () => {
    describe("Queue Initialization", () => {
        it("should create queue with specified max workers", () => {
            const queue = new TaskQueue<string, number>(5);
            expect(queue.getMaxWorkers()).toBe(5);
            expect(queue.getActiveWorkers()).toBe(0);
            expect(queue.getQueueLength()).toBe(0);
        });

        it("should create queue with default max workers of 1", () => {
            const queue = new TaskQueue<string, number>();
            expect(queue.getMaxWorkers()).toBe(1);
        });
    });

    describe("Task Enqueuing", () => {
        it("should enqueue tasks successfully", async () => {
            const queue = new TaskQueue<string, string>(2);
            const executor = vi.fn().mockResolvedValue("result");

            const promise = queue.enqueue("task1", executor);

            expect(queue.getQueueLength()).toBe(0); // Task should be picked up immediately
            expect(executor).toHaveBeenCalledWith("task1");
            expect(await promise).toBe("result");
        });

        it("should return promise that resolves with task result", async () => {
            const queue = new TaskQueue<number, number>(1);
            const executor = vi.fn().mockResolvedValue(42);

            const result = await queue.enqueue(10, executor);

            expect(result).toBe(42);
            expect(executor).toHaveBeenCalledWith(10);
        });

        it("should handle task rejection properly", async () => {
            const queue = new TaskQueue<string, string>(1);
            const error = new Error("Task failed");
            const executor = vi.fn().mockRejectedValue(error);

            await expect(queue.enqueue("task", executor)).rejects.toThrow("Task failed");
            expect(executor).toHaveBeenCalledWith("task");
        });

        it("should handle non-Error rejections", async () => {
            const queue = new TaskQueue<string, string>(1);
            const executor = vi.fn().mockRejectedValue("string error");

            await expect(queue.enqueue("task", executor)).rejects.toThrow();
        });
    });

    describe("Concurrent Execution", () => {
        it("should respect max workers limit", async () => {
            const queue = new TaskQueue<number, number>(2);
            const executor = vi.fn().mockImplementation(
                (task: number) =>
                    new Promise<number>((resolve) => setTimeout(() => resolve(task * 2), 10))
            );

            // Enqueue 5 tasks with maxWorkers of 2
            const promises = [
                queue.enqueue(1, executor),
                queue.enqueue(2, executor),
                queue.enqueue(3, executor),
                queue.enqueue(4, executor),
                queue.enqueue(5, executor),
            ];

            // Should have at most 2 active workers
            expect(queue.getActiveWorkers()).toBeLessThanOrEqual(2);

            const results = await Promise.all(promises);
            expect(results).toEqual([2, 4, 6, 8, 10]);
            expect(executor).toHaveBeenCalledTimes(5);
        });

        it("should queue additional tasks when at limit", async () => {
            const queue = new TaskQueue<number, number>(2);
            const executor = vi.fn().mockImplementation(
                (task: number) =>
                    new Promise<number>((resolve) => setTimeout(() => resolve(task), 20))
            );

            // Enqueue 4 tasks with maxWorkers of 2
            const promise1 = queue.enqueue(1, executor);
            const promise2 = queue.enqueue(2, executor);
            const promise3 = queue.enqueue(3, executor);
            const promise4 = queue.enqueue(4, executor);

            // Check immediately - first 2 should be processing
            // The queue processes synchronously, so tasks 3 and 4 will be queued
            expect(queue.getActiveWorkers()).toBe(2);
            // Wait for the first 2 tasks to finish
            await Promise.all([promise1, promise2]);
            await new Promise((resolve) => setTimeout(resolve, 5));
            // Verify that we respect the max workers limit
            expect(queue.getActiveWorkers()).toBeLessThanOrEqual(2);

            const results = await Promise.all([promise3, promise4]);
            expect(results).toEqual([3, 4]);
            expect(executor).toHaveBeenCalledTimes(4);
        });
    });

    describe("Queue Processing", () => {
        it("should process tasks in FIFO order", async () => {
            const queue = new TaskQueue<number, number>(1);
            const executionOrder: number[] = [];
            const executor = vi.fn().mockImplementation(
                (task: number) =>
                    new Promise<number>((resolve) => {
                        executionOrder.push(task);
                        setTimeout(() => resolve(task), 10);
                    })
            );

            const promises = [
                queue.enqueue(1, executor),
                queue.enqueue(2, executor),
                queue.enqueue(3, executor),
            ];

            await Promise.all(promises);

            // Should execute in order due to single worker
            expect(executionOrder).toEqual([1, 2, 3]);
        });

        it("should automatically process next task when worker completes", async () => {
            const queue = new TaskQueue<number, number>(1);
            const executor = vi.fn().mockImplementation(
                (task: number) =>
                    new Promise<number>((resolve) => setTimeout(() => resolve(task), 10))
            );

            const promises = [
                queue.enqueue(1, executor),
                queue.enqueue(2, executor),
                queue.enqueue(3, executor),
            ];

            // Wait for first task to complete
            await promises[0];
            expect(queue.getActiveWorkers()).toBe(1); // Second task should have started

            await Promise.all(promises);
            expect(executor).toHaveBeenCalledTimes(3);
        });

        it("should start processing new task after turning idle from last task", async () => {
            const queue = new TaskQueue<number, number>(1);
            const executor = vi.fn().mockImplementation(
                (task: number) =>
                    new Promise<number>((resolve) => setTimeout(() => resolve(task), 10))
            );
            const promise1 = queue.enqueue(1, executor);
            expect(queue.getActiveWorkers()).toBe(1);
            // Wait for the first task to complete
            await promise1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(queue.getActiveWorkers()).toBe(0);
            const promise2 = queue.enqueue(2, executor);
            expect(queue.getActiveWorkers()).toBe(1);
            await promise2;
            expect(executor).toHaveBeenCalledTimes(2);
        });
    });

    describe("Error Handling", () => {
        it("should reject promise when task executor throws", async () => {
            const queue = new TaskQueue<string, string>(1);
            const error = new Error("Execution failed");
            const executor = vi.fn().mockRejectedValue(error);

            await expect(queue.enqueue("task", executor)).rejects.toThrow("Execution failed");
            expect(executor).toHaveBeenCalledWith("task");
        });

        it("should continue processing after task failure", async () => {
            const queue = new TaskQueue<number, number>(1);
            const executor = vi
                .fn()
                .mockRejectedValueOnce(new Error("Task 1 failed"))
                .mockResolvedValueOnce(2);

            const promise1 = queue.enqueue(1, executor);
            const promise2 = queue.enqueue(2, executor);

            await expect(promise1).rejects.toThrow("Task 1 failed");
            expect(await promise2).toBe(2);
            expect(executor).toHaveBeenCalledTimes(2);
        });

        it("should handle promise rejections correctly", async () => {
            const queue = new TaskQueue<string, string>(2);
            const executor = vi.fn().mockRejectedValue(new Error("Rejected"));

            const promises = [
                queue.enqueue("task1", executor),
                queue.enqueue("task2", executor),
            ];

            await expect(Promise.all(promises)).rejects.toThrow();
            expect(executor).toHaveBeenCalledTimes(2);
        });

        it("should handle mixed success and failure", async () => {
            const queue = new TaskQueue<number, number>(2);
            const executor = vi
                .fn()
                .mockResolvedValueOnce(1)
                .mockRejectedValueOnce(new Error("Failed"))
                .mockResolvedValueOnce(3);

            const promise1 = queue.enqueue(1, executor);
            const promise2 = queue.enqueue(2, executor);
            const promise3 = queue.enqueue(3, executor);

            expect(await promise1).toBe(1);
            await expect(promise2).rejects.toThrow("Failed");
            expect(await promise3).toBe(3);
        });
    });

    describe("Project-Aware Execution", () => {
        interface ProjectTask {
            id: number;
            projectId?: string;
        }

        it("should execute tasks with same project_id sequentially", async () => {
            const queue = new TaskQueue<ProjectTask, number>(5);
            const executionOrder: number[] = [];
            const executor = vi.fn().mockImplementation(
                (task: ProjectTask) =>
                    new Promise<number>((resolve) => {
                        executionOrder.push(task.id);
                        setTimeout(() => resolve(task.id), 10);
                    })
            );

            const promises = [
                queue.enqueue({ id: 1, projectId: "project-a" }, executor, "project-a"),
                queue.enqueue({ id: 2, projectId: "project-a" }, executor, "project-a"),
                queue.enqueue({ id: 3, projectId: "project-a" }, executor, "project-a"),
            ];

            await Promise.all(promises);

            // All tasks from same project should execute sequentially
            expect(executionOrder).toEqual([1, 2, 3]);
            expect(executor).toHaveBeenCalledTimes(3);
        });

        it("should execute tasks with different project_ids concurrently", async () => {
            const queue = new TaskQueue<ProjectTask, number>(5);
            const executionOrder: number[] = [];
            const executor = vi.fn().mockImplementation(
                (task: ProjectTask) =>
                    new Promise<number>((resolve) => {
                        executionOrder.push(task.id);
                        setTimeout(() => resolve(task.id), 10);
                    })
            );

            const promises = [
                queue.enqueue({ id: 1, projectId: "project-a" }, executor, "project-a"),
                queue.enqueue({ id: 2, projectId: "project-b" }, executor, "project-b"),
                queue.enqueue({ id: 3, projectId: "project-c" }, executor, "project-c"),
            ];

            await Promise.all(promises);

            // Tasks from different projects should execute concurrently
            // All should start immediately (order may vary)
            expect(executionOrder.length).toBe(3);
            expect(new Set(executionOrder)).toEqual(new Set([1, 2, 3]));
            expect(executor).toHaveBeenCalledTimes(3);
        });

        it("should allow tasks without project_id to run concurrently", async () => {
            const queue = new TaskQueue<ProjectTask, number>(5);
            const executionOrder: number[] = [];
            const executor = vi.fn().mockImplementation(
                (task: ProjectTask) =>
                    new Promise<number>((resolve) => {
                        executionOrder.push(task.id);
                        setTimeout(() => resolve(task.id), 10);
                    })
            );

            const promises = [
                queue.enqueue({ id: 1, projectId: "project-a" }, executor, "project-a"),
                queue.enqueue({ id: 2 }, executor), // No project ID
                queue.enqueue({ id: 3 }, executor), // No project ID
            ];

            await Promise.all(promises);

            // Task 1 should start, tasks 2 and 3 (no project) should also start concurrently
            expect(executionOrder.length).toBe(3);
            expect(new Set(executionOrder)).toEqual(new Set([1, 2, 3]));
            expect(executor).toHaveBeenCalledTimes(3);
        });

        it("should allow tasks without project_id to run concurrently with project tasks", async () => {
            const queue = new TaskQueue<ProjectTask, number>(5);
            const executionOrder: number[] = [];
            const executor = vi.fn().mockImplementation(
                (task: ProjectTask) =>
                    new Promise<number>((resolve) => {
                        executionOrder.push(task.id);
                        setTimeout(() => resolve(task.id), 10);
                    })
            );

            const promises = [
                queue.enqueue({ id: 1, projectId: "project-a" }, executor, "project-a"),
                queue.enqueue({ id: 2, projectId: "project-a" }, executor, "project-a"), // Same project, waits
                queue.enqueue({ id: 3 }, executor), // No project, can run immediately
            ];

            await Promise.all(promises);

            // Task 1 starts, task 3 (no project) starts immediately, task 2 waits for task 1
            expect(executionOrder.length).toBe(3);
            // Task 3 should be in the first 2 to execute (along with task 1)
            const firstTwo = executionOrder.slice(0, 2);
            expect(firstTwo).toContain(1);
            expect(firstTwo).toContain(3);
            expect(executionOrder[2]).toBe(2); // Task 2 should be last
            expect(executor).toHaveBeenCalledTimes(3);
        });

        it("should track active tasks per project correctly", async () => {
            const queue = new TaskQueue<ProjectTask, number>(5);
            const executor = vi.fn().mockImplementation(
                (task: ProjectTask) =>
                    new Promise<number>((resolve) => setTimeout(() => resolve(task.id), 20))
            );

            const promise1 = queue.enqueue({ id: 1, projectId: "project-a" }, executor, "project-a");
            await new Promise((resolve) => setTimeout(resolve, 5));

            const activeByProject = queue.getActiveTasksByProject();
            expect(activeByProject.get("project-a")).toBe(1);
            expect(activeByProject.size).toBe(1);

            await promise1;
            await new Promise((resolve) => setTimeout(resolve, 5));

            const activeByProjectAfter = queue.getActiveTasksByProject();
            expect(activeByProjectAfter.get("project-a")).toBeUndefined();
            expect(activeByProjectAfter.size).toBe(0);
        });

        it("should allow different project tasks to jump queue", async () => {
            const queue = new TaskQueue<ProjectTask, number>(5);
            const executionOrder: number[] = [];
            const executor = vi.fn().mockImplementation(
                (task: ProjectTask) =>
                    new Promise<number>((resolve) => {
                        executionOrder.push(task.id);
                        setTimeout(() => resolve(task.id), 30);
                    })
            );

            // Enqueue 3 tasks from project-a, then 1 from project-b
            const promise1 = queue.enqueue({ id: 1, projectId: "project-a" }, executor, "project-a");
            const promise2 = queue.enqueue({ id: 2, projectId: "project-a" }, executor, "project-a");
            const promise3 = queue.enqueue({ id: 3, projectId: "project-a" }, executor, "project-a");
            const promise4 = queue.enqueue({ id: 4, projectId: "project-b" }, executor, "project-b");

            await new Promise((resolve) => setTimeout(resolve, 5));

            // Task 1 (project-a) should start immediately
            // Task 4 (project-b) should also start immediately (jumps queue)
            // Tasks 2 and 3 (project-a) should wait
            expect(executionOrder).toContain(1);
            expect(executionOrder).toContain(4);
            expect(executionOrder.length).toBe(2);

            await Promise.all([promise1, promise2, promise3, promise4]);

            // Task 1 completes, then task 2 can start
            // Task 4 completes independently
            // Task 3 starts after task 2
            expect(executionOrder.length).toBe(4);
            expect(executionOrder[0]).toBe(1); // First task from project-a
            expect(executionOrder[1]).toBe(4); // project-b task jumps ahead
            expect(executionOrder[2]).toBe(2); // Second task from project-a
            expect(executionOrder[3]).toBe(3); // Third task from project-a
        });

        it("should handle multiple tasks without project_id concurrently", async () => {
            const queue = new TaskQueue<ProjectTask, number>(5);
            const executionOrder: number[] = [];
            const executor = vi.fn().mockImplementation(
                (task: ProjectTask) =>
                    new Promise<number>((resolve) => {
                        executionOrder.push(task.id);
                        setTimeout(() => resolve(task.id), 10);
                    })
            );

            const promises = [
                queue.enqueue({ id: 1 }, executor),
                queue.enqueue({ id: 2 }, executor),
                queue.enqueue({ id: 3 }, executor),
            ];

            await Promise.all(promises);

            // All tasks without project ID should execute concurrently
            expect(executionOrder.length).toBe(3);
            expect(new Set(executionOrder)).toEqual(new Set([1, 2, 3]));
            expect(executor).toHaveBeenCalledTimes(3);
        });

        it("should work correctly without project ID (backward compatibility)", async () => {
            const queue = new TaskQueue<number, number>(2);
            const executor = vi.fn().mockImplementation(
                (task: number) =>
                    new Promise<number>((resolve) => setTimeout(() => resolve(task), 10))
            );

            const promises = [
                queue.enqueue(1, executor),
                queue.enqueue(2, executor),
                queue.enqueue(3, executor),
            ];

            const results = await Promise.all(promises);
            expect(results).toEqual([1, 2, 3]);
            expect(executor).toHaveBeenCalledTimes(3);
            expect(queue.getActiveTasksByProject().size).toBe(0);
        });
    });
});
