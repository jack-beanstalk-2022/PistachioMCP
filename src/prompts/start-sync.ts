/**
 * Prompt template for starting a mutagen sync session
 */
export const startSyncPrompt = {
    name: "start_sync",
    description: "Starts a sync session for the pistachio project",
    handler: () => {
        return [
            {
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: `
Follow these steps to start a mutagen sync session:
0. If you don't have PISTACHIO_PROJECT_ID already, ask user to run /create-pistachio-project and abort.
1. Check if mutagen is installed by running "mutagen version" command.
2. If mutagen is not installed,
# run this on linux
"uname -m" to get the architecture
URL="https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz" OR URL="https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_arm64_v0.18.1.tar.gz"
mkdir - p ~/.local/bin
curl - L $URL | tar xz - C ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"
echo "Mutagen installed to ~/.local/bin. Add this to your .zshrc or .bashrc if needed."

# run this on mac
"uname -m" to get the architecture
URL="https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_darwin_amd64_v0.18.1.tar.gz" OR URL="https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_darwin_arm64_v0.18.1.tar.gz"
mkdir - p ~/.local/bin
curl - L $URL | tar xz - C ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"
echo "Mutagen installed to ~/.local/bin. Add this to your .zshrc or .bashrc if needed."

# run this on windows
$url="https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_windows_amd64_v0.18.1.zip"
dir = "$HOME\\.mutagen\\bin"
if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir }
Invoke-WebRequest -Uri $url -OutFile "$dir\\mutagen.zip"
Expand-Archive -Path "$dir\\mutagen.zip" -DestinationPath $dir -Force
Remove-Item "$dir\\mutagen.zip"
[Environment]::SetEnvironmentVariable("Path", "$env:Path;$dir", "User")
Write-Host "Mutagen installed to $dir. Please restart your terminal." -ForegroundColor Green

3. Once mutagen is installed, first check if there is already a sync session with the name "pistachio-sync" by running "mutagen sync list"
If there is, kill it by "mutagen sync terminate pistachio-sync"

4. Create a new sync session:
mutagen sync create --name="pistachio-sync" ./{PISTACHIO_PROJECT_ID} ~/Documents/{PISTACHIO_PROJECT_ID}
                    `,
                },
            },
        ];
    },
};
