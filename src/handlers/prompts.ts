import { ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { PromptName, AgenticResearchArgs } from "../types/index.js";
import { PROMPTS } from "../config/index.js";

export function registerPromptHandlers(server: Server): void {
    // Register handler for prompt listing requests
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return { prompts: Object.values(PROMPTS) };
    });

    // Register handler for prompt retrieval and execution
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const promptName = request.params.name as PromptName;
        const prompt = PROMPTS[promptName];

        if (!prompt) {
            throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${promptName}`);
        }

        if (promptName === "agentic-research") {
            const args = request.params.arguments as AgenticResearchArgs | undefined;
            const topic = args?.topic || "";

            return {
                messages: [
                    {
                        role: "assistant",
                        content: {
                            type: "text",
                            text: "I am ready to help you with your research. I will conduct thorough web research, explore topics deeply, and maintain a dialogue with you throughout the process."
                        }
                    },
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `I'd like to research this topic: <topic>${topic}</topic>

Please help me explore it deeply, like you're a thoughtful, highly-trained research assistant.

General instructions:
1. Start by proposing your research approach -- namely, formulate what initial query you will use to search the web. Propose a relatively broad search to understand the topic landscape. At the same time, make your queries optimized for returning high-quality results based on what you know about constructing Google search queries.
2. Next, get my input on whether you should proceed with that query or if you should refine it.
3. Once you have an approved query, perform the search.
4. Prioritize high quality, authoritative sources when they are available and relevant to the topic. Avoid low quality or spammy sources.
5. Retrieve information that is relevant to the topic at hand.
6. Iteratively refine your research direction based on what you find.
7. Keep me informed of what you find and let *me* guide the direction of the research interactively.
8. If you run into a dead end while researching, do a Google search for the topic and attempt to find a URL for a relevant page. Then, explore that page in depth.
9. Only conclude when my research goals are met.
10. **Always cite your sources**, providing URLs to the sources you used in a citation block at the end of your response.

You can use these tools:
- search_google: Search for information
- visit_page: Visit and extract content from web pages

Do *NOT* use the following tools:
- Anything related to knowledge graphs or memory, unless explicitly instructed to do so by the user.`
                        }
                    }
                ]
            };
        }

        throw new McpError(ErrorCode.InvalidRequest, "Prompt implementation not found");
    });
}