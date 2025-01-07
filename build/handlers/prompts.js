import { ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { Logger } from '../utils/logger.js';
const logger = new Logger('PromptHandler');
const PROMPTS = {
    "agentic-research": {
        name: "agentic-research",
        description: "Perform autonomous web research on a given topic",
        inputSchema: {
            type: "object",
            properties: {
                topic: {
                    type: "string",
                    description: "Research topic to investigate"
                }
            },
            required: ["topic"]
        }
    }
};
export function registerPromptHandlers(server) {
    // List available prompts
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return {
            prompts: Object.values(PROMPTS)
        };
    });
    // Get specific prompt
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const promptName = request.params.name;
        const prompt = PROMPTS[promptName];
        if (!prompt) {
            logger.error(`Prompt not found: ${promptName}`);
            throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${promptName}`);
        }
        return {
            prompt
        };
    });
}
//# sourceMappingURL=prompts.js.map