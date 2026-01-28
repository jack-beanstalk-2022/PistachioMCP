/**
 * Internal task structure for queue management
 */
interface QueuedTask<T, R> {
    task: T;
    executor: (task: T) => Promise<R>;
    resolve: (value: R) => void;
    reject: (error: Error) => void;
    projectId?: string;
}

/**
 * Generic task queue that processes tasks concurrently with a configurable worker limit.
 * Tasks are processed in FIFO order, with up to `maxWorkers` tasks executing simultaneously.
 * When a projectId is provided, only one task per project executes at a time.
 */
export class TaskQueue<T, R> {
    private queue: QueuedTask<T, R>[] = [];
    private activeWorkers = 0;
    private activeTasksByProject = new Map<string, number>();

    /**
     * Creates a new TaskQueue instance.
     * @param maxWorkers Maximum number of concurrent tasks to process (default: 1)
     */
    constructor(private readonly maxWorkers: number = 1) {
        if (maxWorkers < 1) {
            throw new Error("maxWorkers must be at least 1");
        }
    }

    /**
     * Enqueues a task for execution and returns a promise that resolves with the result.
     * @param task The task to execute
     * @param executor Function that executes the task and returns a promise
     * @param projectId Optional project ID. If provided, only one task per project executes at a time.
     * @returns Promise that resolves with the task result or rejects with an error
     */
    enqueue(task: T, executor: (task: T) => Promise<R>, projectId?: string): Promise<R> {
        return new Promise<R>((resolve, reject) => {
            this.queue.push({
                task,
                executor,
                resolve,
                reject,
                projectId,
            });

            // Trigger queue processing
            this.processQueue();
        });
    }

    /**
     * Processes the queue by spawning workers up to maxWorkers limit.
     * This method is called automatically when tasks are enqueued.
     * Tasks are processed in FIFO order, but tasks can start if their project has no active tasks.
     */
    private processQueue(): void {
        // Don't spawn more workers if we're at the limit or queue is empty
        while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
            // Find the first task that can be executed
            // - Tasks without projectId can always run (if we have capacity)
            // - Tasks with projectId can run only if that project has 0 active tasks
            let taskIndex = -1;
            for (let i = 0; i < this.queue.length; i++) {
                const task = this.queue[i];
                if (!task.projectId) {
                    // Task without project ID can run immediately
                    taskIndex = i;
                    break;
                } else {
                    // Task with project ID can run only if project has no active tasks
                    const activeCount = this.activeTasksByProject.get(task.projectId) ?? 0;
                    if (activeCount === 0) {
                        taskIndex = i;
                        break;
                    }
                }
            }

            // If no task can be executed, break (they're all waiting for their projects)
            if (taskIndex === -1) {
                break;
            }

            const queuedTask = this.queue.splice(taskIndex, 1)[0];
            if (!queuedTask) {
                break;
            }

            this.activeWorkers++;

            // If task has a project ID, increment the active count for that project
            if (queuedTask.projectId) {
                const currentCount = this.activeTasksByProject.get(queuedTask.projectId) ?? 0;
                this.activeTasksByProject.set(queuedTask.projectId, currentCount + 1);
            }

            // Execute the task asynchronously
            queuedTask
                .executor(queuedTask.task)
                .then((result) => {
                    queuedTask.resolve(result);
                })
                .catch((error) => {
                    queuedTask.reject(error instanceof Error ? error : new Error(String(error)));
                })
                .finally(() => {
                    this.activeWorkers--;

                    // If task has a project ID, decrement the active count for that project
                    if (queuedTask.projectId) {
                        const currentCount = this.activeTasksByProject.get(queuedTask.projectId) ?? 0;
                        if (currentCount <= 1) {
                            this.activeTasksByProject.delete(queuedTask.projectId);
                        } else {
                            this.activeTasksByProject.set(queuedTask.projectId, currentCount - 1);
                        }
                    }

                    // Process next item in queue
                    this.processQueue();
                });
        }
    }

    /**
     * Gets the number of pending tasks in the queue.
     */
    getQueueLength(): number {
        return this.queue.length;
    }

    /**
     * Gets the number of currently active workers.
     */
    getActiveWorkers(): number {
        return this.activeWorkers;
    }

    /**
     * Gets the maximum number of concurrent workers.
     */
    getMaxWorkers(): number {
        return this.maxWorkers;
    }

    /**
     * Gets a map of active tasks per project.
     * @returns Map where keys are project IDs and values are the number of active tasks for that project.
     */
    getActiveTasksByProject(): Map<string, number> {
        return new Map(this.activeTasksByProject);
    }
}
