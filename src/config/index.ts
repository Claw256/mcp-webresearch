import * as path from 'path';
import * as os from 'os';

// Server configuration
export const SERVER_CONFIG = {
    maxConcurrentBrowsers: 5, // Increased for better concurrency
    maxSessionsPerUser: 5,
    maxRequestsPerMinute: 60,
    screenshotDir: path.join(os.tmpdir(), 'mcp-webresearch-screenshots'),
    screenshotRetentionHours: 24,
    maxScreenshotSizeBytes: 5 * 1024 * 1024, // 5MB
    maxTotalScreenshotStorageBytes: 100 * 1024 * 1024, // 100MB
};

// Browser configuration
export const BROWSER_CONFIG = {
    maxRetries: 3, // Reduced to fail faster
    initialRetryDelay: 1000, // Base delay for exponential backoff
    maxRetryDelay: 10000, // Maximum retry delay
    navigationTimeout: 30000, // Reduced to 30s for faster failure
    networkIdleTimeout: 15000, // Reduced to 15s
    minContentWords: 10,
    maxPageLoadTime: 45000, // Reduced to 45s
    resourceTimeout: 10000, // New: timeout for individual resources
    maxMemoryMB: 1024, // New: memory limit per browser instance
    healthCheckInterval: 30000, // New: health check interval
    gcInterval: 300000, // New: garbage collection interval
};

// Performance thresholds
export const PERFORMANCE_CONFIG = {
    // New configuration section
    cpuUsageThreshold: 80, // Percentage
    memoryUsageThreshold: 80, // Percentage
    slowRequestThreshold: 5000, // ms
    criticalRequestThreshold: 15000, // ms
    maxQueueSize: 100,
    queueTimeoutMs: 30000,
};

// Circuit breaker configuration
export const CIRCUIT_BREAKER_CONFIG = {
    // New configuration section
    failureThreshold: 5, // Number of failures before opening
    resetTimeout: 30000, // Time before attempting to close circuit
    halfOpenMaxRequests: 3, // Max requests in half-open state
    monitoringInterval: 10000, // Health check interval
};

// Session configuration
export const SESSION_CONFIG = {
    maxResultsPerSession: 100,
    maxSessionAgeHours: 24,
    maxContentSizeBytes: 1024 * 1024, // 1MB per content item
};

// Security configuration
export const SECURITY_CONFIG = {
    allowedProtocols: ['http:', 'https:'],
    allowedDomains: ['*'], // Can be restricted if needed
    maxUrlLength: 2048,
    rateLimitWindowMs: 60000,
    sanitizeOptions: {
        allowedTags: ['b', 'i', 'em', 'strong', 'a'],
        allowedAttributes: {
            'a': ['href']
        }
    },
    // New security settings
    maxRedirects: 5,
    requestTimeout: 30000,
    maxResponseSize: 10 * 1024 * 1024, // 10MB
};

// Regions that commonly show consent dialogs
export const CONSENT_REGIONS = [
    'google.com',     // Default Google domain - always include
    'google.co.uk',
    'google.de',
    'google.fr',
    'google.it',
    'google.es',
    'google.nl',
    'google.pl',
    'google.ie',
    'google.dk',
    'google.se',
    'google.no',
    'google.fi',
    'google.pt',
    'google.ch',
    'google.at',
    'google.be'
];