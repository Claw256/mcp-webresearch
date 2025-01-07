import * as path from 'path';
import * as os from 'os';

// Server configuration
export const SERVER_CONFIG = {
    maxConcurrentBrowsers: 1, // Reduced to prevent resource contention
    maxSessionsPerUser: 5,
    maxRequestsPerMinute: 60,
    screenshotDir: path.join(os.tmpdir(), 'mcp-webresearch-screenshots'),
    screenshotRetentionHours: 24,
    maxScreenshotSizeBytes: 5 * 1024 * 1024, // 5MB
    maxTotalScreenshotStorageBytes: 100 * 1024 * 1024, // 100MB
};

// Browser configuration
export const BROWSER_CONFIG = {
    maxRetries: 2, // Further reduced for faster failure
    initialRetryDelay: 500, // Shorter initial delay
    maxRetryDelay: 2000, // Shorter maximum delay
    navigationTimeout: 15000, // Reduced to 15s
    networkIdleTimeout: 5000, // Reduced to 5s
    minContentWords: 10,
    maxPageLoadTime: 20000, // Reduced to 20s
    resourceTimeout: 5000, // Reduced to 5s
    maxMemoryMB: 512, // Reduced memory limit
    healthCheckInterval: 10000, // More frequent health checks
    gcInterval: 60000, // More frequent garbage collection
};

// Performance thresholds
export const PERFORMANCE_CONFIG = {
    cpuUsageThreshold: 70, // Lower threshold
    memoryUsageThreshold: 70, // Lower threshold
    slowRequestThreshold: 3000, // Reduced threshold
    criticalRequestThreshold: 10000, // Reduced threshold
    maxQueueSize: 1, // Only allow one request at a time
    queueTimeoutMs: 15000, // Reduced queue timeout
};

// Circuit breaker configuration
export const CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 2, // Reduced threshold
    resetTimeout: 15000, // Shorter reset time
    halfOpenMaxRequests: 1, // More conservative
    monitoringInterval: 5000, // More frequent monitoring
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
    allowedDomains: ['*'],
    maxUrlLength: 2048,
    rateLimitWindowMs: 60000,
    sanitizeOptions: {
        allowedTags: ['b', 'i', 'em', 'strong', 'a'],
        allowedAttributes: {
            'a': ['href']
        }
    },
    maxRedirects: 2, // Reduced redirects
    requestTimeout: 15000, // Reduced timeout
    maxResponseSize: 5 * 1024 * 1024, // Reduced to 5MB
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