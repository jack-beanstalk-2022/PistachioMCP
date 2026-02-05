import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
    type ContentBlock,
} from "@modelcontextprotocol/sdk/types.js";
import { searchImageTool } from "./tools/search-image.js";
import { searchIconTool } from "./tools/search-icon.js";
import { checkLocalProjectPrompt } from "./prompts/check-local-project.js";
import { imageToAppPrompt } from "./prompts/image-to-app.js";
import { TaskQueue } from "./utils/TaskQueueUtils.js";
import { logger } from "./utils/Logger.js";
import * as http from "http";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const NUM_WORKERS = process.env.NUM_WORKERS ? parseInt(process.env.NUM_WORKERS, 10) : 2;

// Queue system for tool calls
interface ToolTask {
    name: string;
    args: unknown;
}

/**
 * Extracts project ID from tool task arguments.
 * Returns the project_id if present, undefined otherwise.
 */
function extractProjectId(args: unknown): string | undefined {
    if (args && typeof args === "object" && "project_id" in args) {
        const projectId = (args as { project_id?: unknown }).project_id;
        if (typeof projectId === "string") {
            return projectId;
        }
    }
    return undefined;
}

const toolCallQueue = new TaskQueue<ToolTask, { content: ContentBlock[]; isError: boolean }>(NUM_WORKERS);

/**
 * Handles the execution of a tool call
 */
async function handleToolCall(name: string, args: unknown): Promise<{ content: ContentBlock[]; isError: boolean }> {
    const startTime = Date.now();
    if (name === searchImageTool.name) {
        try {
            const parsedArgs = searchImageTool.inputSchema.parse(args);
            const result = await searchImageTool.handler(parsedArgs);
            const durationMs = Date.now() - startTime;

            if (result.success) {
                logger.info({
                    tool_name: name,
                    duration_ms: durationMs,
                    status: "success",
                }, "Tool call completed successfully");
            } else {
                logger.warn({
                    tool_name: name,
                    duration_ms: durationMs,
                    status: "execution_error",
                    reason: result.output,
                }, "Tool call failed");
            }

            return {
                content: [
                    {
                        type: "text",
                        text: result.success
                            ? result.output
                            : `Error: ${result.output}`,
                    },
                ],
                isError: !result.success,
            };
        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;

            logger.error({
                tool_name: name,
                duration_ms: durationMs,
                status: "validation_error",
                reason: errorMessage,
                stack: errorStack,
            }, "Tool call validation failed");

            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    }

    if (name === searchIconTool.name) {
        try {
            const parsedArgs = searchIconTool.inputSchema.parse(args);
            const result = await searchIconTool.handler(parsedArgs);
            const durationMs = Date.now() - startTime;

            if (result.success) {
                logger.info({
                    tool_name: name,
                    duration_ms: durationMs,
                    status: "success",
                }, "Tool call completed successfully");
            } else {
                logger.warn({
                    tool_name: name,
                    duration_ms: durationMs,
                    status: "execution_error",
                    reason: result.output,
                }, "Tool call failed");
            }

            return {
                content: [
                    {
                        type: "text",
                        text: result.success
                            ? result.output
                            : `Error: ${result.output}`,
                    },
                ],
                isError: !result.success,
            };
        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;

            logger.error({
                tool_name: name,
                duration_ms: durationMs,
                status: "validation_error",
                reason: errorMessage,
                stack: errorStack,
            }, "Tool call validation failed");

            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    }


    const durationMs = Date.now() - startTime;
    logger.error({
        tool_name: name,
        duration_ms: durationMs,
        status: "unknown_tool",
    }, "Unknown tool requested");

    return {
        content: [
            {
                type: "text",
                text: `Error: Unknown tool: ${name}`,
            },
        ],
        isError: true,
    };
}


async function main() {
    // Initialize the MCP server
    const server = new Server(
        {
            name: "pistachio-mcp",
            version: "1.0.0",
        },
        {
            capabilities: {
                tools: {},
                prompts: {},
            },
        }
    );

    // Register tools
    server.setRequestHandler(ListToolsRequestSchema, () => {
        return {
            tools: [
                {
                    name: searchImageTool.name,
                    description: searchImageTool.description,
                    inputSchema: searchImageTool.inputSchema, // SDK will convert Zod to JSON Schema
                },
                {
                    name: searchIconTool.name,
                    description: searchIconTool.description,
                    inputSchema: searchIconTool.inputSchema, // SDK will convert Zod to JSON Schema
                },
            ],
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        // Extract project ID from args if present
        const projectId = extractProjectId(args);

        try {
            // Queue the tool call and wait for it to be processed
            const result = await toolCallQueue.enqueue(
                { name, args },
                async (task) => handleToolCall(task.name, task.args),
                projectId
            );
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;

            logger.error({
                tool_name: name,
                project_id: projectId,
                status: "unexpected_error",
                error_message: errorMessage,
                stack: errorStack,
            }, "Unexpected error in tool call");

            throw error;
        }
    });

    // Register prompts
    server.setRequestHandler(ListPromptsRequestSchema, () => {
        return {
            prompts: [
                {
                    name: checkLocalProjectPrompt.name,
                    description: checkLocalProjectPrompt.description,
                    arguments: [
                        {
                            name: "project_name",
                            description: "The name of the project to create",
                            type: "string",
                        },
                        {
                            name: "package_name",
                            description: "The package name of the project, e.g. com.company.myapp",
                            type: "string",
                        },
                    ],
                },
                {
                    name: imageToAppPrompt.name,
                    description: imageToAppPrompt.description,
                    arguments: [
                        {
                            name: "screenshots_directory",
                            description:
                                "Absolute or relative path to the directory containing the app screenshots to replicate",
                            type: "string",
                        },
                    ],
                },
            ],
        };
    });

    server.setRequestHandler(GetPromptRequestSchema, (request) => {
        const { name, arguments: args } = request.params;
        const startTime = Date.now();

        if (name === checkLocalProjectPrompt.name) {
            try {
                const typedArgs = checkLocalProjectPrompt.arguments.parse(args);
                const messages = checkLocalProjectPrompt.handler(typedArgs);
                const durationMs = Date.now() - startTime;

                logger.info({
                    prompt_name: name,
                    duration_ms: durationMs,
                    status: "success",
                }, "Prompt request completed successfully");

                return {
                    description: checkLocalProjectPrompt.description,
                    messages,
                };
            } catch (error) {
                const durationMs = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorStack = error instanceof Error ? error.stack : undefined;

                logger.error({
                    prompt_name: name,
                    duration_ms: durationMs,
                    status: "error",
                    error_message: errorMessage,
                    stack: errorStack,
                }, "Prompt request failed");

                throw new Error(
                    `Error generating prompt: ${errorMessage}`
                );
            }
        }

        if (name === imageToAppPrompt.name) {
            try {
                const typedArgs = imageToAppPrompt.arguments.parse(args);
                const messages = imageToAppPrompt.handler(typedArgs);
                const durationMs = Date.now() - startTime;

                logger.info({
                    prompt_name: name,
                    duration_ms: durationMs,
                    status: "success",
                }, "Prompt request completed successfully");

                return {
                    description: imageToAppPrompt.description,
                    messages,
                };
            } catch (error) {
                const durationMs = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorStack = error instanceof Error ? error.stack : undefined;

                logger.error({
                    prompt_name: name,
                    duration_ms: durationMs,
                    status: "error",
                    error_message: errorMessage,
                    stack: errorStack,
                }, "Prompt request failed");

                throw new Error(
                    `Error generating prompt: ${errorMessage}`
                );
            }
        }

        const durationMs = Date.now() - startTime;
        logger.error({
            prompt_name: name,
            duration_ms: durationMs,
            status: "unknown_prompt",
        }, "Unknown prompt requested");

        throw new Error(`Unknown prompt: ${name}`);
    });

    // Create Streamable HTTP transport
    const transport = new StreamableHTTPServerTransport();

    // Connect server to transport
    await server.connect(transport);

    // Create HTTP server
    const httpServer = http.createServer();

    // Handle requests
    httpServer.on("request", async (req, res) => {
        // Handle CORS preflight
        if (req.method === "OPTIONS") {
            res.writeHead(200, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            });
            res.end();
            return;
        }

        // Handle MCP transport requests
        if (req.url === "/message" || req.url?.startsWith("/message")) {
            await transport.handleRequest(req, res);
        } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
        }
    });

    httpServer.listen(PORT, "0.0.0.0", () => {
        logger.info({ port: PORT }, "MCP server listening");
    });
}

main().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error({
        error_message: errorMessage,
        stack: errorStack,
    }, "Fatal error in main()");

    process.exit(1);
});
