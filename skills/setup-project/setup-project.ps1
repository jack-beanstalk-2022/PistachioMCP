param (
    [Parameter(Mandatory=$false)]
    [string]$ProjectName,

    [Parameter(Mandatory=$false)]
    [string]$PackageName,

    [Parameter(Mandatory=$false)]
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Help message (same as bash: -h / --help)
if ($Help -or $ProjectName -eq '-h' -or $ProjectName -eq '--help') {
    Write-Host "Usage: .\setup-project.ps1 <ProjectName> <PackageName>"
    Write-Host "Example: .\setup-project.ps1 MyAwesomeApp com.example.awesome"
    Write-Host "`nOr: .\setup-project.ps1 -ProjectName MyAwesomeApp -PackageName com.example.awesome"
    exit 0
}
if (-not $ProjectName -or -not $PackageName) {
    Write-Host "Error: Project Name and Package Name are required."
    Write-Host "Usage: .\setup-project.ps1 <ProjectName> <PackageName>"
    Write-Host "Example: .\setup-project.ps1 MyAwesomeApp com.example.awesome"
    exit 1
}

# Root directory for .claude and project path (same as bash CURRENT_DIR)
$ScriptRoot = Get-Location

function Write-Step($msg) {
    Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Check-Command($cmd) {
    return (Get-Command $cmd -ErrorAction SilentlyContinue) -ne $null
}

# Check that java is actually usable (e.g. macOS has a stub; on Windows we still verify)
function Check-JavaUsable {
    if (-not (Check-Command "java")) { return $false }
    $prevErr = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try { java -version 2>&1 | Out-Null } catch { $ErrorActionPreference = $prevErr; return $false }
    $ErrorActionPreference = $prevErr
    return ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE)
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# Append lines to PowerShell profile if marker not already present (same as bash persist_to_rc)
function Persist-ToProfile {
    param([string]$Marker, [string[]]$Lines)
    if ($env:PERSIST_ENV_SKIP) { return }
    if ($Lines.Count -eq 0) { return }
    $profilePath = $PROFILE.CurrentUserAllHosts
    if (-not (Test-Path $profilePath)) {
        $profileDir = Split-Path $profilePath
        if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
        Set-Content -Path $profilePath -Value "" -Encoding UTF8
    }
    $content = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($Marker)) {
        Write-Host "Already persisted to $profilePath ($Marker). Skipping."
        return
    }
    $block = "`n# $Marker`n" + ($Lines -join "`n") + "`n"
    Add-Content -Path $profilePath -Value $block -Encoding UTF8
    Write-Host "Appended to $profilePath. Run the profile or open a new terminal to use them."
}

# 0. Check for WinGet
Write-Step "Checking WinGet"
if (-not (Check-Command "winget")) {
    Write-Host "WinGet not found. WinGet is required to install other dependencies." -ForegroundColor Yellow
    Write-Host "It is usually pre-installed on Windows 11 and Windows 10 (1809+)."
    Write-Host "Attempting to register App Installer..."
    try {
        Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe -ErrorAction SilentlyContinue
        Write-Host "Registration triggered. Please wait a minute and try running the script again."
    } catch {
        Write-Host "Could not automatically install WinGet."
        Write-Host "Please install 'App Installer' from the Microsoft Store or download it from:"
        Write-Host "https://github.com/microsoft/winget-cli/releases"
    }
    Write-Error "WinGet is missing. Please install it and restart the script."
}

# 1. Install Git
Write-Step "Checking Git"
if (-not (Check-Command "git")) {
    Write-Host "Git not found. Installing via winget..."
    winget install --id Git.Git -e --source winget
    Refresh-Path
}
if (-not (Check-Command "git")) {
    Write-Error "Git installation failed or not in PATH. Please restart terminal."
}
git --version

# 2. Install JDK
Write-Step "Checking JDK"
$javaInstalledByScript = $false
if (-not (Check-JavaUsable) -or -not $env:JAVA_HOME) {
    Write-Host "Java or JAVA_HOME not found. Installing OpenJDK 21 via winget..."
    winget install -e --id Microsoft.OpenJDK.21
    Refresh-Path
    
    if (-not $env:JAVA_HOME) {
        # Try to locate the installed JDK
        $jdkPath = Get-ChildItem -Path "C:\Program Files\Microsoft\jdk-21*" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($jdkPath) {
            [System.Environment]::SetEnvironmentVariable("JAVA_HOME", $jdkPath.FullName, "User")
            $env:JAVA_HOME = $jdkPath.FullName
            Write-Host "Set JAVA_HOME to $env:JAVA_HOME"
            $javaInstalledByScript = $true
        }
    }
}
java -version
Write-Host "JAVA_HOME: $env:JAVA_HOME"
if ($javaInstalledByScript -and $env:JAVA_HOME) {
    Persist-ToProfile -Marker "Added by setup-project.ps1 - JAVA_HOME" -Lines @(
        "`$env:JAVA_HOME = `"$($env:JAVA_HOME)`"",
        "`$env:Path = `"`$env:JAVA_HOME\bin;`$env:Path`""
    )
}

# 3. Install Android SDK
Write-Step "Checking Android SDK"
$defaultAndroidHome = "$env:LOCALAPPDATA\Android\Sdk"
$androidHomeWasUnset = $false
if (-not $env:ANDROID_HOME) {
    $androidHomeWasUnset = $true
    if (Test-Path $defaultAndroidHome) {
        $hasSdkContent = (Test-Path "$defaultAndroidHome\platform-tools") -or (Test-Path "$defaultAndroidHome\build-tools") -or (Test-Path "$defaultAndroidHome\cmdline-tools")
        if ($hasSdkContent) {
            $env:ANDROID_HOME = $defaultAndroidHome
            Write-Host "ANDROID_HOME was not set; using existing SDK at $env:ANDROID_HOME"
        } else {
            $env:ANDROID_HOME = $defaultAndroidHome
        }
    } else {
        $env:ANDROID_HOME = $defaultAndroidHome
    }
}

$androidSdkInstalledByScript = $false
$sdkManagerPath = "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $env:ANDROID_HOME) -or -not (Test-Path $sdkManagerPath)) {
    Write-Host "Android SDK or command-line tools not found. Installing via command-line tools..."
    if (-not (Test-Path $env:ANDROID_HOME)) { New-Item -ItemType Directory -Path $env:ANDROID_HOME -Force | Out-Null }
    $cliZip = Join-Path $env:TEMP "commandlinetools-win.zip"
    try {
        Invoke-WebRequest -Uri "https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip" -OutFile $cliZip -UseBasicParsing
        $tempCli = Join-Path $env:TEMP "cmdline-tools-extract"
        if (Test-Path $tempCli) { Remove-Item $tempCli -Recurse -Force }
        Expand-Archive -Path $cliZip -DestinationPath $tempCli -Force
        Remove-Item $cliZip -Force -ErrorAction SilentlyContinue
        $cmdlineToolsDest = "$env:ANDROID_HOME\cmdline-tools\latest"
        $cmdlineToolsSrc = Join-Path $tempCli "cmdline-tools"
        if (-not (Test-Path (Split-Path $cmdlineToolsDest))) { New-Item -ItemType Directory -Path (Split-Path $cmdlineToolsDest) -Force | Out-Null }
        if (Test-Path $cmdlineToolsDest) { Remove-Item $cmdlineToolsDest -Recurse -Force }
        Move-Item $cmdlineToolsSrc $cmdlineToolsDest
        Remove-Item $tempCli -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Accepting SDK licenses..."
        1..30 | ForEach-Object { "y" } | & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$env:ANDROID_HOME --licenses 2>&1 | Out-Null
        Write-Host "Installing platform-tools and platform (android-34)..."
        & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$env:ANDROID_HOME "platform-tools" "platforms;android-34" "emulator"
        Write-Host "Android SDK installed at $env:ANDROID_HOME"
        $androidSdkInstalledByScript = $true
    } finally {
        if (Test-Path $cliZip) { Remove-Item $cliZip -Force -ErrorAction SilentlyContinue }
    }
}

$sdkPaths = @(
    "$env:ANDROID_HOME\platform-tools",
    "$env:ANDROID_HOME\emulator",
    "$env:ANDROID_HOME\cmdline-tools\latest\bin"
)
# Also add tools for existing Android Studio installs
foreach ($p in @("$env:ANDROID_HOME\tools", "$env:ANDROID_HOME\tools\bin")) {
    if (Test-Path $p) { $sdkPaths += $p }
}

$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$pathChanged = $false
foreach ($p in $sdkPaths) {
    if ($currentPath -notlike "*$p*") {
        $currentPath = "$p;$currentPath"
        $pathChanged = $true
    }
}
$env:Path = "$($sdkPaths -join ';');$env:Path"
if ($pathChanged) {
    [System.Environment]::SetEnvironmentVariable("Path", $currentPath, "User")
    Refresh-Path
}

if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) {
    Write-Host "ANDROID_HOME: $env:ANDROID_HOME"
}
# Persist ANDROID_HOME when we installed the SDK or when it was unset and we're using the discovered/default path
if ($env:ANDROID_HOME -and ($androidSdkInstalledByScript -or $androidHomeWasUnset)) {
    Persist-ToProfile -Marker "Added by setup-project.ps1 - ANDROID_HOME and PATH" -Lines @(
        "`$env:ANDROID_HOME = `"$env:ANDROID_HOME`"",
        "`$env:Path = `"`$env:ANDROID_HOME\platform-tools;`$env:ANDROID_HOME\emulator;`$env:ANDROID_HOME\cmdline-tools\latest\bin;`$env:Path`""
    )
}

if (Check-Command "adb") {
    adb version
} else {
    Write-Warning "adb not found in PATH. You may need to install Android Platform Tools."
}

# 4. List AVDs (create one from android-34 if none exist)
Write-Step "Checking AVDs"
if ((Check-Command "emulator") -and $env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) {
    $avdList = & emulator -list-avds 2>$null
    if (-not $avdList -or $avdList.Count -eq 0) {
        Write-Host "No AVDs found. Creating one from android-34..."
        $sdkManager = "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat"
        $avdManager = "$env:ANDROID_HOME\cmdline-tools\latest\bin\avdmanager.bat"
        if ((Test-Path $sdkManager) -and (Test-Path $avdManager)) {
            $sysImg = "system-images;android-34;google_apis;x86_64"
            Write-Host "Installing system image: $sysImg"
            & $sdkManager --sdk_root=$env:ANDROID_HOME $sysImg 2>&1 | Out-Null
            $avdName = "Medium_Phone_API_34"
            Write-Host "Creating AVD: $avdName"
            "no" | & $avdManager create avd -n $avdName -k $sysImg -d "medium_phone" --force 2>&1 | Out-Null
            Write-Host "AVD created: $avdName"
        } else {
            Write-Warning "sdkmanager or avdmanager not found. Skipping AVD creation."
        }
    }
    Write-Host "Available AVDs:"
    emulator -list-avds
} else {
    Write-Warning "emulator command not found or ANDROID_HOME not set."
}

# 5. Install Node and tsx
Write-Step "Checking Node.js"
if (-not (Check-Command "node")) {
    Write-Host "Node.js not found. Installing via winget..."
    winget install OpenJS.NodeJS.LTS
    Refresh-Path
}
node --version


# 6. Install ffmpeg
Write-Step "Checking ffmpeg"
if (-not (Check-Command "ffmpeg")) {
    Write-Host "ffmpeg not found. Installing via winget..."
    winget install ffmpeg
    Refresh-Path
}
ffmpeg -version

# 9. Project Repository
Write-Step "Setting up Project Repository"
if (Test-Path $ProjectName) {
    Write-Host "Directory $ProjectName already exists."
} else {
    $repoUrl = "https://github.com/jack-beanstalk-2022/PistachioTemplate.git"
    git clone $repoUrl $ProjectName
    
    Push-Location $ProjectName
    Write-Host "Rebranding to $ProjectName ($PackageName)..."
    npx tsx rebrand.ts $ProjectName $PackageName
    
    git add .
    git commit -m "Rebrand project to $ProjectName and $PackageName" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "git commit failed (e.g. unset user.name or user.email). Rebrand changes are staged but not committed."
    }
    Pop-Location
}

# 10. Install project dependencies
Write-Step "Installing project dependencies"
Push-Location $ProjectName
if (Test-Path "gradlew.bat") {
    .\gradlew.bat assembleDebug
} else {
    Write-Error "gradlew.bat not found in $ProjectName"
}

# Run test
Write-Host "Running android test..."
$testAndroidScript = Join-Path $ScriptRoot ".claude\skills\run-android-test\test-android.ts"
$projectDir = Join-Path $ScriptRoot $ProjectName
if (Test-Path $testAndroidScript) {
    npx tsx $testAndroidScript $projectDir $PackageName SvgIconExampleTest testSvgIconExampleDisplaysAllElements
} else {
    Write-Host "Warning: test-android.ts not found at $testAndroidScript. Skipping test." -ForegroundColor Yellow
}
Pop-Location

Write-Host "`nSetup completed successfully!" -ForegroundColor Green
