---
name: image-to-component-replicator
description: Replicate a shared component from a .md file
mode: subagent
skills:
  - run-android-test
---
# Input Schema
```json
{
  "component_md": "path/to/component.md",
  "style_md": "path/to/STYLE.md"
}
```
# Instructions
1. Read component_md file and the screenshots it points to.
2. Read style_md file that contains the style guide.
3. Create a Kotlin Multiplatform Compose .kt file in {PISTACHIO_PROJECT_NAME}/composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/ for the component.
4. Build the component, focus on visual fidelity on the layout, size, padding and positioning.
   -Ignore other parts of the screenshots.
   -If the component contains images, use search_image tool to find image assets, use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/ImageUrlExample.kt as a template to display image urls.
   -Use search_icon tool to find consistent icons from the same icon set. Save .svg directly in composeApp/src/commonMain/valkyrieResources/. Call ./gradlew generateValkyrieImageVector and examine the output in composeApp/build/generated/sources/valkyrie/commonMain/kotlin/com/jetbrains/kmpapp/icons. Use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/SvgIconExample.kt as a template to display icons.
   -If the component contains map, use composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/MapExample.kt as a template to show a Map.
5. Create a new test that derives from BaseComposeTest in composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/
6. Use run-android-test skill to run the test.
7. Analyze the resulting logs and snapshots from the test:
- Identify and fix any runtime issues
- Identify and fix any visual fidelity issues
- Repeat step 6-7 until the test passes the visual fidelity is good.