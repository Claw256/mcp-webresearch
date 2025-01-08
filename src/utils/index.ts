import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BROWSER_CONFIG, SECURITY_CONFIG } from "../config/index.js";
import { Logger } from "./logger.js";

const logger = new Logger('Utils');

class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TimeoutError';
    }
}

const NON_RETRYABLE_ERRORS = [
    'timeout',
    'timed out',
    'Session closed',
    'Target closed',
    'Browser has been closed',
    'Navigation failed',
    'ERR_CONNECTION_TIMED_OUT',
    'net::ERR_CONNECTION_TIMED_OUT',
    'net::ERR_CONNECTION_CLOSED',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_CONNECTION_REFUSED',
    'net::ERR_NAME_NOT_RESOLVED'
];

/**
 * Generic retry mechanism for handling transient failures
 * @param operation Operation to retry
 * @param maxRetries Number of retry attempts (default: from BROWSER_CONFIG)
 * @param delay Delay between retries in ms (default: from BROWSER_CONFIG)
 * @param timeout Optional timeout in ms
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = BROWSER_CONFIG.maxRetries,
    delay: number = BROWSER_CONFIG.initialRetryDelay,
    timeout?: number
): Promise<T> {
    let lastError: Error | undefined;
    let timeoutId: NodeJS.Timeout | undefined;

    try {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const operationPromise = operation();

                if (timeout) {
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        timeoutId = setTimeout(() => {
                            timeoutId = undefined;
                            reject(new TimeoutError('Operation timed out'));
                        }, timeout);
                    });

                    try {
                        return await Promise.race([operationPromise, timeoutPromise]);
                    } finally {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = undefined;
                        }
                    }
                } else {
                    return await operationPromise;
                }
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                // Check for non-retryable errors
                if (lastError instanceof TimeoutError || 
                    NON_RETRYABLE_ERRORS.some(msg => lastError!.message.toLowerCase().includes(msg.toLowerCase()))) {
                    logger.error('Non-retryable error encountered:', lastError);
                    throw new McpError(ErrorCode.InternalError, `Operation failed: ${lastError.message}`);
                }
                
                if (attempt < maxRetries) {
                    // Use exponential backoff with jitter
                    const jitter = Math.random() * 1000;
                    const backoffDelay = Math.min(delay * Math.pow(2, attempt - 1) + jitter, BROWSER_CONFIG.maxRetryDelay);
                    
                    logger.warn(`Attempt ${attempt} failed, retrying in ${backoffDelay}ms:`, lastError);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                }
            }
        }

        throw lastError || new Error('Unknown error occurred during retry');
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

/**
 * Execute an operation with a timeout
 * @param operation Operation to execute
 * @param timeout Timeout in milliseconds
 */
export async function withTimeout<T>(
    operation: () => Promise<T>,
    timeout: number
): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    try {
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                timeoutId = undefined;
                reject(new TimeoutError('Operation timed out'));
            }, timeout);
        });

        return await Promise.race([operation(), timeoutPromise]);
    } catch (error) {
        if (error instanceof TimeoutError) {
            throw new McpError(ErrorCode.InternalError, 'Operation timed out');
        }
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

/**
 * Validate URL format and ensure security constraints
 * @param urlString URL to validate
 * @returns boolean indicating if URL is valid
 */
export function isValidUrl(urlString: string): boolean {
    try {
        if (urlString.length > SECURITY_CONFIG.maxUrlLength) {
            return false;
        }

        const url = new URL(urlString);
        return SECURITY_CONFIG.allowedProtocols.includes(url.protocol);
    } catch {
        return false;
    }
}

/**
 * Generate a safe filename from a title
 * @param title Original title
 * @param timestamp Timestamp to append
 * @returns Safe filename
 */
export function generateSafeFilename(title: string, timestamp: number): string {
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
export function handleError(error: unknown, context: string): McpError {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new McpError(
        ErrorCode.InternalError,
        `${context}: ${errorMessage}`
    );
}

/**
 * Type guard for checking if a value is defined
 */
export function isDefined<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

/**
 * Type guard for checking if a value is a string
 */
export function isString(value: unknown): value is string {
    return typeof value === 'string';
}

/**
 * Type guard for checking if a value is a number
 */
export function isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard for checking if a value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

/**
 * Type guard for checking if a value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
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
export function sanitizeString(input: string, maxLength?: number): string {
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
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Create a debounced version of a function
 * @param func Function to debounce
 * @param wait Wait time in milliseconds
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    
    return function(this: unknown, ...args: Parameters<T>): void {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Create a throttled version of a function
 * @param func Function to throttle
 * @param limit Time limit in milliseconds
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
    func: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;
    
    return function(this: unknown, ...args: Parameters<T>): void {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}