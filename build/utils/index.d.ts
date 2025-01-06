import { McpError } from "@modelcontextprotocol/sdk/types.js";
export declare function withRetry<T>(operation: () => Promise<T>, // Operation to retry
retries?: number, // Number of retry attempts
delay?: number): Promise<T>;
export declare function isValidUrl(urlString: string): boolean;
export declare function generateSafeFilename(title: string, timestamp: number): string;
export declare function handleError(error: unknown, context: string): McpError;
