#!/bin/bash

# Exit on error
set -e

# Help message
if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    echo "Usage: $0 <ProjectName> <PackageName>"
    echo "Example: $0 MyAwesomeApp com.example.awesome"
    exit 0
fi

PROJECT_NAME=$1
PACKAGE_NAME=$2

if [ -z "$PROJECT_NAME" ] || [ -z "$PACKAGE_NAME" ]; then
    echo "Error: Project Name and Package Name are required."
    echo "Usage: $0 <ProjectName> <PackageName>"
    echo "Example: $0 MyAwesomeApp com.example.awesome"
    exit 1
fi

write_step() {
    echo -e "\n=== $1 ==="
}

check_command() {
    command -v "$1" >/dev/null 2>&1
}

# Check that java is actually usable (macOS has a stub that prints "Unable to locate a Java Runtime")
check_java_usable() {
    command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1
}

# --- Persistence: which file to write to (decided once at top) ---
get_shell_rc_file() {
    local rc_file=""
    if [ -n "$ZSH_VERSION" ] || [ "${SHELL#*zsh}" != "$SHELL" ]; then
        rc_file="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ] || [ "${SHELL#*bash}" != "$SHELL" ]; then
        [ -f "$HOME/.bash_profile" ] && rc_file="$HOME/.bash_profile" || rc_file="$HOME/.bashrc"
    else
        [ -f "$HOME/.zshrc" ] && rc_file="$HOME/.zshrc"
        [ -z "$rc_file" ] && [ -f "$HOME/.bash_profile" ] && rc_file="$HOME/.bash_profile"
        [ -z "$rc_file" ] && rc_file="$HOME/.bashrc"
    fi
    if [ ! -f "$rc_file" ]; then
        rc_file="$HOME/.zshrc"
        [ -f "$HOME/.bash_profile" ] && rc_file="$HOME/.bash_profile"
        [ -f "$HOME/.bashrc" ] && rc_file="$HOME/.bashrc"
    fi
    echo "$rc_file"
}
PERSIST_RC_FILE=$(get_shell_rc_file)

# Append lines to PERSIST_RC_FILE if marker not already present.
# Usage: persist_to_rc "marker line" "line1" "line2" ...
persist_to_rc() {
    [ -n "$PERSIST_ENV_SKIP" ] && return 0
    local marker="$1"
    shift
    local lines=("$@")
    [ ${#lines[@]} -eq 0 ] && return 0
    if grep -q "$marker" "$PERSIST_RC_FILE" 2>/dev/null; then
        echo "Already persisted to $PERSIST_RC_FILE ($marker). Skipping."
        return 0
    fi
    {
        echo ""
        echo "# $marker"
        printf '%s\n' "${lines[@]}"
    } >> "$PERSIST_RC_FILE"
    echo "Appended to $PERSIST_RC_FILE. Run 'source $PERSIST_RC_FILE' or open a new terminal to use them."
}

# 0. Check for Homebrew on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    write_step "Checking Homebrew"
    if ! check_command "brew"; then
        echo "Homebrew not found. Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to path for the current session
        if [ -d "/opt/homebrew/bin" ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -d "/usr/local/bin" ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    else
        echo "Homebrew is already installed."
    fi
fi

# 1. Install Git
write_step "Checking Git"
if ! check_command "git"; then
    echo "Git not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install git
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update && sudo apt-get install -y git
    else
        echo "Please install Git and restart the script."
        exit 1
    fi
fi
git --version

# 2. Install JDK
write_step "Checking JDK"
JAVA_INSTALLED_BY_SCRIPT=
if ! check_java_usable || [ -z "$JAVA_HOME" ]; then
    echo "Java or JAVA_HOME not found. Installing OpenJDK 21..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install openjdk@21
        # Try to find the Homebrew installation path
        BREW_JAVA_PATH="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
        if [ ! -d "$BREW_JAVA_PATH" ]; then
            # Fallback for Intel Macs
            BREW_JAVA_PATH="/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
        fi
        
        if [ -d "$BREW_JAVA_PATH" ]; then
            export JAVA_HOME="$BREW_JAVA_PATH"
        else
            # Last resort fallback to standard utility
            export JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || echo "")
        fi
        
        # Add to PATH so 'java' command works even if not linked
        export PATH="$JAVA_HOME/bin:$PATH"
        JAVA_INSTALLED_BY_SCRIPT=1
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update && sudo apt-get install -y openjdk-21-jdk
        # Common path for Ubuntu/Debian
        for dir in /usr/lib/jvm/java-21-openjdk-*; do
            if [ -d "$dir" ]; then
                export JAVA_HOME="$dir"
                break
            fi
        done
        echo "Set JAVA_HOME to $JAVA_HOME (please verify if correct)"
        JAVA_INSTALLED_BY_SCRIPT=1
    else
        echo "Please install OpenJDK 21 and set JAVA_HOME."
        exit 1
    fi
fi
java -version
echo "JAVA_HOME: $JAVA_HOME"
if [ -n "$JAVA_INSTALLED_BY_SCRIPT" ] && [ -n "$JAVA_HOME" ]; then
    persist_to_rc "Added by setup-project.sh - JAVA_HOME" \
        "export JAVA_HOME=\"$JAVA_HOME\"" \
        "export PATH=\"\$JAVA_HOME/bin:\$PATH\""
fi

# 3. Install Android SDK
write_step "Checking Android SDK"
if [[ "$OSTYPE" == "darwin"* ]]; then
    DEFAULT_ANDROID_HOME="$HOME/Library/Android/sdk"
    CMDLINE_TOOLS_OS="mac"
else
    DEFAULT_ANDROID_HOME="$HOME/Android/Sdk"
    CMDLINE_TOOLS_OS="linux"
fi

# If ANDROID_HOME is not set, try default location (SDK often installed there by Android Studio)
ANDROID_HOME_WAS_UNSET=
if [ -z "$ANDROID_HOME" ]; then
    ANDROID_HOME_WAS_UNSET=1
    if [ -d "$DEFAULT_ANDROID_HOME" ] && { [ -d "$DEFAULT_ANDROID_HOME/platform-tools" ] || [ -d "$DEFAULT_ANDROID_HOME/build-tools" ] || [ -d "$DEFAULT_ANDROID_HOME/cmdline-tools" ]; }; then
        export ANDROID_HOME="$DEFAULT_ANDROID_HOME"
        echo "ANDROID_HOME was not set; using existing SDK at $ANDROID_HOME"
    else
        export ANDROID_HOME="$DEFAULT_ANDROID_HOME"
    fi
fi

ANDROID_SDK_INSTALLED_BY_SCRIPT=
if [ ! -d "$ANDROID_HOME" ] || [ ! -f "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
    echo "Android SDK or command-line tools not found. Installing via command-line tools..."
    mkdir -p "$ANDROID_HOME"
    CLI_ZIP=$(mktemp -t commandlinetools.zip.XXXXXX)
    curl -fLo "$CLI_ZIP" \
        "https://dl.google.com/android/repository/commandlinetools-${CMDLINE_TOOLS_OS}-14742923_latest.zip"
    TEMP_CLI=$(mktemp -d)
    unzip -q "$CLI_ZIP" -d "$TEMP_CLI"
    rm -f "$CLI_ZIP"
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    mv "$TEMP_CLI/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    rm -rf "$TEMP_CLI"
    echo "Accepting SDK licenses..."
    yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
    echo "Installing platform-tools and platform (android-34)..."
    "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" \
        "platform-tools" "platforms;android-34" "emulator"
    echo "Android SDK installed at $ANDROID_HOME"
    ANDROID_SDK_INSTALLED_BY_SCRIPT=1
fi

if [ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME" ]; then
    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
    echo "ANDROID_HOME: $ANDROID_HOME"
fi
# Persist ANDROID_HOME when we installed the SDK or when it was unset and we're using the discovered/default path
if [ -n "$ANDROID_HOME" ] && { [ -n "$ANDROID_SDK_INSTALLED_BY_SCRIPT" ] || [ -n "$ANDROID_HOME_WAS_UNSET" ]; }; then
    persist_to_rc "Added by setup-project.sh - ANDROID_HOME and PATH" \
        "export ANDROID_HOME=\"$ANDROID_HOME\"" \
        "export PATH=\"\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator:\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH\""
fi

if check_command "adb"; then
    adb version
else
    echo "Warning: adb not found in PATH. You may need to install Android Platform Tools."
fi

# 4. List AVDs (create one from android-34 if none exist)
write_step "Checking AVDs"
if check_command "emulator" && [ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME" ]; then
    AVD_LIST=$(emulator -list-avds 2>/dev/null || true)
    if [ -z "$AVD_LIST" ]; then
        echo "No AVDs found. Creating one from android-34..."
        SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
        AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
        if [ -x "$SDKMANAGER" ] && [ -x "$AVDMANAGER" ]; then
            ARCH=$(uname -m)
            if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
                SYSIMG="system-images;android-34;google_apis;arm64-v8a"
            else
                SYSIMG="system-images;android-34;google_apis;x86_64"
            fi
            echo "Installing system image: $SYSIMG"
            yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" "$SYSIMG" >/dev/null 2>&1 || true
            AVD_NAME="Medium_Phone_API_34"
            echo "Creating AVD: $AVD_NAME"
            echo "no" | "$AVDMANAGER" create avd -n "$AVD_NAME" -k "$SYSIMG" -d "medium_phone" --force
            echo "AVD created: $AVD_NAME"
        else
            echo "Warning: sdkmanager or avdmanager not found. Skipping AVD creation."
        fi
    fi
    echo "Available AVDs:"
    emulator -list-avds
else
    echo "Warning: emulator command not found or ANDROID_HOME not set."
fi

# 5. Install Node and tsx
write_step "Checking Node.js"
if ! check_command "node"; then
    echo "Node.js not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install node
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "Please install Node.js and restart the script."
        exit 1
    fi
fi
node --version


# 6. Install ffmpeg
write_step "Checking ffmpeg"
if ! check_command "ffmpeg"; then
    echo "ffmpeg not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install ffmpeg
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update && sudo apt-get install -y ffmpeg
    else
        echo "Please install ffmpeg and restart the script."
        exit 1
    fi
fi
ffmpeg -version

# 7. Xcode & xcparse (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    write_step "Checking Xcode"
    if ! check_command "xcodebuild"; then
        echo "Xcode Command Line Tools not found. Please install Xcode from the App Store or run 'xcode-select --install'."
    else
        xcodebuild -version
    fi

    write_step "Checking xcparse"
    if ! check_command "xcparse"; then
        echo "xcparse not found. Installing..."
        brew install chargepoint/xcparse/xcparse
    fi
    xcparse version
fi

# 9. Project Repository
write_step "Setting up Project Repository"
CURRENT_DIR=$(pwd)
if [ -d "$PROJECT_NAME" ]; then
    echo "Directory $PROJECT_NAME already exists."
else
    REPO_URL="https://github.com/jack-beanstalk-2022/PistachioTemplate.git"
    git clone "$REPO_URL" "$PROJECT_NAME"
    
    cd "$PROJECT_NAME"
    echo "Rebranding to $PROJECT_NAME ($PACKAGE_NAME)..."
    npx tsx rebrand.ts "$PROJECT_NAME" "$PACKAGE_NAME"
    
    git add .
    if ! git commit -m "Rebrand project to $PROJECT_NAME and $PACKAGE_NAME"; then
        echo "Warning: git commit failed (e.g. unset user.name or user.email). Rebrand changes are staged but not committed."
    fi
    cd ..
fi

# 10. Install project dependencies
write_step "Installing project dependencies"
cd "$PROJECT_NAME"
if [ -f "./gradlew" ]; then
    chmod +x ./gradlew
    ./gradlew assembleDebug
else
    echo "Error: gradlew not found in $PROJECT_NAME"
    exit 1
fi

# Run test
echo "Running android test..."
TEST_ANDROID_SCRIPT=".claude/skills/run-android-test/test-android.ts"
if [ -f "$CURRENT_DIR/$TEST_ANDROID_SCRIPT" ]; then
    npx tsx "$CURRENT_DIR/$TEST_ANDROID_SCRIPT" "$CURRENT_DIR/$PROJECT_NAME" "$PACKAGE_NAME" SvgIconExampleTest testSvgIconExampleDisplaysAllElements
else
    echo "Warning: test-android.ts not found at $TEST_ANDROID_SCRIPT. Skipping test."
fi
cd ..

echo -e "\nSetup completed successfully!"
