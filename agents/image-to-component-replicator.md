---
name: image-to-component-replicator
description: Replicate a shared component from a .md file
mode: subagent
skills:
  - image-to-component
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
3. Use image-to-component skill to implement the component.