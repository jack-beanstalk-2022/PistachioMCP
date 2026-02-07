import { z } from "zod";

/**
 * Prompt template for checking a local project
 */
export const checkLocalProjectPrompt = {
  name: "check_local_project",
  description: "Checks local project directory and installs dependencies if needed",
  arguments: z.object({
    project_name: z.string().describe("The name of the project to create"),
    package_name: z.string().describe("The package name of the project, e.g. com.company.myapp"),
  }),
  handler: (args: { project_name: string; package_name: string }) => {
    const { project_name, package_name } = args;

    return [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `
Follow these steps:
1. Check the variables:
   - Search for PISTACHIO_PROJECT_NAME and PISTACHIO_PACKAGE_NAME in the following files:
     - CLAUDE.md or .claude/CLAUDE.md for claude code client
     - .opencode/AGENTS.md for open code client
   If the file already contains a PISTACHIO_PROJECT_NAME and PISTACHIO_PACKAGE_NAME, use that value and return. Otherwise, save two lines: PISTACHIO_PROJECT_NAME=${project_name} \n PISTACHIO_PACKAGE_NAME=${package_name}.

2. Install Pistachio SKILLs and AGENTs:
   - Download the installer:
     - on windows: "curl -fsSL -o install-pistachio.bat https://pistachio-ai.com/install-pistachio.bat"
     - on macOS / linux: "curl -fsSL -o install-pistachio.sh https://pistachio-ai.com/install-pistachio.sh"
   - Run the installer to sync SKILLs and AGENTs into the project: "install-pistachio.bat .claude" or "install-pistachio.sh .claude"

3. Invoke newly installed setup-project skill.

IMPORTANT NOTES:
- If any installation step fails, provide clear error messages and suggest troubleshooting steps.
- For environment variables, ensure they persist across terminal sessions by adding them to shell configuration files.
- On macOS, you may need to restart the terminal or run "source ~/.zshrc" (or "source ~/.bash_profile") after setting environment variables.
- On Windows, you may need to restart the terminal or restart the computer after setting environment variables.
                    `,
        },
      },
    ];
  },
};
