import { ListResourcesRequestSchema, ReadResourceRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getCurrentSession, getResult } from "../services/session.js";
import { promises as fs } from 'fs';
import { Logger } from '../utils/logger.js';
const logger = new Logger('ResourceHandler');
export function registerResourceHandlers(server) {
    // List available resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const currentSession = getCurrentSession();
        const resources = [];
        if (currentSession?.results) {
            currentSession.results.forEach((_result, index) => {
                resources.push({
                    uri: `research://screenshots/${index}`,
                    name: `Screenshot ${index + 1}`,
                    mimeType: 'image/png',
                    description: `Screenshot from research result ${index + 1}`
                });
            });
        }
        return {
            resources
        };
    });
    // Read specific resource
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;
        const match = uri.match(/^research:\/\/screenshots\/(\d+)$/);
        if (!match) {
            throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
        }
        const index = parseInt(match[1], 10);
        const currentSession = getCurrentSession();
        if (!currentSession) {
            throw new McpError(ErrorCode.InvalidRequest, "No active research session");
        }
        const result = getResult(currentSession.id, index);
        if (!result?.screenshotPath) {
            throw new McpError(ErrorCode.InvalidRequest, `No screenshot available at index: ${index}`);
        }
        try {
            const imageBuffer = await fs.readFile(result.screenshotPath);
            const base64Image = imageBuffer.toString('base64');
            return {
                contents: [{
                        uri,
                        mimeType: 'image/png',
                        base64: base64Image
                    }]
            };
        }
        catch (error) {
            logger.error('Failed to read screenshot:', error);
            throw new McpError(ErrorCode.InternalError, `Failed to read screenshot: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
}
//# sourceMappingURL=resources.js.map