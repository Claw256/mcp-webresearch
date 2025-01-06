import { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const MAX_RESULTS_PER_SESSION = 100;
export declare const MAX_RETRIES = 3;
export declare const RETRY_DELAY = 1000;
export declare const TOOLS: Tool[];
export declare const PROMPTS: {
    readonly "agentic-research": {
        readonly name: "agentic-research";
        readonly description: "Conduct iterative web research on a topic, exploring it thoroughly through multiple steps while maintaining a dialogue with the user";
        readonly arguments: readonly [{
            readonly name: "topic";
            readonly description: "The topic or question to research";
            readonly required: true;
        }];
    };
};
export declare const CONSENT_REGIONS: string[];
