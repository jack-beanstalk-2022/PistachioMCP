---
name: run-android-test
version: 1.0.0
description: Run instrumented test on android simulator for a Pistachio project.
license: Complete terms in LICENSE.txt
---
Following these steps:
1. Find the project directory (pwd + / + {PISTACHIO_PROJECT_NAME})
2. Find the test_suite_name and test_name to run in {PISTACHIO_PROJECT_NAME}/composeApp/src/androidInstrumentedTest/kotlin/${PISTACHIO_PACKAGE_NAME//./\/}/.
3. Run the test with "tsx test-android.ts path/to/project {PISTACHIO_PACKAGE_NAME//./\/} {test_suite_name} {test_name}".
4. Examine the error log and the frames_{test_name} folder. Remove the frames_{test_name} folder afterwards.
