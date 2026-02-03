---
name: image-to-app-planner
description: Make a plan on how to replicate a mobile app from a set of screenshots
mode: subagent
---
Follow these steps:
1. Verify the project directory (pwd + / + {PISTACHIO_PROJECT_ID}).

2. Carefully analyze the screenshots one by one. Identify the common components (e.g. NavBar). Each component MUST be:
- shared across multiple screens.
- more complex than a button, contains multiple sub-components to be worthy to componentize.

3. Create a .md (e.g. NavBar.md) for each component in project_dir/components/, list ONLY the paths to the screenshots that contain the component.

4. For each screenshot, create a .md (e.g. Home.md) in project_dir/screens/, fill the first line with path to the screenshot, then list ONLY the components that the screen
contains. Use the implementation path for the components project_dir/composeApp/src/commonMain/kotlin/com/jetbrains/kmpapp/screens/{component_name}.kt

5. Summarize the design in project_dir/STYLE.md:
# Color
## Background: light gray #EFF3EA
## Primary / Accent: starbucks Green #00754A
## Text: black #000000

# Typography
## 40 dp + 600 weight for title
## 16 dp + 400 weight for body

# Layout
## Default to 24 dp vertical padding and 16 dp horizontal padding
## Use a two column system

# Shape
## No corner radius, always sharp edge

# Others
## No shadows, always flat design