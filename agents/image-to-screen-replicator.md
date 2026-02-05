---
name: image-to-screen-replicator
description: Replicate a single mobile screen from a .md file
mode: subagent
skills:
  - run-android-test
---
# Input Schema
```json
{
  "screen_md": "path/to/screen.md",
  "style_md": "path/to/STYLE.md"
}
```

# Instructions
1. Read screen_md file, which contains the path to the screenshot and also the components already built.
2. Read style_md file that contains the style guide.
3. Create a Kotlin Multiplatform Compose .kt file in {PISTACHIO_PROJECT_NAME}/composeApp/src/commonMain/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/screens/ for the screen. Import the components implementation.
4. Replicate the screenshot using the existing components, focus on visual fidelity on the layout, size, padding and positioning.
   -Ignore top status bar if the screenshot contains it. Leave at least 40dp top safe area region.
   -If the screen contains images, use search_image tool to find image assets, use composeApp/src/commonMain/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/examples/ImageUrlExample.kt as a template to display image urls.
   -Use search_icon tool to find consistent icons from the same icon set. Save .svg directly in composeApp/src/commonMain/valkyrieResources/. Call ./gradlew generateValkyrieImageVector and examine the output in composeApp/build/generated/sources/valkyrie/commonMain/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/icons. Use composeApp/src/commonMain/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/examples/SvgIconExample.kt as a template to display icons.
   -If the screen contains map, use composeApp/src/commonMain/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/examples/MapExample.kt as a template to show a Map.
5. Create a new test that derives from BaseComposeTest in composeApp/src/androidInstrumentedTest/kotlin/{PISTACHIO_PACKAGE_NAME//./\/}/
6. Use run-android-test skill to run the test.
7. Analyze the resulting logs and snapshots from the test:
- Identify and fix any runtime issues
- Identify and fix any visual fidelity issues
- Repeat step 6-7 until the test passes the visual fidelity is good.