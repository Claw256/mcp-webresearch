import * as path from 'path';
import * as os from 'os';

// Server configuration
export const SERVER_CONFIG = {
    maxConcurrentBrowsers: 3,
    maxSessionsPerUser: 5,
    maxRequestsPerMinute: 60,
    screenshotDir: path.join(os.tmpdir(), 'mcp-webresearch-screenshots'),
    screenshotRetentionHours: 24,
    maxScreenshotSizeBytes: 5 * 1024 * 1024, // 5MB
    maxTotalScreenshotStorageBytes: 100 * 1024 * 1024, // 100MB
};

// Browser configuration
export const BROWSER_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    navigationTimeout: 60000,  // Doubled to handle consent dialogs
    networkIdleTimeout: 15000, // Increased for slower connections
    minContentWords: 10,
    maxPageLoadTime: 60000,
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
    }
};

// Regions that commonly show consent dialogs
export const CONSENT_REGIONS = [
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