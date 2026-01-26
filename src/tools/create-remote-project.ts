import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";
import { createMCPProject } from "../utils/ServerStorageUtils";

const execAsync = promisify(exec);

/**
 * Tool for creating a new Pistachio project by cloning the KMP App Template
 */
export const createRemoteProjectTool = {
    name: "create-remote-project",
    description: "Create a new project",
    inputSchema: z.object({
        project_name: z
            .string()
            .describe("Name of the project to create"),
    }),
    handler: async (args: { project_name: string }) => {
        const { project_name } = args;

        try {
            // First, create an entry in Firebase mcpProjects collection
            const projectId = await createMCPProject(project_name);

            const documentsPath = join(homedir(), "Documents");
            const cloneUrl = "https://github.com/jack-beanstalk-2022/PistachioTemplate.git";

            // Execute git clone command
            const { stderr } = await execAsync(
                `git clone ${cloneUrl} ${projectId}`,
                {
                    cwd: documentsPath,
                }
            );

            if (stderr && !stderr.includes("Cloning into")) {
                // Git often outputs to stderr even on success, but we check for actual errors
                return {
                    output: `Project created successfully.Project ID: ${projectId}\n${stderr}`,
                    success: true,
                };
            }

            return {
                output: `Project created successfully. Project ID: ${projectId}`,
                success: true,
            };
        } catch (error) {
            return {
                output:
                    error instanceof Error
                        ? error.message
                        : "Failed to create project",
                success: false,
            };
        }
    },
};
