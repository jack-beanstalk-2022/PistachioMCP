---
name: run-android-test
description: Run instrumented test on android simulator for a Pistachio project.
license: Complete terms in LICENSE.txt
---
Following these steps:
1. Find the project directory (pwd + / + {PISTACHIO_PROJECT_ID})
2. Find the test to run in {PISTACHIO_PROJECT_ID}/composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/AndroidInstrumentedTest.kt.
3. Run the test with "tsx test-android.ts path/to/project com.jetfrains.kmpapp {test_name}".
4. Examine the error log and the frames extracted. Remove the frames folder afterwards.
