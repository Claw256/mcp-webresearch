import { McpError } from "@modelcontextprotocol/sdk/types.js";
/**
 * Generic retry mechanism for handling transient failures
 * @param operation Operation to retry
 * @param maxRetries Number of retry attempts (default: from BROWSER_CONFIG)
 * @param delay Delay between retries in ms (default: from BROWSER_CONFIG)
 */
export declare function withRetry<T>(operation: () => Promise<T>, maxRetries?: number, delay?: number): Promise<T>;
/**
 * Validate URL format and ensure security constraints
 * @param urlString URL to validate
 * @returns boolean indicating if URL is valid
 */
export declare function isValidUrl(urlString: string): boolean;
/**
 * Generate a safe filename from a title
 * @param title Original title
 * @param timestamp Timestamp to append
 * @returns Safe filename
 */
export declare function generateSafeFilename(title: string, timestamp: number): string;
/**
 * Handle errors with proper MCP error formatting
 * @param error Error to handle
 * @param context Error context
 * @returns Formatted MCP error
 */
export declare function handleError(error: unknown, context: string): McpError;
/**
 * Type guard for checking if a value is defined
 */
export declare function isDefined<T>(value: T | null | undefined): value is T;
/**
 * Type guard for checking if a value is a string
 */
export declare function isString(value: unknown): value is string;
/**
 * Type guard for checking if a value is a number
 */
export declare function isNumber(value: unknown): value is number;
/**
 * Type guard for checking if a value is a boolean
 */
export declare function isBoolean(value: unknown): value is boolean;
/**
 * Type guard for checking if a value is a plain object
 */
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
/**
 * Sanitize a string for safe usage
 * @param input String to sanitize
 * @param maxLength Maximum length (optional)
 */
export declare function sanitizeString(input: string, maxLength?: number): string;
/**
 * Ensure a number is within bounds
 * @param value Number to clamp
 * @param min Minimum value
 * @param max Maximum value
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Create a debounced version of a function
 * @param func Function to debounce
 * @param wait Wait time in milliseconds
 */
export declare function debounce<T extends (...args: unknown[]) => unknown>(func: T, wait: number): (...args: Parameters<T>) => void;
/**
 * Create a throttled version of a function
 * @param func Function to throttle
 * @param limit Time limit in milliseconds
 */
export declare function throttle<T extends (...args: unknown[]) => unknown>(func: T, limit: number): (...args: Parameters<T>) => void;
