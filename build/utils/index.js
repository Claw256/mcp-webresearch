import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { MAX_RETRIES, RETRY_DELAY } from "../config/index.js";
// Generic retry mechanism for handling transient failures
export async function withRetry(operation, // Operation to retry
retries = MAX_RETRIES, // Number of retry attempts
delay = RETRY_DELAY // Delay between retries
) {
    let lastError;
    // Attempt operation up to max retries
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (i < retries - 1) {
                console.error(`Attempt ${i + 1} failed, retrying in ${delay}ms:`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError; // Throw last error if all retries failed
}
// Validate URL format and ensure security constraints
export function isValidUrl(urlString) {
    try {
        // Attempt to parse URL string
        const url = new URL(urlString);
        // Only allow HTTP and HTTPS protocols for security
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        // Return false for any invalid URL format
        return false;
    }
}
// Generate a safe filename from a title
export function generateSafeFilename(title, timestamp) {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return `${safeTitle}-${timestamp}.png`;
}
// Handle errors with proper MCP error formatting
export function handleError(error, context) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new McpError(ErrorCode.InternalError, `${context}: ${errorMessage}`);
}
//# sourceMappingURL=index.js.map