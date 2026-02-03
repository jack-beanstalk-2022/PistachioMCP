---
name: image-to-screen
description: Create a mobile screen in a Pistachio project from a screenshot.
license: Complete terms in LICENSE.txt
---
Following these steps:
1. Analyze the screenshot. Identify the part already implemented by the given components.
2. Create a Kotlin Multiplatform Compose .kt file in {PISTACHIO_PROJECT_ID}/composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/ for the screen.
3. Replicate the screenshot using the existing components, focus on visual fidelity on the layout, size, padding and positioning.
-Ignore top status bar if the screenshot contains it. 
-If the screen contains images, use search_image tool to find image assets, use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/ImageUrlExample.kt as a template to display image urls.
-Use search_icon tool to find consistent icons from the same icon set. Save .svg directly in composeApp/src/commonMain/valkyrieResources/. Use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/SvgIconExample.kt as a template to display icons.
-If the screen contains map, use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/MapExample.kt as a template to show a Map.
4. Temporarily make this new screen the launch screen by modifying composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/App.kt
5. Create a test for the new screen in composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/AndroidInstrumentedTest.kt
6. Use run-android-test skill to run the test.
7. Analyze the resulting logs and snapshots from the test:
- Identify and fix any runtime issues
- Identify and fix any visual fidelity issues
- Repeat step 6-7 until the test passes the visual fidelity is good.