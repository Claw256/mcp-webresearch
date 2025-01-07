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
            tools: {
                search_google: {
                    description: "Search Google and return results",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "Search query"
                            }
                        },
                        required: ["query"]
                    }
                },
                visit_page: {
                    description: "Visit a webpage and extract its content",
                    inputSchema: {
                        type: "object",
                        properties: {
                            url: {
                                type: "string",
                                description: "URL to visit"
                            },
                            takeScreenshot: {
                                type: "boolean",
                                description: "Whether to take a screenshot of the page"
                            }
                        },
                        required: ["url"]
                    }
                },
                take_screenshot: {
                    description: "Take a screenshot of the current page",
                    inputSchema: {
                        type: "object",
                        properties: {},
                        required: []
                    }
                }
            },
            resources: {},  // Resource handling capabilities
            prompts: {}     // Prompt processing capabilities
        }
    }
);

// Error handling for server
server.onerror = (error) => {
    console.error("Server error:", error);
    cleanup().catch(console.error);
};

// Register all handlers
registerToolHandlers(server);
registerResourceHandlers(server);
registerPromptHandlers(server);

// Initialize MCP server connection using stdio transport
const transport = new StdioServerTransport();

// Cleanup function
async function cleanup(): Promise<void> {
    try {
        await cleanupScreenshots();
        await cleanupBrowser();
        await server.close().catch(() => {});
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Register cleanup handlers with proper async handling
const handleExit = (signal: string) => {
    console.error(`Received ${signal}, cleaning up...`);
    cleanup()
        .then(() => {
            console.error('Cleanup completed, exiting...');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Cleanup failed:', error);
            process.exit(1);
        });
};

// Use proper signal handling
process.on('SIGTERM', () => handleExit('SIGTERM'));
process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGHUP', () => handleExit('SIGHUP'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    handleExit('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    handleExit('unhandledRejection');
});

// Start server with error handling
server.connect(transport).catch((error) => {
    console.error("Failed to start server:", error);
    cleanup().finally(() => process.exit(1));
});