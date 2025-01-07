import { 
    ListPromptsRequestSchema, 
    GetPromptRequestSchema, 
    McpError, 
    ErrorCode 
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { PromptName } from "../types/index.js";
import { Logger } from '../utils/logger.js';

const logger = new Logger('PromptHandler');

interface Prompt {
    name: PromptName;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required: string[];
    };
}

interface PromptResponse {
    prompts: Prompt[];
}

const PROMPTS: Record<PromptName, Prompt> = {
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

export function registerPromptHandlers(server: Server): void {
    // List available prompts
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return {
            prompts: Object.values(PROMPTS)
        } satisfies PromptResponse;
    });

    // Get specific prompt
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const promptName = request.params.name as PromptName;
        const prompt = PROMPTS[promptName];

        if (!prompt) {
            logger.error(`Prompt not found: ${promptName}`);
            throw new McpError(
                ErrorCode.InvalidRequest, 
                `Prompt not found: ${promptName}`
            );
        }

        return {
            prompt
        };
    });
}