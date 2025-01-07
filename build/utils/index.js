import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BROWSER_CONFIG, SECURITY_CONFIG } from "../config/index.js";
import { Logger } from "./logger.js";
const logger = new Logger('Utils');
/**
 * Generic retry mechanism for handling transient failures
 * @param operation Operation to retry
 * @param maxRetries Number of retry attempts (default: from BROWSER_CONFIG)
 * @param delay Delay between retries in ms (default: from BROWSER_CONFIG)
 */
export async function withRetry(operation, maxRetries = BROWSER_CONFIG.maxRetries, delay = BROWSER_CONFIG.retryDelay) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms:`, lastError);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    if (!lastError) {
        lastError = new Error('Unknown error occurred during retry');
    }
    throw lastError;
}
/**
 * Validate URL format and ensure security constraints
 * @param urlString URL to validate
 * @returns boolean indicating if URL is valid
 */
export function isValidUrl(urlString) {
    try {
        if (urlString.length > SECURITY_CONFIG.maxUrlLength) {
            return false;
        }
        const url = new URL(urlString);
        return SECURITY_CONFIG.allowedProtocols.includes(url.protocol);
    }
    catch {
        return false;
    }
}
/**
 * Generate a safe filename from a title
 * @param title Original title
 * @param timestamp Timestamp to append
 * @returns Safe filename
 */
export function generateSafeFilename(title, timestamp) {
    const safeTitle = title
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return `${safeTitle}-${timestamp}.png`;
}
/**
 * Handle errors with proper MCP error formatting
 * @param error Error to handle
 * @param context Error context
 * @returns Formatted MCP error
 */
export function handleError(error, context) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new McpError(ErrorCode.InternalError, `${context}: ${errorMessage}`);
}
/**
 * Type guard for checking if a value is defined
 */
export function isDefined(value) {
    return value !== null && value !== undefined;
}
/**
 * Type guard for checking if a value is a string
 */
export function isString(value) {
    return typeof value === 'string';
}
/**
 * Type guard for checking if a value is a number
 */
export function isNumber(value) {
    return typeof value === 'number' && !isNaN(value);
}
/**
 * Type guard for checking if a value is a boolean
 */
export function isBoolean(value) {
    return typeof value === 'boolean';
}
/**
 * Type guard for checking if a value is a plain object
 */
export function isPlainObject(value) {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
/**
 * Sanitize a string for safe usage
 * @param input String to sanitize
 * @param maxLength Maximum length (optional)
 */
export function sanitizeString(input, maxLength) {
    const sanitized = input
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
    return maxLength ? sanitized.slice(0, maxLength) : sanitized;
}
/**
 * Ensure a number is within bounds
 * @param value Number to clamp
 * @param min Minimum value
 * @param max Maximum value
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
/**
 * Create a debounced version of a function
 * @param func Function to debounce
 * @param wait Wait time in milliseconds
 */
export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}
/**
 * Create a throttled version of a function
 * @param func Function to throttle
 * @param limit Time limit in milliseconds
 */
export function throttle(func, limit) {
    let inThrottle = false;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
//# sourceMappingURL=index.js.map