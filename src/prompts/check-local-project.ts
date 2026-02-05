import { z } from "zod";

/**
 * Prompt template for checking a local project
 */
export const checkLocalProjectPrompt = {
  name: "check_local_project",
  description: "Checks local project directory and installs dependencies if needed",
  arguments: z.object({
    project_name: z.string().describe("The name of the project to create"),
  }),
  handler: (args: { project_name: string; }) => {
    const { project_name } = args;
    const repoUrl = "https://github.com/jack-beanstalk-2022/PistachioTemplate.git";

    return [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `
Follow these steps to set up a local project:

1. Install Git:
   - Check if git is installed: "git --version"
   - If git is not installed:
     * On macOS: 
       - If Homebrew is not installed, install it first:
         /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
         - Follow the on-screen instructions to complete the installation
         - Add Homebrew to your PATH (if prompted): 
           echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
           eval "$(/opt/homebrew/bin/brew shellenv)"
       - Once Homebrew is installed: "brew install git"
       - Or download from https://git-scm.com/download/mac
     * On Linux: Use your package manager (e.g., "sudo apt-get install git" for Ubuntu/Debian, "sudo yum install git" for RHEL/CentOS)
     * On Windows: Download and install from https://git-scm.com/download/win
   - Verify installation: "git --version"

2. Install Java Development Kit (JDK):
   - Check if Java is installed: "java -version"
   - Check if JAVA_HOME is set: "echo $JAVA_HOME" (macOS/Linux) or "echo %JAVA_HOME%" (Windows)
   - If Java is not installed or JAVA_HOME is not set:
     * On macOS: "brew install openjdk@21" and set JAVA_HOME:
       export JAVA_HOME=$(/usr/libexec/java_home -v 21)
       echo 'export JAVA_HOME=$(/usr/libexec/java_home -v 21)' >> ~/.zshrc (or ~/.bash_profile)
     * On Linux: Install OpenJDK 21 or later:
       sudo apt-get update && sudo apt-get install openjdk-21-jdk (Ubuntu/Debian)
       sudo yum install java-21-openjdk-devel (RHEL/CentOS)
       Set JAVA_HOME: export JAVA_HOME=/usr/lib/jvm/java-21-openjdk (adjust path as needed)
     * On Windows: Download and install JDK 21 or later from https://adoptium.net/ or Oracle, then set JAVA_HOME environment variable
   - Verify installation: "java -version" and "echo $JAVA_HOME" (or "echo %JAVA_HOME%" on Windows)

3. Install Android Studio and Android SDK:
   - Check if Android SDK is properly configured:
     * Check if ANDROID_HOME environment variable is set: "echo $ANDROID_HOME" (macOS/Linux) or "echo %ANDROID_HOME%" (Windows)
     * Check if adb command is available: "adb version"
     * Check if Android Studio app exists:
       - On macOS: Check if "/Applications/Android Studio.app" exists: ls -d "/Applications/Android Studio.app"
       - On Linux: Check common installation paths like "/opt/android-studio" or "$HOME/android-studio"
       - On Windows: Check if Android Studio is in Program Files: "dir "C:\\Program Files\\Android\\Android Studio"" or check registry
   - If Android Studio is not installed:
     * Download from https://developer.android.com/studio
     * Install Android Studio following the installation wizard
     * During setup, ensure Android SDK, Android SDK Platform, and Android Virtual Device (AVD) are installed
   - Set ANDROID_HOME environment variable:
     * On macOS/Linux: 
       export ANDROID_HOME=$HOME/Library/Android/sdk (macOS) or $HOME/Android/Sdk (Linux)
       export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools
       Add these to ~/.zshrc or ~/.bash_profile
     * On Windows: Set ANDROID_HOME to C:\\Users\\YourUsername\\AppData\\Local\\Android\\Sdk and add to PATH
   - Verify installation: "echo $ANDROID_HOME" (or "echo %ANDROID_HOME%" on Windows) and "adb version"
   - Install required Android SDK components:
     * Open Android Studio and go to Tools > SDK Manager
     * Install Android SDK Platform-Tools, Android SDK Build-Tools, and at least one Android SDK Platform

4. Install node and tsx:
   - Check if node is installed: "node --version"
   - If node is not installed:
     * Install node from https://nodejs.org/en/download/
   - Check if tsx is installed: "tsx --version"
   - If tsx is not installed:
     * Install tsx: "npm install -g tsx"

5. Install Xcode (macOS only):
   - Check if Xcode is installed: "xcode-select -p" or check if "/Applications/Xcode.app" exists
   - If Xcode is not installed:
     * Install from Mac App Store: "open -a 'App Store'"
     * Search for "Xcode" and install
     * Or download from https://developer.apple.com/xcode/
   - Accept Xcode license: "sudo xcodebuild -license accept"
   - Install Xcode Command Line Tools: "xcode-select --install"
   - Verify installation: "xcodebuild -version" and "xcode-select -p"

6. Install xcparse (macOS only):
   - Check if xcparse is installed: "xcparse version"
   - If xcparse is not installed:
     * Install xcparse: "brew install chargepoint/xcparse/xcparse"
   - Verify installation: "xcparse version"

7. Check the project repository:
   - Search for PISTACHIO_PROJECT_NAME in the following files:
     - .cursor/rules
     - CLAUDE.md or .claude/CLAUDE.md
     - .opencode/AGENTS.md
   If the file already contains a PISTACHIO_PROJECT_NAME, use that value and return. Otherwise, save a line PISTACHIO_PROJECT_NAME=${project_name}. 
   - Check if the project repository exists: "ls -la ${project_name}". If yes, return.
   - Otherwise, clone the repository: "git clone ${repoUrl} ${project_name}".

8. Install project dependencies:
   - Navigate into the project directory: "cd ${project_name}"
  - Check if the project uses Gradle wrapper: Look for "gradlew" or "gradlew.bat" in the project root
   - If using Gradle wrapper, make it executable (macOS/Linux): "chmod +x gradlew"
   - Install dependencies and sync project:
     * Run: "./gradlew assembleDebug" (macOS/Linux) or "gradlew.bat assembleDebug" (Windows)
     * This will download all required dependencies.

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
