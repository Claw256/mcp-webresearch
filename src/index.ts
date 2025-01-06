#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerToolHandlers } from "./handlers/tools.js";
import { registerResourceHandlers } from "./handlers/resources.js";
import { registerPromptHandlers } from "./handlers/prompts.js";
import { cleanupBrowser } from "./services/browser.js";
import { cleanupScreenshots } from "./services/screenshot.js";

// Initialize MCP server with basic configuration
const server: Server = new Server(
    {
        name: "webresearch",
        version: "0.1.7",
    },
    {
        capabilities: {
            tools: {},      // Available tool configurations
            resources: {},  // Resource handling capabilities
            prompts: {}     // Prompt processing capabilities
        },
    }
);

// Register all handlers
registerToolHandlers(server);
registerResourceHandlers(server);
registerPromptHandlers(server);

// Initialize MCP server connection using stdio transport
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});

// Cleanup function
async function cleanup(): Promise<void> {
    try {
        await cleanupScreenshots();
        await cleanupBrowser();
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Register cleanup handlers
process.on('exit', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGHUP', cleanup);