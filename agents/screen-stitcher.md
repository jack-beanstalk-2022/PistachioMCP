---
name: screen-stitcher
description: Stitch the screens into a mobile app
mode: subagent
---
1. List all screens in {PISTACHIO_PROJECT_NAME}/screens/, find the corresponding implementation in {PISTACHIO_PROJECT_NAME}/composeApp/src/commonMain/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/screens/.

2. Identify navigation between these screens and connect the navigation targets in composeApp/src/commonMain/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/App.kt.

3. Run ./gradlew installDebug to build and install app on simulator.