export declare const SERVER_CONFIG: {
    maxConcurrentBrowsers: number;
    maxSessionsPerUser: number;
    maxRequestsPerMinute: number;
    screenshotDir: string;
    screenshotRetentionHours: number;
    maxScreenshotSizeBytes: number;
    maxTotalScreenshotStorageBytes: number;
};
export declare const BROWSER_CONFIG: {
    maxRetries: number;
    retryDelay: number;
    navigationTimeout: number;
    networkIdleTimeout: number;
    minContentWords: number;
    maxPageLoadTime: number;
};
export declare const SESSION_CONFIG: {
    maxResultsPerSession: number;
    maxSessionAgeHours: number;
    maxContentSizeBytes: number;
};
export declare const SECURITY_CONFIG: {
    allowedProtocols: string[];
    allowedDomains: string[];
    maxUrlLength: number;
    rateLimitWindowMs: number;
    sanitizeOptions: {
        allowedTags: string[];
        allowedAttributes: {
            a: string[];
        };
    };
};
export declare const CONSENT_REGIONS: string[];
