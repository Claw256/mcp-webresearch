import { chromium, Browser, Page, BrowserContext } from 'playwright';
import {
    BROWSER_CONFIG,
    CONSENT_REGIONS,
    SECURITY_CONFIG,
    SERVER_CONFIG,
    CIRCUIT_BREAKER_CONFIG,
    PERFORMANCE_CONFIG
} from '../config/index.js';
import { Logger } from '../utils/logger.js';

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

interface PageValidation {
    wordCount: number;
    botProtection: boolean;
    suspiciousTitle: boolean;
    title: string;
    hasErrorContent: boolean;
    performanceMetrics: {
        loadTime: number;
        resourceCount: number;
        memoryUsage: number;
    };
}

class BrowserPool {
    private static instance: BrowserPool;
    private pool: BrowserInstance[] = [];
    private logger: Logger;
    private circuitBreaker: CircuitBreaker;
    private requestQueue: Array<{ resolve: (page: Page) => void; reject: (error: Error) => void; timestamp: number }> = [];

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
            const browser = await chromium.launch({
                headless: true,
                args: [
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    `--js-flags=--max-old-space-size=${BROWSER_CONFIG.maxMemoryMB}`,
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                    '--disable-ipc-flooding-protection',
                    '--disable-renderer-backgrounding',
                    '--enable-features=NetworkService,NetworkServiceInProcess',
                    '--force-color-profile=srgb',
                    '--metrics-recording-only',
                    '--mute-audio'
                ]
            });

            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 800 },
                ignoreHTTPSErrors: true,
                javaScriptEnabled: true,
                bypassCSP: true,
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            // Set timeouts
            context.setDefaultTimeout(BROWSER_CONFIG.navigationTimeout);
            context.setDefaultNavigationTimeout(BROWSER_CONFIG.navigationTimeout);

            // Configure request handling
            await context.route('**/*', async (route) => {
                const request = route.request();
                const resourceType = request.resourceType();

                // Block unnecessary resources
                if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
                    return route.abort();
                }

                // Set timeout for resource requests
                const timeout = setTimeout(() => {
                    route.abort('timedout');
                }, BROWSER_CONFIG.resourceTimeout);

                try {
                    await route.continue();
                } catch (error) {
                    this.logger.error('Resource request failed:', error);
                } finally {
                    clearTimeout(timeout);
                }
            });

            const page = await context.newPage();

            // Configure error handling
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
        setInterval(() => {
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
        setInterval(async () => {
            for (const instance of this.pool) {
                try {
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
                }
            }
        }, BROWSER_CONFIG.healthCheckInterval);
    }

    async acquirePage(): Promise<Page> {
        try {
            // Check circuit breaker
            if (this.circuitBreaker.state === 'OPEN') {
                throw new Error('Circuit breaker is open, requests are blocked');
            }

            // Check queue size
            if (this.requestQueue.length >= PERFORMANCE_CONFIG.maxQueueSize) {
                throw new Error('Request queue is full');
            }

            const page = await new Promise<Page>((resolve, reject) => {
                const queueEntry = { resolve, reject, timestamp: Date.now() };
                this.requestQueue.push(queueEntry);
                this.processQueue();

                // Set queue timeout
                setTimeout(() => {
                    const index = this.requestQueue.indexOf(queueEntry);
                    if (index !== -1) {
                        this.requestQueue.splice(index, 1);
                        reject(new Error('Request queue timeout'));
                    }
                }, PERFORMANCE_CONFIG.queueTimeoutMs);
            });

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
            const context = instance.context;
            await context.clearCookies();
            await context.clearPermissions();
            
            // Close all pages except the main one
            const pages = context.pages();
            await Promise.all(
                pages
                    .filter(p => p !== instance.page)
                    .map(p => p.close().catch(() => {}))
            );

            const page = await context.newPage();
            instance.page = page;
            instance.lastUsed = Date.now();
            instance.failureCount = 0;
            instance.memoryUsage = 0;
        } catch (error) {
            this.logger.error('Failed to recycle browser instance:', error);
            const newInstance = await this.createBrowserInstance();
            const index = this.pool.indexOf(instance);
            if (index !== -1) {
                await this.cleanupInstance(instance);
                this.pool[index] = newInstance;
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
        setInterval(() => {
            this.cleanupExpiredInstances().catch(error => {
                this.logger.error('Error during maintenance cleanup:', error);
            });
        }, BROWSER_CONFIG.gcInterval);
    }

    async cleanup(): Promise<void> {
        try {
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
        // Step 1: URL validation
        const parsedUrl = new URL(url);
        if (!SECURITY_CONFIG.allowedProtocols.includes(parsedUrl.protocol)) {
            throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
        }

        if (url.length > SECURITY_CONFIG.maxUrlLength) {
            throw new Error('URL exceeds maximum length');
        }

        // Step 2: Set up consent cookies
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

        await page.context().addCookies(consentCookies);

        // Step 3: Navigation with exponential backoff retry
        let attempts = 0;
        let delay = BROWSER_CONFIG.initialRetryDelay;

        while (attempts < BROWSER_CONFIG.maxRetries) {
            try {
                const response = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: BROWSER_CONFIG.navigationTimeout
                });

                if (!response) {
                    throw new Error('Navigation failed: no response received');
                }

                if (response.status() >= 400) {
                    throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
                }

                // Enhanced network idle handling
                const networkIdlePromise = page.waitForLoadState('networkidle', {
                    timeout: BROWSER_CONFIG.networkIdleTimeout
                }).catch(() => 'timeout');

                const timeoutPromise2 = new Promise(resolve =>
                    setTimeout(() => resolve('timeout'), BROWSER_CONFIG.networkIdleTimeout)
                );

                const networkResult = await Promise.race([networkIdlePromise, timeoutPromise2]);
                
                if (networkResult === 'timeout') {
                    logger.warn('Network idle timeout reached, proceeding with validation');
                }

                // Page validation
                const validation = await validatePage(page);
                if (!validation.isValid) {
                    throw new Error(validation.error);
                }

                // Security check for redirects
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
                
                // Exponential backoff with jitter
                const jitter = Math.random() * 1000;
                delay = Math.min(delay * 2 + jitter, BROWSER_CONFIG.maxRetryDelay);
                await page.waitForTimeout(delay);
            }
        }
    } catch (error) {
        logger.error(`Navigation to ${url} failed:`, error);
        throw error;
    }
}

async function validatePage(page: Page): Promise<ValidationResult> {
    try {
        const validation = await page.evaluate((): PageValidation => {
            const botProtectionSelectors = [
                '#challenge-running',
                '#cf-challenge-running',
                '#px-captcha',
                '#ddos-protection',
                '#waf-challenge-html',
                '.ray-id',
                '#captcha-box',
                '.g-recaptcha',
                '#h-captcha',
                '.turnstile-wrapper',
                '[class*="captcha"]',
                '[id*="captcha"]'
            ];

            const botProtectionExists = botProtectionSelectors.some(selector =>
                document.querySelector(selector)
            );

            const suspiciousTitlePhrases = [
                'security check',
                'ddos protection',
                'please wait',
                'just a moment',
                'attention required',
                'access denied',
                'verify human',
                'bot protection',
                'captcha required',
                'verification required',
                'checking your browser',
                'javascript required',
                'cookies required'
            ];

            const title = document.title.toLowerCase();
            const suspiciousTitle = suspiciousTitlePhrases.some(phrase =>
                title.includes(phrase)
            );

            const bodyText = document.body.innerText || '';
            const words = bodyText.trim().split(/\s+/).length;

            const errorIndicators = [
                '404 not found',
                'page not found',
                'access denied',
                'forbidden',
                'error occurred',
                'service unavailable'
            ];

            const hasErrorContent = errorIndicators.some(indicator =>
                bodyText.toLowerCase().includes(indicator)
            );

            // Collect performance metrics
            const performanceMetrics = {
                loadTime: performance.now(),
                resourceCount: performance.getEntriesByType('resource').length,
                memoryUsage: (performance as any).memory?.usedJSHeapSize || 0
            };

            return {
                wordCount: words,
                botProtection: botProtectionExists,
                suspiciousTitle,
                title: document.title,
                hasErrorContent,
                performanceMetrics
            };
        });

        if (validation.botProtection) {
            return {
                isValid: false,
                error: 'Bot protection or CAPTCHA detected'
            };
        }

        if (validation.suspiciousTitle) {
            return {
                isValid: false,
                error: `Suspicious page title detected: "${validation.title}"`
            };
        }

        if (validation.wordCount < BROWSER_CONFIG.minContentWords) {
            return {
                isValid: false,
                error: `Page contains insufficient content (${validation.wordCount} words)`
            };
        }

        if (validation.hasErrorContent) {
            return {
                isValid: false,
                error: 'Page contains error messages or unavailable content'
            };
        }

        // Performance validation
        if (validation.performanceMetrics.loadTime > PERFORMANCE_CONFIG.criticalRequestThreshold) {
            return {
                isValid: false,
                error: 'Page load time exceeded critical threshold'
            };
        }

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
        const currentUrl = page.url();
        if (!CONSENT_REGIONS.some(domain => currentUrl.includes(domain))) {
            return;
        }

        await page.waitForTimeout(2000);

        const consentSelectors = [
            'div[role="dialog"][aria-modal="true"]',
            'div.HTjtHe[role="dialog"]',
            'div.KxvlWc',
            'button[class*="tHlp8d"]',
            'div[aria-label*="Before you continue to Google Search"]',
            'form:has(button[class*="tHlp8d"])',
            'div[aria-modal="true"]:has(button:has-text("Accept all"))'
        ];

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const hasConsent = await page.$(consentSelectors.join(', ')).then(Boolean);
                if (!hasConsent) {
                    return;
                }

                await Promise.any([
                    page.click('button[class*="tHlp8d"]').catch(() => null),
                    page.click('div[role="dialog"] button[class*="tHlp8d"]').catch(() => null),
                    page.click('div[class*="QS5gu"] button').catch(() => null),
                    page.click('button:has-text("Accept all")[class*="tHlp8d"]').catch(() => null),
                    page.evaluate(() => {
                        const acceptButton = document.querySelector('button[class*="tHlp8d"]');
                        if (acceptButton) {
                            (acceptButton as HTMLElement).click();
                            return true;
                        }
                        return false;
                    }).catch(() => null),
                    page.click('div[role="dialog"] button:has-text("Accept all")').catch(() => null),
                    page.click('button:has-text("Accept all")').catch(() => null)
                ]).catch(() => {
                    logger.warn('Failed to click consent button, retrying...');
                });

                await page.waitForFunction(() => {
                    return !document.querySelector('div[role="dialog"]');
                }, { timeout: 5000 }).catch(() => {
                    logger.warn('Dialog did not disappear after clicking accept');
                });

                await page.waitForTimeout(1000);
                const consentStillPresent = await page.$(consentSelectors.join(', ')).then(Boolean);
                if (!consentStillPresent) {
                    break;
                }

                if (attempt < 2) {
                    logger.warn(`Consent still present after attempt ${attempt + 1}, retrying...`);
                    await page.waitForTimeout(1000);
                }
            } catch (error) {
                logger.warn(`Consent dismissal attempt ${attempt + 1} failed:`, error);
                if (attempt < 2) {
                    await page.waitForTimeout(1000);
                }
            }
        }
    } catch (error) {
        logger.error('Consent handling failed:', error);
    }
}