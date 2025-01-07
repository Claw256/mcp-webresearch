import { TextContent, ImageContent } from "@modelcontextprotocol/sdk/types.js";
export interface ResearchResult {
    url: string;
    title: string;
    content: string;
    timestamp: string;
    screenshotPath?: string;
}
export interface ResearchSession {
    id?: string;
    query: string;
    results: ResearchResult[];
    lastUpdated: string;
}
export type PromptName = "agentic-research";
export interface AgenticResearchArgs {
    topic: string;
}
export interface ToolResponse {
    _meta?: Record<string, unknown>;
    content: Array<TextContent | ImageContent>;
    isError?: boolean;
}
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}
export interface PageResult {
    pageResult: ResearchResult;
    screenshotUri?: string;
}
export type ToolHandlerResponse = Promise<{
    _meta?: Record<string, unknown>;
    content: Array<TextContent | ImageContent>;
    isError?: boolean;
}>;
