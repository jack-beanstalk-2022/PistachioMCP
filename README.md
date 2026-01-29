# Pistachio MCP Server

A remote MCP (Model Context Protocol) server built with Node.js and TypeScript for mobile app development. This server provides tools and prompts for remote project management, testing, and asset search.

## Prerequisites

Before setting up this repository, ensure you have the following installed:

- **Node.js** (v20 or higher)
- **Yarn** (v4.10.3 or compatible version)
- **Git**

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd pistachio-mcp
```

### 2. Install Yarn (if not already installed)

This project uses Yarn 4.10.3 as the package manager. If you don't have Yarn installed or need to upgrade:

```bash
# Install Yarn globally (if needed)
npm install -g yarn

# Or use Corepack (recommended for Node.js 16.10+)
corepack enable
corepack prepare yarn@4.10.3 --activate
```

### 3. Install Dependencies

Install all project dependencies using Yarn:

```bash
yarn install
```

This will install all dependencies listed in `package.json`, including:
- `@modelcontextprotocol/sdk` - MCP SDK
- `firebase` - Firebase SDK for Firestore and Auth
- `@google-cloud/storage` - Google Cloud Storage client
- `zod` - Schema validation
- TypeScript and development dependencies

### 4. Configure Environment Variables

Create a `.env` file in the root directory (if needed for custom configuration):

```bash
# Optional: Set custom port (default: 3001)
PORT=3001

# Optional: Set number of worker threads (default: 2)
NUM_WORKERS=2

# Optional: Set Node environment
NODE_ENV=development

# Optional: Firebase emulator configuration (for development)
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
FIRESTORE_EMULATOR_HOST=localhost:8080

# Optional: Google Cloud Storage bucket for weekly expiring assets
GCS_BUCKET_WEEKLY_EXPIRING=dev-pistachio-assets-weekly-expiring
```

**Note:** The project uses hardcoded Firebase configuration in `src/utils/ServerStorageUtils.ts`. For production, you may want to move this to environment variables.

### 5. Configure Google Cloud Storage (Optional)

If you plan to use Google Cloud Storage features (image uploads), you'll need to set up authentication:

1. **Create a service account** in Google Cloud Console
2. **Download the service account key** as a JSON file
3. **Set the environment variable**:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
```

Alternatively, if running on Google Cloud Platform, authentication is handled automatically.

### 6. Build the Project

Compile TypeScript to JavaScript:

```bash
yarn build
```

This will generate the `dist/` directory with compiled JavaScript files.

### 7. Verify Installation

Run the tests to verify everything is set up correctly:

```bash
yarn test:run
```

## Running the Server

### Development Mode

Run the server in development mode with hot reload:

```bash
yarn dev
```

The server will start on port 3001 by default (or the port specified by the `PORT` environment variable).

### Production Mode

Build and run the compiled server:

```bash
yarn build
node dist/index.js
```

### Direct Execution (Development)

Run TypeScript directly without building:

```bash
yarn start
```

## Server Configuration

### Default Settings

- **Port**: 3001 (configurable via `PORT` environment variable)
- **Workers**: 2 (configurable via `NUM_WORKERS` environment variable)
- **Host**: `0.0.0.0` (accessible from remote clients)

### MCP Endpoint

The server exposes an MCP endpoint at `/message` that accepts:
- **GET**: Establish SSE stream for receiving messages
- **POST**: Send MCP requests
- **OPTIONS**: CORS preflight requests

Example endpoint: `http://localhost:3001/message`

## Available Tools

The server provides the following MCP tools:

- `search_image` - Search for images
- `search_icon` - Search for icons
- `create_remote_project` - Create a remote project
- `remote_kdoctor` - Run kdoctor diagnostics
- `remote_clean_project` - Clean a remote project
- `remote_test_android` - Run Android tests remotely

## Available Prompts

The server provides the following MCP prompts:

- `create_pistachio_project` - Generate instructions for creating a Pistachio project
- `start_sync` - Generate instructions for starting sync

## Development

### Running Tests

```bash
# Run tests in watch mode
yarn test

# Run tests once
yarn test:run
```

### Linting

```bash
# Check for linting errors
yarn lint

# Fix linting errors automatically
yarn lint:fix
```

### TypeScript Compilation Errors

If you encounter TypeScript errors:

```bash
# Clean and rebuild
rm -rf dist
yarn build
```

## License

MIT
