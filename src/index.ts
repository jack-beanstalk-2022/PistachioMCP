import { config } from "dotenv";
import { resolve } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { searchImageTool } from "./tools/search-image.js";
import { searchIconTool } from "./tools/search-icon.js";
import { createRemoteProjectTool } from "./tools/create-remote-project.js";
import { createPistachioProjectPrompt } from "./prompts/create-pistachio-project.js";
import * as http from "http";

// Load .env.local file
config({ path: resolve(process.cwd(), ".env.local") });

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

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
            ],
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

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

        throw new Error(`Unknown tool: ${name}`);
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
