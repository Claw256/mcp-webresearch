import { ListResourcesRequestSchema, ReadResourceRequestSchema, McpError, ErrorCode, Resource } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getCurrentSession, getResult } from "../services/session.js";
import * as fs from 'fs';

export function registerResourceHandlers(server: Server): void {
    // Register handler for resource listing requests
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const currentSession = getCurrentSession();
        
        // Return empty list if no active session
        if (!currentSession) {
            return { resources: [] };
        }

        // Compile list of available resources
        const resources: Resource[] = [
            // Add session summary resource
            {
                uri: "research://current/summary",
                name: "Current Research Session Summary",
                description: "Summary of the current research session including queries and results",
                mimeType: "application/json"
            },
            // Add screenshot resources if available
            ...currentSession.results
                .map((r, i): Resource | undefined => r.screenshotPath ? {
                    uri: `research://screenshots/${i}`,
                    name: `Screenshot of ${r.title}`,
                    description: `Screenshot taken from ${r.url}`,
                    mimeType: "image/png"
                } : undefined)
                .filter((r): r is Resource => r !== undefined)
        ];

        return { resources };
    });

    // Register handler for resource content requests
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri.toString();

        // Handle session summary requests
        if (uri === "research://current/summary") {
            const currentSession = getCurrentSession();
            if (!currentSession) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    "No active research session"
                );
            }

            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify({
                        query: currentSession.query,
                        resultCount: currentSession.results.length,
                        lastUpdated: currentSession.lastUpdated,
                        results: currentSession.results.map(r => ({
                            title: r.title,
                            url: r.url,
                            timestamp: r.timestamp,
                            screenshotPath: r.screenshotPath
                        }))
                    }, null, 2)
                }]
            };
        }

        // Handle screenshot requests
        if (uri.startsWith("research://screenshots/")) {
            const index = parseInt(uri.split("/").pop() || "", 10);
            const result = getResult(index);

            if (!result?.screenshotPath) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `No screenshot available at index: ${index}`
                );
            }

            try {
                const screenshotData = await fs.promises.readFile(result.screenshotPath);
                const base64Data = screenshotData.toString('base64');

                return {
                    contents: [{
                        uri,
                        mimeType: "image/png",
                        blob: base64Data
                    }]
                };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                throw new McpError(
                    ErrorCode.InternalError,
                    `Failed to read screenshot: ${errorMessage}`
                );
            }
        }

        // Handle unknown resource types
        throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${uri}`
        );
    });
}