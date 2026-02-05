---
name: gen-android-apk
version: 1.0.0
description: Generate an APK in designated directory for a Pistachio project.
license: Complete terms in LICENSE.txt
---
Follow these steps:
1. Run ./gradlew assembleRelease in project directory (pwd + {PISTACHIO_PROJECT_NAME}).
2. Examine composeApp/build/outputs/apk/release/ folder, find the generated APK.
3. Copy the APK to designated directory.