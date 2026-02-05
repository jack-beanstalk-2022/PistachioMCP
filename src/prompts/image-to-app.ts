import { z } from "zod";

/**
 * Prompt template for building an app from screenshots (image-to-app pipeline).
 * Takes a screenshots directory and instructs the AI to run the planner, then
 * component replicators, then screen replicators, then the screen stitcher.
 */
export const imageToAppPrompt = {
    name: "image_to_app",
    description:
        "Build a mobile app from a folder of screenshots",
    arguments: z.object({
        screenshots_directory: z
            .string()
            .describe(
                "Absolute path to the directory containing the app screenshots to replicate"
            ),
    }),
    handler: (args: { screenshots_directory: string }) => {
        const { screenshots_directory } = args;
        return [
            {
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: `
Follow these steps:
1. Check if PISTACHIO_PROJECT_NAME is set, and there is a project under that name in the current working directory. If not, abort and ask user to run /check-local-project.
2. Spawn a *@image-to-app-planner* agent to analyze the screenshots in \`${screenshots_directory}\`. Wait for the planner to finish.
3. After planner is done, for each component.md file in project_dir/components/, spawn a *@image-to-component-replicator* agent to build the component. Run at most 3 agents in parallel. Wait for all components to be built.
4. After all components are built, for each screen.md file in project_dir/screens/, spawn a *@image-to-screen-replicator* agent to build the screen. Run at most 3 agents in parallel. Wait for all screens to be built.
5. Ater all screens are built, spawn a *@screen-stitcher* agent to stitch the screens into a mobile app. Wait for the stitcher to finish.
6. Analyze the app created, identify visual fidelity and consistency issues. Fix any obvious issues.
7. Identify missing target for CTAs and buttons. Show these missing targets to the user and ask for next steps.
`,
                },
            },
        ];
    },
};
