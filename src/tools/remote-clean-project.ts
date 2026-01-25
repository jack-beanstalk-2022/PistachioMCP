import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";

const execAsync = promisify(exec);

/**
 * Tool for running gradlew clean on a remote project
 */
export const remoteCleanProjectTool = {
    name: "remote_clean_project",
    description: "Run ./gradlew clean on a remote project and return the output",
    inputSchema: z.object({
        project_id: z
            .string()
            .describe("The ID of the project"),
    }),
    handler: async (args: { project_id: string }) => {
        const { project_id } = args;

        try {
            const documentsPath = join(homedir(), "Documents");
            const projectPath = join(documentsPath, project_id);

            // Execute ./gradlew clean command in the project directory
            const { stdout, stderr } = await execAsync("./gradlew clean", {
                cwd: projectPath,
            });

            // Combine stdout and stderr for complete output
            const output = stdout + (stderr ? `\n${stderr}` : "");

            return {
                output: output.trim() || "gradlew clean completed with no output",
                success: true,
            };
        } catch (error) {
            // If the command fails, return the error message
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            // Check if project directory doesn't exist
            if (errorMessage.includes("ENOENT") || errorMessage.includes("no such file")) {
                return {
                    output: `Error: Project directory not found for project_id: ${project_id}. Please verify the project exists.`,
                    success: false,
                };
            }

            // Check if gradlew doesn't exist
            if (errorMessage.includes("gradlew") || errorMessage.includes("ENOENT")) {
                return {
                    output: `Error: gradlew not found in project directory. Please ensure this is a Gradle project.`,
                    success: false,
                };
            }

            return {
                output: `Error running gradlew clean: ${errorMessage}`,
                success: false,
            };
        }
    },
};
