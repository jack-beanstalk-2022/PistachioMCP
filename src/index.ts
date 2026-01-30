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
import { createRemoteProjectTool } from "./tools/create-remote-project.js";
import { remoteKdoctorTool } from "./tools/remote-kdoctor.js";
import { remoteCleanProjectTool } from "./tools/remote-clean-project.js";
import { remoteTestAndroidTool } from "./tools/remote-test-android.js";
import { createPistachioProjectPrompt } from "./prompts/create-pistachio-project.js";
import { testAndroidRemotePrompt } from "./prompts/test-android-remote.js";
import { TaskQueue } from "./utils/TaskQueueUtils.js";
import { updateProjectTimestamp } from "./utils/ServerStorageUtils.js";
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
    if (name === searchImageTool.name) {
        try {
            const parsedArgs = searchImageTool.inputSchema.parse(args);
            const result = await searchImageTool.handler(parsedArgs);
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
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    if (name === createRemoteProjectTool.name) {
        try {
            const parsedArgs = createRemoteProjectTool.inputSchema.parse(args);
            const result = await createRemoteProjectTool.handler(parsedArgs);
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
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    if (name === remoteKdoctorTool.name) {
        try {
            const parsedArgs = remoteKdoctorTool.inputSchema.parse(args);
            const result = await remoteKdoctorTool.handler(parsedArgs);

            // Update project timestamp if successful
            if (result.success && parsedArgs.project_id) {
                try {
                    await updateProjectTimestamp(parsedArgs.project_id);
                } catch (error) {
                    // Log but don't fail the tool call if timestamp update fails
                    console.warn(`Failed to update project timestamp for ${parsedArgs.project_id}:`, error);
                }
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
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    if (name === remoteCleanProjectTool.name) {
        try {
            const parsedArgs = remoteCleanProjectTool.inputSchema.parse(args);
            const result = await remoteCleanProjectTool.handler(parsedArgs);

            // Update project timestamp if successful
            if (result.success && parsedArgs.project_id) {
                try {
                    await updateProjectTimestamp(parsedArgs.project_id);
                } catch (error) {
                    // Log but don't fail the tool call if timestamp update fails
                    console.warn(`Failed to update project timestamp for ${parsedArgs.project_id}:`, error);
                }
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
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    if (name === remoteTestAndroidTool.name) {
        try {
            const parsedArgs = remoteTestAndroidTool.inputSchema.parse(args);
            const result = await remoteTestAndroidTool.handler(parsedArgs);

            // Update project timestamp if successful
            if (result.success && parsedArgs.project_id) {
                try {
                    await updateProjectTimestamp(parsedArgs.project_id);
                } catch (error) {
                    // Log but don't fail the tool call if timestamp update fails
                    console.warn(`Failed to update project timestamp for ${parsedArgs.project_id}:`, error);
                }
            }

            const content: ContentBlock[] = [];

            // Add the main output text
            if (result.output) {
                content.push({
                    type: "text",
                    text: result.output,
                });
            }

            // Add screen recording as resource_link if available
            if (result.screenrecord) {
                content.push({
                    type: "resource_link",
                    uri: result.screenrecord,
                    name: "screen recording of the test",
                    mimeType: "video/mp4",
                });
            }

            // Add image sequence as image blocks if available
            if (result.images && result.images.length > 0) {
                for (const imageBase64 of result.images) {
                    content.push({
                        type: "image",
                        data: imageBase64,
                        mimeType: "image/jpeg",
                    });
                }
            }

            return {
                content,
                isError: !result.success,
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    throw new Error(`Unknown tool: ${name}`);
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
                {
                    name: createRemoteProjectTool.name,
                    description: createRemoteProjectTool.description,
                    inputSchema: createRemoteProjectTool.inputSchema, // SDK will convert Zod to JSON Schema
                },
                {
                    name: remoteKdoctorTool.name,
                    description: remoteKdoctorTool.description,
                    inputSchema: remoteKdoctorTool.inputSchema, // SDK will convert Zod to JSON Schema
                },
                {
                    name: remoteCleanProjectTool.name,
                    description: remoteCleanProjectTool.description,
                    inputSchema: remoteCleanProjectTool.inputSchema, // SDK will convert Zod to JSON Schema
                },
                {
                    name: remoteTestAndroidTool.name,
                    description: remoteTestAndroidTool.description,
                    inputSchema: remoteTestAndroidTool.inputSchema, // SDK will convert Zod to JSON Schema
                },
            ],
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        // Extract project ID from args if present
        const projectId = extractProjectId(args);

        // Queue the tool call and wait for it to be processed
        return toolCallQueue.enqueue(
            { name, args },
            async (task) => handleToolCall(task.name, task.args),
            projectId
        );
    });

    // Register prompts
    server.setRequestHandler(ListPromptsRequestSchema, () => {
        return {
            prompts: [
                {
                    name: createPistachioProjectPrompt.name,
                    description: createPistachioProjectPrompt.description,
                    arguments: [
                        {
                            name: "project_name",
                            description: "The name of the project to create",
                            type: "string",
                        },
                    ],
                },
                {
                    name: testAndroidRemotePrompt.name,
                    description: testAndroidRemotePrompt.description,
                    arguments: [
                        {
                            name: "description",
                            description: "Description of the test",
                            type: "string",
                        },
                    ],
                },
            ],
        };
    });

    server.setRequestHandler(GetPromptRequestSchema, (request) => {
        const { name, arguments: args } = request.params;

        if (name === createPistachioProjectPrompt.name) {
            try {
                const typedArgs = createPistachioProjectPrompt.arguments.parse(args);
                const messages = createPistachioProjectPrompt.handler(typedArgs);
                return {
                    description: createPistachioProjectPrompt.description,
                    messages,
                };
            } catch (error) {
                throw new Error(
                    `Error generating prompt: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        if (name === testAndroidRemotePrompt.name) {
            try {
                const typedArgs = testAndroidRemotePrompt.arguments.parse(args);
                const messages = testAndroidRemotePrompt.handler(typedArgs);
                return {
                    description: testAndroidRemotePrompt.description,
                    messages,
                };
            } catch (error) {
                throw new Error(
                    `Error generating prompt: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

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
        console.log(`MCP server listening on port ${PORT}`);
    });
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
