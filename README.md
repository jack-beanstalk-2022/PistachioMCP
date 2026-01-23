# Pistachio MCP Server

A remote MCP (Model Context Protocol) server built with Node.js and TypeScript. This server demonstrates how to implement tool calls and prompt templates using the official `@modelcontextprotocol/sdk` with HTTP transport for remote access.

## Features

- **Tool Calls**: Register and handle tools that can be invoked by AI models
- **Prompt Templates**: Create reusable prompt templates with argument support
- **TypeScript**: Full type safety with Zod schema validation
- **Remote HTTP Transport**: Streamable HTTP transport for remote MCP server access
- **CORS Support**: Built-in CORS handling for web-based clients

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project (optional, for production):
```bash
npm run build
```

## Usage

### Development Mode

Run the server in development mode with hot reload:
```bash
npm run dev
```

The server will start on port 3000 by default (or the port specified by the `PORT` environment variable).

### Production Mode

Build and run the compiled server:
```bash
npm run build
node dist/index.js
```

### Direct Execution

Run TypeScript directly without building:
```bash
npm start
```

### Environment Variables

- `PORT`: Port number for the HTTP server (default: 3000)

Example:
```bash
PORT=8080 npm start
```

### Remote Access

The server exposes an MCP endpoint at `/message` that accepts:
- **GET**: Establish SSE stream for receiving messages
- **POST**: Send MCP requests
- **OPTIONS**: CORS preflight requests

The server listens on `0.0.0.0` by default, making it accessible from remote clients.

Example endpoint: `http://localhost:3000/message`

## Project Structure

```
pistachio-mcp/
├── src/
│   ├── index.ts          # Main server entry point
│   ├── tools/            # Tool implementations
│   │   └── example.ts    # Example calculator tool
│   └── prompts/          # Prompt templates
│       └── example.ts    # Example greeting prompt
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## Adding New Tools

1. Create a new file in `src/tools/` (e.g., `src/tools/my-tool.ts`):

```typescript
import { z } from "zod";

export const myTool = {
  name: "my_tool_name",
  description: "Description of what the tool does",
  inputSchema: z.object({
    // Define your input schema using Zod
    param1: z.string().describe("Parameter description"),
  }),
  handler: async (args: { param1: string }) => {
    // Implement your tool logic
    return { result: "tool output" };
  },
};
```

2. Import and register the tool in `src/index.ts`:

```typescript
import { myTool } from "./tools/my-tool.js";

// Add to tools/list handler
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      // ... existing tools
      {
        name: myTool.name,
        description: myTool.description,
        inputSchema: myTool.inputSchema,
      },
    ],
  };
});

// Add to tools/call handler
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;
  
  // ... existing tool handlers
  if (name === myTool.name) {
    const result = await myTool.handler(args as any);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
});
```

## Adding New Prompt Templates

1. Create a new file in `src/prompts/` (e.g., `src/prompts/my-prompt.ts`):

```typescript
import { z } from "zod";

export const myPrompt = {
  name: "my_prompt_name",
  description: "Description of the prompt template",
  arguments: z.object({
    // Define your prompt arguments using Zod
    arg1: z.string().describe("Argument description"),
  }),
  handler: async (args: { arg1: string }) => {
    // Generate and return prompt messages
    return [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Your prompt text with ${args.arg1}`,
        },
      },
    ];
  },
};
```

2. Import and register the prompt in `src/index.ts`:

```typescript
import { myPrompt } from "./prompts/my-prompt.js";

// Add to prompts/list handler
server.setRequestHandler("prompts/list", async () => {
  return {
    prompts: [
      // ... existing prompts
      {
        name: myPrompt.name,
        description: myPrompt.description,
        arguments: myPrompt.arguments,
      },
    ],
  };
});

// Add to prompts/get handler
server.setRequestHandler("prompts/get", async (request) => {
  const { name, arguments: args } = request.params;
  
  // ... existing prompt handlers
  if (name === myPrompt.name) {
    const messages = await myPrompt.handler(args as any);
    return { messages };
  }
});
```

## Example Tools

### Calculator Tool

The example calculator tool (`example_calculator`) performs basic arithmetic operations:
- Operations: add, subtract, multiply, divide
- Input: Two numbers and an operation
- Output: Calculation result

## Example Prompts

### Greeting Prompt

The example greeting prompt (`greeting`) generates personalized greetings:
- Arguments: name (required), language (optional: en, es, fr, de)
- Output: Localized greeting message

## Remote MCP Server

This server uses the **Streamable HTTP transport** protocol, which allows MCP clients to connect remotely over HTTP. The transport supports:

- Server-Sent Events (SSE) for streaming responses
- Standard HTTP POST requests for sending messages
- Session management for stateful connections
- CORS support for web-based clients

### Connecting from MCP Clients

To connect to this remote server from an MCP client, configure it with:
- **URL**: `http://your-server:3000/message`
- **Transport**: Streamable HTTP

## Dependencies

- `@modelcontextprotocol/sdk`: Official MCP SDK for Node.js
- `zod`: Schema validation library (required peer dependency)
- `typescript`: TypeScript compiler
- `tsx`: TypeScript execution runtime

## License

MIT
