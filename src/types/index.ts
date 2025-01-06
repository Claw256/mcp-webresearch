import { TextContent, ImageContent } from "@modelcontextprotocol/sdk/types.js";

// Core interfaces for research data management
export interface ResearchResult {
    url: string;             // URL of the researched page
    title: string;           // Page title
    content: string;         // Extracted content in markdown
    timestamp: string;       // When the result was captured
    screenshotPath?: string; // Path to screenshot file on disk
}

// Define structure for research session data
export interface ResearchSession {
    query: string;              // Search query that initiated the session
    results: ResearchResult[];  // Collection of research results
    lastUpdated: string;        // Timestamp of last update
}

// Define available prompt types for type safety
export type PromptName = "agentic-research";

// Define structure for research prompt arguments
export interface AgenticResearchArgs {
    topic: string;  // Research topic provided by user
}

// Tool response type definition
export interface ToolResponse {
    _meta?: Record<string, unknown>;
    content: Array<TextContent | ImageContent>;
    isError?: boolean;
}

// Search result type
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

// Page result type
export interface PageResult {
    pageResult: ResearchResult;
    screenshotUri?: string;
}

// Tool handler response type
export type ToolHandlerResponse = Promise<{
    _meta?: Record<string, unknown>;
    content: Array<TextContent | ImageContent>;
    isError?: boolean;
}>