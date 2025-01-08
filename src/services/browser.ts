import { chromium, Browser, Page, BrowserContext } from 'patchright';
import {
    BROWSER_CONFIG,
    CONSENT_REGIONS,
    SECURITY_CONFIG,
    SERVER_CONFIG,
    CIRCUIT_BREAKER_CONFIG,
    PERFORMANCE_CONFIG
} from '../config/index.js';
import { Logger } from '../utils/logger.js';
import { withTimeout } from "../utils/index.js";

interface ValidationResult {
    isValid: boolean;
    error?: string;
}

interface BrowserInstance {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    lastUsed: number;
    memoryUsage: number;
    failureCount: number;
}

interface CircuitBreaker {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    lastFailure: number;
    lastSuccess: number;
}

class BrowserPool {
    private static instance: BrowserPool;
    private pool: BrowserInstance[] = [];
    private logger: Logger;
    private circuitBreaker: CircuitBreaker;
    private requestQueue: Array<{ resolve: (page: Page) => void; reject: (error: Error) => void; timestamp: number }> = [];
    private maintenanceInterval?: NodeJS.Timeout;
    private circuitBreakerInterval?: NodeJS.Timeout;
    private performanceInterval?: NodeJS.Timeout;

    private constructor() {
        this.logger = new Logger('BrowserPool');
        this.circuitBreaker = {
            state: 'CLOSED',
            failures: 0,
            lastFailure: 0,
            lastSuccess: Date.now()
        };
        this.startMaintenanceInterval();
        this.startCircuitBreakerMonitoring();
        this.startPerformanceMonitoring();
    }

    static getInstance(): BrowserPool {
        if (!BrowserPool.instance) {
            BrowserPool.instance = new BrowserPool();
        }
        return BrowserPool.instance;
    }

    private async createBrowserInstance(): Promise<BrowserInstance> {
        try {
            // Use patchright's undetected mode with recommended settings
            const browser = await chromium.launch({
                channel: 'chrome',
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    `--js-flags=--max-old-space-size=${BROWSER_CONFIG.maxMemoryMB}`
                ]
            });

            // Use patchright's recommended context settings
            const context = await browser.newContext({
                viewport: null,
                ignoreHTTPSErrors: true,
                bypassCSP: true,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                permissions: ['geolocation'],
                colorScheme: 'light'
            });

            context.setDefaultTimeout(BROWSER_CONFIG.navigationTimeout);
            context.setDefaultNavigationTimeout(BROWSER_CONFIG.navigationTimeout);

            await context.route('**/*', async (route) => {
                const request = route.request();
                const resourceType = request.resourceType();

                if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
                    return route.abort();
                }

                await withTimeout(
                    () => route.continue(),
                    BROWSER_CONFIG.resourceTimeout
                ).catch(() => route.abort('timedout'));
            });

            const page = await context.newPage();

            page.on('pageerror', (error) => {
                this.logger.error('Page error:', error);
            });

            page.on('console', (msg) => {
                if (msg.type() === 'error' || msg.type() === 'warning') {
                    this.logger.warn('Console message:', msg.text());
                }
            });

            return {
                browser,
                context,
                page,
                lastUsed: Date.now(),
                memoryUsage: 0,
                failureCount: 0
            };
        } catch (error) {
            this.logger.error('Failed to create browser instance:', error);
            throw error;
        }
    }

    private async updateCircuitBreaker(success: boolean) {
        const now = Date.now();

        if (success) {
            if (this.circuitBreaker.state === 'HALF_OPEN') {
                this.circuitBreaker.state = 'CLOSED';
                this.circuitBreaker.failures = 0;
            }
            this.circuitBreaker.lastSuccess = now;
            return;
        }

        this.circuitBreaker.failures++;
        this.circuitBreaker.lastFailure = now;

        if (this.circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
            this.circuitBreaker.state = 'OPEN';
            this.logger.warn('Circuit breaker opened due to consecutive failures');
        }
    }

    private startCircuitBreakerMonitoring() {
        this.circuitBreakerInterval = setInterval(() => {
            const now = Date.now();
            if (
                this.circuitBreaker.state === 'OPEN' &&
                now - this.circuitBreaker.lastFailure > CIRCUIT_BREAKER_CONFIG.resetTimeout
            ) {
                this.circuitBreaker.state = 'HALF_OPEN';
                this.circuitBreaker.failures = 0;
                this.logger.info('Circuit breaker entering half-open state');
            }
        }, CIRCUIT_BREAKER_CONFIG.monitoringInterval);
    }

    private startPerformanceMonitoring() {
        this.performanceInterval = setInterval(async () => {
            for (const instance of this.pool) {
                try {
                    if (instance.page.isClosed()) continue;

                    const metrics = await instance.page.evaluate(() => ({
                        memory: (performance as any).memory?.usedJSHeapSize || 0,
                        timing: performance.timing
                    }));

                    instance.memoryUsage = metrics.memory;

                    if (instance.memoryUsage > BROWSER_CONFIG.maxMemoryMB * 1024 * 1024) {
                        this.logger.warn('Memory threshold exceeded, recycling instance');
                        await this.recycleBrowserInstance(instance);
                    }
                } catch (error) {
                    this.logger.error('Performance monitoring error:', error);
                    instance.failureCount++;
                }
            }
        }, BROWSER_CONFIG.healthCheckInterval);
    }

    async acquirePage(): Promise<Page> {
        try {
            if (this.circuitBreaker.state === 'OPEN') {
                throw new Error('Circuit breaker is open, requests are blocked');
            }

            if (this.requestQueue.length >= PERFORMANCE_CONFIG.maxQueueSize) {
                throw new Error('Request queue is full');
            }

            const page = await withTimeout(
                () => new Promise<Page>((resolve, reject) => {
                    const queueEntry = { resolve, reject, timestamp: Date.now() };
                    this.requestQueue.push(queueEntry);
                    this.processQueue();
                }),
                PERFORMANCE_CONFIG.queueTimeoutMs
            );

            await this.updateCircuitBreaker(true);
            return page;
        } catch (error) {
            await this.updateCircuitBreaker(false);
            throw error;
        }
    }

    private async processQueue() {
        if (this.requestQueue.length === 0) return;

        try {
            await this.cleanupExpiredInstances();

            let instance = this.pool.find(inst => {
                try {
                    return !inst.page.isClosed() && inst.failureCount < 3;
                } catch {
                    return false;
                }
            });

            if (!instance && this.pool.length < SERVER_CONFIG.maxConcurrentBrowsers) {
                instance = await this.createBrowserInstance();
                this.pool.push(instance);
            } else if (!instance) {
                const oldestInstance = this.pool.reduce((oldest, current) =>
                    current.lastUsed < oldest.lastUsed ? current : oldest
                );
                await this.recycleBrowserInstance(oldestInstance);
                instance = oldestInstance;
            }

            instance.lastUsed = Date.now();
            const queueEntry = this.requestQueue.shift();
            if (queueEntry) {
                queueEntry.resolve(instance.page);
            }
        } catch (error) {
            const queueEntry = this.requestQueue.shift();
            if (queueEntry) {
                queueEntry.reject(error as Error);
            }
            this.logger.error('Failed to process queue:', error instanceof Error ? error.message : String(error));
        }
    }

    private async recycleBrowserInstance(instance: BrowserInstance): Promise<void> {
        try {
            if (!instance.page.isClosed()) {
                await instance.page.close();
            }

            const context = instance.context;
            await context.clearCookies();
            await context.clearPermissions();

            const page = await context.newPage();
            instance.page = page;
            instance.lastUsed = Date.now();
            instance.failureCount = 0;
            instance.memoryUsage = 0;
        } catch (error) {
            this.logger.error('Failed to recycle browser instance:', error);
            try {
                const newInstance = await this.createBrowserInstance();
                const index = this.pool.indexOf(instance);
                if (index !== -1) {
                    await this.cleanupInstance(instance);
                    this.pool[index] = newInstance;
                }
            } catch (recycleError) {
                this.logger.error('Failed to create new instance during recycle:', recycleError);
                throw recycleError;
            }
        }
    }

    private async cleanupInstance(instance: BrowserInstance): Promise<void> {
        try {
            await instance.context.close();
            await instance.browser.close();
        } catch (error) {
            this.logger.error('Error during instance cleanup:', error);
        }
    }

    private async cleanupExpiredInstances(): Promise<void> {
        const now = Date.now();
        const expirationTime = BROWSER_CONFIG.maxPageLoadTime * 2;

        for (let i = this.pool.length - 1; i >= 0; i--) {
            const instance = this.pool[i];
            if (
                now - instance.lastUsed > expirationTime ||
                instance.failureCount >= 3 ||
                instance.memoryUsage > BROWSER_CONFIG.maxMemoryMB * 1024 * 1024
            ) {
                await this.cleanupInstance(instance);
                this.pool.splice(i, 1);
            }
        }
    }

    private startMaintenanceInterval(): void {
        this.maintenanceInterval = setInterval(() => {
            this.cleanupExpiredInstances().catch(error => {
                this.logger.error('Error during maintenance cleanup:', error);
            });
        }, BROWSER_CONFIG.gcInterval);
    }

    async cleanup(): Promise<void> {
        try {
            if (this.maintenanceInterval) clearInterval(this.maintenanceInterval);
            if (this.circuitBreakerInterval) clearInterval(this.circuitBreakerInterval);
            if (this.performanceInterval) clearInterval(this.performanceInterval);

            await Promise.all(this.pool.map(instance => this.cleanupInstance(instance)));
            this.pool = [];
        } catch (error) {
            this.logger.error('Error during pool cleanup:', error);
            throw error;
        }
    }
}

export async function cleanupPage(page: Page): Promise<void> {
    try {
        if (!page.isClosed()) {
            await page.close();
        }
    } catch (error) {
        const logger = new Logger('BrowserService');
        logger.error('Failed to cleanup page:', error);
    }
}

export async function ensureBrowser(): Promise<Page> {
    return await BrowserPool.getInstance().acquirePage();
}

export async function cleanupBrowser(): Promise<void> {
    await BrowserPool.getInstance().cleanup();
}

export async function safePageNavigation(page: Page, url: string): Promise<void> {
    const logger = new Logger('Navigation');

    try {
        const parsedUrl = new URL(url);
        if (!SECURITY_CONFIG.allowedProtocols.includes(parsedUrl.protocol)) {
            throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
        }

        if (url.length > SECURITY_CONFIG.maxUrlLength) {
            throw new Error('URL exceeds maximum length');
        }

        const domain = parsedUrl.hostname;
        const consentCookies = [];

        consentCookies.push({
            name: 'CONSENT',
            value: 'YES+cb.20240107-11-p0.en+FX',
            domain: '.google.com',
            path: '/'
        });

        if (CONSENT_REGIONS.some(region => domain.includes(region)) && domain !== 'google.com') {
            const specificDomain = `.${domain}`;
            const generalDomain = `.${domain.split('.').slice(-2).join('.')}`;
            
            consentCookies.push(
                {
                    name: 'CONSENT',
                    value: 'YES+cb.20240107-11-p0.en+FX',
                    domain: specificDomain,
                    path: '/'
                },
                {
                    name: 'CONSENT',
                    value: 'YES+cb.20240107-11-p0.en+FX',
                    domain: generalDomain,
                    path: '/'
                }
            );
        }

        if (page.isClosed()) {
            throw new Error('Page was closed before navigation');
        }

        await page.context().addCookies(consentCookies);

        let attempts = 0;
        let delay = BROWSER_CONFIG.initialRetryDelay;

        while (attempts < BROWSER_CONFIG.maxRetries) {
            try {
                if (page.isClosed()) {
                    throw new Error('Page was closed during navigation');
                }

                const response = await withTimeout(
                    () => page.goto(url, {
                        waitUntil: 'networkidle',
                        timeout: BROWSER_CONFIG.navigationTimeout
                    }),
                    BROWSER_CONFIG.navigationTimeout
                );

                // Add a small delay to allow for dynamic content
                await page.waitForTimeout(2000);

                if (!response) {
                    throw new Error('Navigation failed: no response received');
                }

                if (response.status() >= 400) {
                    throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
                }

                if (page.isClosed()) {
                    throw new Error('Page was closed during network idle wait');
                }

                // Add delay to allow dynamic content to settle
                await page.waitForTimeout(2000);

                // Perform multiple validation attempts
                let validation;
                for (let i = 0; i < 3; i++) {
                    validation = await validatePage(page);
                    if (validation.isValid) {
                        break;
                    }
                    // If not valid but not explicitly bot protection, wait and retry
                    if (!validation.error?.includes('Bot protection')) {
                        await page.waitForTimeout(1000);
                        continue;
                    }
                    // If bot protection detected, fail immediately
                    throw new Error(validation.error);
                }

                if (!validation?.isValid) {
                    throw new Error(validation?.error || 'Page validation failed');
                }

                const finalUrl = page.url();
                if (finalUrl !== url) {
                    logger.warn(`Page redirected from ${url} to ${finalUrl}`);
                    const finalParsedUrl = new URL(finalUrl);
                    if (!SECURITY_CONFIG.allowedProtocols.includes(finalParsedUrl.protocol)) {
                        throw new Error(`Redirect to unsupported protocol: ${finalParsedUrl.protocol}`);
                    }
                }

                return;
            } catch (error) {
                attempts++;
                const errorMessage = error instanceof Error ? error.message : String(error);
                
                if (attempts >= BROWSER_CONFIG.maxRetries) {
                    logger.error('All navigation attempts failed:', errorMessage);
                    throw new Error(`Navigation failed after ${attempts} attempts: ${errorMessage}`);
                }

                logger.warn(`Navigation attempt ${attempts} failed: ${errorMessage}, retrying...`);
                
                const jitter = Math.random() * 1000;
                delay = Math.min(delay * 2 + jitter, BROWSER_CONFIG.maxRetryDelay);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    } catch (error) {
        logger.error(`Navigation to ${url} failed:`, error);
        throw error;
    }
}

async function validatePage(page: Page): Promise<ValidationResult> {
    if (page.isClosed()) {
        return {
            isValid: false,
            error: 'Page was closed during validation'
        };
    }

    try {
        // First check: Basic static elements
        const staticCheck = await page.evaluate(() => {
            const botProtectionPatterns = {
                selectors: [
                    '#challenge-running', '#cf-challenge-running', '#px-captcha',
                    '#ddos-protection', '#waf-challenge-html', '.ray-id',
                    '#captcha-box', '.g-recaptcha', '#h-captcha',
                    '.turnstile-wrapper', '[class*="captcha"]', '[id*="captcha"]'
                ],
                scripts: [
                    'hcaptcha', 'recaptcha', 'turnstile', 'cloudflare',
                    'perimeterx', 'datadome', 'imperva', 'akamai'
                ]
            };

            // Check for obvious bot protection
            const hasProtection =
                botProtectionPatterns.selectors.some(selector => document.querySelector(selector)) ||
                botProtectionPatterns.scripts.some(script => {
                    const scripts = Array.from(document.getElementsByTagName('script'));
                    return scripts.some(s => s.src && s.src.toLowerCase().includes(script));
                });

            return {
                hasProtection,
                title: document.title.toLowerCase(),
                content: document.body.innerText || ''
            };
        });

        // If obvious bot protection is found, fail fast
        if (staticCheck.hasProtection) {
            return {
                isValid: false,
                error: 'Bot protection or CAPTCHA detected'
            };
        }

        // Second check: Monitor for dynamic changes
        const dynamicCheck = await page.evaluate(async () => {
            let suspiciousChanges = 0;
            
            // Wait and observe DOM changes
            await new Promise<void>(resolve => {
                const observer = new MutationObserver(mutations => {
                    for (const mutation of mutations) {
                        // Only count significant changes
                        if (mutation.type === 'childList' &&
                            (mutation.addedNodes.length > 2 || mutation.removedNodes.length > 2)) {
                            suspiciousChanges++;
                        }
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });

                // Observe for a short period
                setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, 1500);
            });

            return { suspiciousChanges };
        });

        // Check for suspicious patterns
        const suspiciousPhrases = [
            'security check', 'ddos protection', 'please wait',
            'just a moment', 'attention required', 'access denied',
            'verify human', 'bot protection', 'captcha required'
        ];

        const hasSuspiciousTitle = suspiciousPhrases.some(phrase =>
            staticCheck.title.includes(phrase)
        );

        if (hasSuspiciousTitle) {
            return {
                isValid: false,
                error: 'Suspicious page title detected'
            };
        }

        // Check content
        const words = staticCheck.content.trim().split(/\s+/).length;
        if (words < BROWSER_CONFIG.minContentWords) {
            return {
                isValid: false,
                error: `Insufficient content (${words} words)`
            };
        }

        // Check for excessive dynamic changes
        if (dynamicCheck.suspiciousChanges > 5) {
            return {
                isValid: false,
                error: 'Suspicious page behavior detected'
            };
        }

        // Final URL check
        const url = page.url();
        if (url.includes('data:') || url.includes('javascript:')) {
            return {
                isValid: false,
                error: 'Potentially malicious URL scheme detected'
            };
        }

        return { isValid: true };
    } catch (error) {
        return {
            isValid: false,
            error: `Page validation failed: ${(error as Error).message}`
        };
    }
}

export async function dismissGoogleConsent(page: Page): Promise<void> {
    const logger = new Logger('ConsentHandler');

    try {
        if (page.isClosed()) {
            return;
        }

        // Pre-emptively set consent cookies
        await page.context().addCookies([
            {
                name: 'CONSENT',
                value: 'YES+cb.20240107-11-p0.en+FX',
                domain: '.google.com',
                path: '/'
            },
            {
                name: 'SOCS',
                value: 'CAESEwgDEgk0NzI4MDg4NDIYC_qMAQ',
                domain: '.google.com',
                path: '/'
            }
        ]);

        // Immediately inject consent handling script
        await page.evaluate(() => {
            window.addEventListener('DOMContentLoaded', () => {
                const observer = new MutationObserver(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const acceptButton = buttons.find(button =>
                        button.textContent?.toLowerCase().includes('accept all') ||
                        button.className.includes('tHlp8d')
                    );
                    if (acceptButton) {
                        (acceptButton as HTMLElement).click();
                        observer.disconnect();
                    }
                });
                
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            });
        });

        // Quick check for existing dialog
        const hasConsent = await page.$('div[role="dialog"]').then(Boolean);
        if (hasConsent) {
            await withTimeout(async () => {
                // Try direct click first
                await page.click([
                    'button[class*="tHlp8d"]',
                    'button:has-text("Accept all")',
                    'div[role="dialog"] button:has-text("Accept all")'
                ].join(', ')).catch(() => null);

                // Wait briefly for dialog to disappear
                await page.waitForFunction(
                    () => !document.querySelector('div[role="dialog"]'),
                    { timeout: 1000 }
                );
            }, 2000).catch(() => {
                logger.warn('Initial consent dismissal failed, continuing with navigation');
            });
        }
    } catch (error) {
        logger.error('Consent handling failed:', error);
    }
}