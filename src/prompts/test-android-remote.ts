import { z } from "zod";

/**
 * Prompt template for testing Android remotely
 */
export const testAndroidRemotePrompt = {
  name: "test_android_remote",
  description: "Test Android app remotely by creating or using an existing test, syncing with rclone, running the test, and analyzing results",
  arguments: z.object({
    description: z.string().describe("Description of what the test should do"),
  }),
  handler: (args: { description: string }) => {
    const { description } = args;
    return [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `
Follow these steps to test an Android app remotely:

1. Retrieve PISTACHIO_PROJECT_ID if you don't have it:
   - Search for PISTACHIO_PROJECT_ID in the following files:
     - .cursor/rules
     - CLAUDE.md or .claude/CLAUDE.md
     - AGENTS.md
   - Extract the project ID value from the file.

2. Determine test strategy:
   - Check if there are existing tests in {PISTACHIO_PROJECT_ID}/composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/AndroidInstrumentedTest.kt
   - Based on the description "${description}", determine whether to:
     a. Use an existing test that matches the description, OR
     b. Create a new test file
   - If creating a new test, examine the existing test files in that directory as templates to understand the structure, imports, and patterns used.
   - The test should be created in the file: {PISTACHIO_PROJECT_ID}/composeApp/src/androidInstrumentedTest/kotlin/com/jetbrains/kmpapp/AndroidInstrumentedTest.kt

3. Sync project with rclone:
   - Run the following command to sync the local project with the remote server:
     rclone sync {PISTACHIO_PROJECT_ID} pistachio-server:{PISTACHIO_PROJECT_ID} --exclude-from={PISTACHIO_PROJECT_ID}/.rcloneignore  --transfers 32 --checkers 64 --size-only --fast-list -P
   - Wait for the sync to complete before proceeding.

4. Run the test using remote-test-android tool:
   - Call the remote-test-android tool with the following parameters:
     - project_id: {PISTACHIO_PROJECT_ID}
     - package_name: com.jetbrains.kmpapp (or the appropriate package name if different)
     - test_name: The test name inside AndroidInstrumentedTest.kt (e.g., "testScrollingDownGesture")

5. Analyze results and fix problems:
   - Carefully examine the returned logs for any errors, failures, or warnings.
   - Review the image sequence to understand what happened during the test execution.
   - If the test failed or encountered issues:
     a. Identify the root cause from the logs and images
     b. Fix the test code or the app code as needed
     c. Repeat steps 3-5 (sync, run test, analyze) until the test passes
   - If the test passed, confirm the results match the expected behavior described in "${description}".
                    `,
        },
      },
    ];
  },
};
