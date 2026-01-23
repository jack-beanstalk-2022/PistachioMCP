import { z } from "zod";

/**
 * Example tool that demonstrates tool call functionality
 * This tool performs a simple calculation
 */
export const exampleTool = {
    name: "example_calculator",
    description: "Performs basic arithmetic operations on two numbers",
    inputSchema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
        operation: z
            .enum(["add", "subtract", "multiply", "divide"])
            .describe("The arithmetic operation to perform"),
    }),
    handler: (args: {
        a: number;
        b: number;
        operation: "add" | "subtract" | "multiply" | "divide";
    }) => {
        const { a, b, operation } = args;

        let result: number;
        switch (operation) {
            case "add":
                result = a + b;
                break;
            case "subtract":
                result = a - b;
                break;
            case "multiply":
                result = a * b;
                break;
            case "divide":
                if (b === 0) {
                    throw new Error("Division by zero is not allowed");
                }
                result = a / b;
                break;
        }

        return {
            result,
            operation: `${a} ${operation} ${b} = ${result}`,
        };
    },
};
