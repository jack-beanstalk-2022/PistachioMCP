---
name: image-to-screen-replicator
description: Replicate a single mobile screen from a .md file
mode: subagent
skills:
  - image-to-screen
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
1. Read screen_md file, which contains the path to the screenshot and also the component already built.
2. Read style_md file that contains the style guide.
4. Use image-to-screen skill to implement the screen.