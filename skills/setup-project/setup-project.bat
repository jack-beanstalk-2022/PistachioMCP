@echo off
if "%~1"=="" (
    echo Usage: %~nx0 ^<ProjectName^> ^<PackageName^>
    echo Example: %~nx0 MyAwesomeApp com.example.awesome
    exit /b 1
)
if "%~2"=="" (
    echo Usage: %~nx0 ^<ProjectName^> ^<PackageName^>
    echo Example: %~nx0 MyAwesomeApp com.example.awesome
    exit /b 1
)

powershell -ExecutionPolicy Bypass -File "%~dp0setup-project.ps1" -ProjectName "%~1" -PackageName "%~2"
