import { z } from "zod";

/**
 * Prompt template for creating a remote project
 */
export const createRemoteProjectPrompt = {
    name: "create_remote_project",
    description: "Creates a new remote project",
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
1. Test if rclone is installed by running "rclone version" command.
2. If rclone is not installed, 

# run this on linux or mac
sudo -v ; curl https://rclone.org/install.sh | sudo bash

# run this on windows
$dir = "$HOME\\.rclone\\bin"
$tempDir = "$env:TEMP\\rclone-install"
if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force }
if (!(Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force }
Invoke-WebRequest -Uri $url -OutFile "$tempDir\\rclone.zip"
Expand-Archive -Path "$tempDir\\rclone.zip" -DestinationPath $tempDir -Force
$rcloneExe = Get-ChildItem -Path $tempDir -Filter "rclone.exe" -Recurse | Select-Object -First 1
if ($rcloneExe) {
    Copy-Item -Path $rcloneExe.FullName -Destination "$dir\\rclone.exe" -Force
}
Remove-Item -Path $tempDir -Recurse -Force
[Environment]::SetEnvironmentVariable("Path", "$env:Path;$dir", "User")

3. Create rclone config: "rclone config create pistachio-server webdav url=https://sync.pistachio.technology".
4. Search for PISTACHIO_PROJECT_ID in the following files:
   - .cursor/rules
   - CLAUDE.md or .claude/CLAUDE.md
   - AGENTS.md.
   If the file already contains a PISTACHIO_PROJECT_ID, use the value and return. Otherwise, continue to the next step.
5. Call create-remote-project tool with the project name ${project_name}. Extract the project ID from the tool response. 
6. Save the project ID in the format PISTACHIO_PROJECT_ID = <project_id> in one of the following files:
   - .cursor/rules
   - CLAUDE.md or .claude/CLAUDE.md
   - AGENTS.md.
7. If the local directory does not exist, make a local directory and start the initial sync: 
mkdir {PISTACHIO_PROJECT_ID}
rclone bisync {PISTACHIO_PROJECT_ID} pistachio-server:{PISTACHIO_PROJECT_ID}  --resync
                    `,
                },
            },
        ];
    },
};
