import { z } from "zod";

/**
 * Prompt template for creating a pistachio project
 */
export const createPistachioProjectPrompt = {
    name: "create_pistachio_project",
    description: "Creates a new pistachio project",
    arguments: z.object({
        project_name: z.string().describe("The name of the project to create"),
    }),
    handler: (args: { project_name: string }) => {
        const { project_name } = args;
        return [
            {
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: `
Follow these steps to set up a Pistachio project:
1. Search for PISTACHIO_PROJECT_ID in the following files:
   - .cursor/rules
   - CLAUDE.md or .claude/CLAUDE.md
   - AGENTS.md.
   If the file already contains a PISTACHIO_PROJECT_ID, use the value and return. Otherwise, continue to the next step.
2. Call create-remote-project tool with the project name ${project_name}. Extract the project ID from the tool response. 
3. Save the project ID in the format PISTACHIO_PROJECT_ID = <project_id> in one of the following files:
   - .cursor/rules
   - CLAUDE.md or .claude/CLAUDE.md
   - AGENTS.md.
                    `,
                },
            },
        ];
    },
};
