---
name: run-ios-test
version: 1.0.0
description: Run XCUITest on iOS simulator for a Pistachio project.
license: Complete terms in LICENSE.txt
---
Following these steps:
1. Find the project directory (pwd + / + {PISTACHIO_PROJECT_NAME})
2. Find the test name to run in {PISTACHIO_PROJECT_NAME}/iosApp/iosAppUITests/iosAppUITests.swift (e.g. "testScrollingDownGesture").
3. Run the test with "npx tsx test-ios.ts path/to/iosApp {test_name}".
4. Examine the error log and the frames_{test_name} folder. Remove the frames_{test_name} folder afterwards.
