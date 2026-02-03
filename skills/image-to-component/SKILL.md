---
name: image-to-componet
description: Create a shared component in a Pistachio project from screenshots.
license: Complete terms in LICENSE.txt
---
Following these steps:
1. Analyze the screenshots.
2. Create a Kotlin Multiplatform Compose .kt file in {PISTACHIO_PROJECT_ID}/composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/ for the component.
3. Build the component, focus on visual fidelity on the layout, size, padding and positioning.
   -Ignore other parts of the screenshots.
   -If the component contains images, use search_image tool to find image assets, use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/ImageUrlExample.kt as a template to display image urls.
   -Use search_icon tool to find consistent icons from the same icon set. Save .svg directly in composeApp/src/commonMain/valkyrieResources/. Call ./gradlew generateValkyrieImageVector and examine the output in composeApp/build/generated/sources/valkyrie/commonMain/kotlin/com/jetbrains/kmpapp/icons. Use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/SvgIconExample.kt as a template to display icons.
   -If the component contains map, use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/MapExample.kt as a template to show a Map.
4. Create a new test that derives from BaseComposeTest in composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/
5. Use run-android-test skill to run the test.
6. Analyze the resulting logs and snapshots from the test:
- Identify and fix any runtime issues
- Identify and fix any visual fidelity issues
- Repeat step 5-6 until the test passes the visual fidelity is good.