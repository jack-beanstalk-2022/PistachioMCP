import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";

const execAsync = promisify(exec);

/**
 * Tool for running kdoctor on a remote project
 */
export const remoteKdoctorTool = {
    name: "remote_kdoctor",
    description: "Run kdoctor on a remote project and return the output",
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

            // Execute kdoctor command in the project directory
            const { stdout, stderr } = await execAsync("kdoctor", {
                cwd: projectPath,
            });

            // Combine stdout and stderr for complete output
            const output = stdout + (stderr ? `\n${stderr}` : "");

            return {
                output: output.trim() || "kdoctor completed with no output",
                success: true,
            };
        } catch (error) {
            // If the command fails, return the error message
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            // Check if it's a command not found error
            if (errorMessage.includes("kdoctor") || errorMessage.includes("command not found")) {
                return {
                    output: `Error: kdoctor command not found. Please ensure kdoctor is installed and available in PATH.`,
                    success: false,
                };
            }

            // Check if project directory doesn't exist
            if (errorMessage.includes("ENOENT") || errorMessage.includes("no such file")) {
                return {
                    output: `Error: Project directory not found for project_id: ${project_id}. Please verify the project exists.`,
                    success: false,
                };
            }

            return {
                output: `Error running kdoctor: ${errorMessage}`,
                success: false,
            };
        }
    },
};
