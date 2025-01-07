import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { BROWSER_CONFIG, CONSENT_REGIONS, SECURITY_CONFIG, SERVER_CONFIG } from '../config/index.js';
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
}

interface PageValidation {
    wordCount: number;
    botProtection: boolean;
    suspiciousTitle: boolean;
    title: string;
    hasErrorContent: boolean;
}

class BrowserPool {
    private static instance: BrowserPool;
    private pool: BrowserInstance[] = [];
    private logger: Logger;

    private constructor() {
        this.logger = new Logger('BrowserPool');
        this.startMaintenanceInterval();
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
                    '--disable-software-rasterizer'
                ]
            });

            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 800 },
                ignoreHTTPSErrors: true,
                javaScriptEnabled: true
            });

            context.setDefaultTimeout(BROWSER_CONFIG.navigationTimeout);
            context.setDefaultNavigationTimeout(BROWSER_CONFIG.navigationTimeout);

            const page = await context.newPage();
            return {
                browser,
                context,
                page,
                lastUsed: Date.now()
            };
        } catch (error) {
            this.logger.error('Failed to create browser instance:', error);
            throw error;
        }
    }

    async acquirePage(): Promise<Page> {
        try {
            await this.cleanupExpiredInstances();

            let instance = this.pool.find(inst => {
                try {
                    return !inst.page.isClosed();
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
            return instance.page;
        } catch (error) {
            this.logger.error('Failed to acquire page:', error);
            throw error;
        }
    }

    private async recycleBrowserInstance(instance: BrowserInstance): Promise<void> {
        try {
            const context = instance.context;
            await context.clearCookies();
            await context.clearPermissions();
            const page = await context.newPage();
            instance.page = page;
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
            if (now - instance.lastUsed > expirationTime) {
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
        }, 60000); // Run every minute
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

        // Step 2: Set up consent cookies for all potential Google domains
        const domain = parsedUrl.hostname;
        const consentCookies = [];

        // Base Google consent cookie
        consentCookies.push({
            name: 'CONSENT',
            value: 'YES+cb.20240107-11-p0.en+FX',
            domain: '.google.com',
            path: '/'
        });

        // Regional consent cookies if needed
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

        // Step 3: Apply all cookies at once
        await page.context().addCookies(consentCookies);
        await page.waitForTimeout(1000); // Brief wait for cookies to take effect

        // Step 4: Navigation with retries
        let attempts = 0;
        let lastError: Error | null = null;

        while (attempts < BROWSER_CONFIG.maxRetries) {
            try {
                // Initial navigation
                const response = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: BROWSER_CONFIG.navigationTimeout
                });

                if (!response) {
                    throw new Error('Navigation failed: no response received');
                }

                // Check HTTP status
                const status = response.status();
                if (status >= 400) {
                    throw new Error(`HTTP ${status}: ${response.statusText()}`);
                }

                // Step 5: Enhanced network idle handling
                const networkIdlePromise = page.waitForLoadState('networkidle', {
                    timeout: BROWSER_CONFIG.networkIdleTimeout
                }).catch(() => 'timeout');

                const timeoutPromise = new Promise(resolve =>
                    setTimeout(() => resolve('timeout'), BROWSER_CONFIG.networkIdleTimeout)
                );

                const networkResult = await Promise.race([networkIdlePromise, timeoutPromise]);
                
                if (networkResult === 'timeout') {
                    logger.warn('Network idle timeout reached, proceeding with validation');
                }

                // Step 6: Comprehensive page validation
                const validation = await validatePage(page);
                if (!validation.isValid) {
                    throw new Error(validation.error);
                }

                // Additional security check for redirects
                const finalUrl = page.url();
                if (finalUrl !== url) {
                    logger.warn(`Page redirected from ${url} to ${finalUrl}`);
                    // Validate the final URL follows same security rules
                    const finalParsedUrl = new URL(finalUrl);
                    if (!SECURITY_CONFIG.allowedProtocols.includes(finalParsedUrl.protocol)) {
                        throw new Error(`Redirect to unsupported protocol: ${finalParsedUrl.protocol}`);
                    }
                }

                return;
            } catch (error) {
                lastError = error as Error;
                attempts++;
                
                if (attempts >= BROWSER_CONFIG.maxRetries) {
                    logger.error('All navigation attempts failed:', lastError);
                    throw new Error(`Navigation failed after ${attempts} attempts: ${lastError.message}`);
                }

                logger.warn(`Navigation attempt ${attempts} failed: ${lastError.message}, retrying...`);
                await page.waitForTimeout(BROWSER_CONFIG.retryDelay * attempts); // Exponential backoff
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
            // Enhanced bot protection detection
            const botProtectionSelectors = [
                '#challenge-running',     // Cloudflare
                '#cf-challenge-running',  // Cloudflare
                '#px-captcha',           // PerimeterX
                '#ddos-protection',      // Various
                '#waf-challenge-html',   // Various WAFs
                '.ray-id',               // Cloudflare
                '#captcha-box',          // Generic
                '.g-recaptcha',          // Google reCAPTCHA
                '#h-captcha',            // hCaptcha
                '.turnstile-wrapper',    // Cloudflare Turnstile
                '[class*="captcha"]',    // Generic captcha classes
                '[id*="captcha"]'        // Generic captcha ids
            ];

            const botProtectionExists = botProtectionSelectors.some(selector =>
                document.querySelector(selector)
            );

            // Enhanced suspicious title detection
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

            // Enhanced content validation
            const bodyText = document.body.innerText || '';
            const words = bodyText.trim().split(/\s+/).length;

            // Check for common error indicators in content
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

            return {
                wordCount: words,
                botProtection: botProtectionExists,
                suspiciousTitle,
                title: document.title,
                hasErrorContent
            };
        });

        // Validate bot protection
        if (validation.botProtection) {
            return {
                isValid: false,
                error: 'Bot protection or CAPTCHA detected'
            };
        }

        // Validate title
        if (validation.suspiciousTitle) {
            return {
                isValid: false,
                error: `Suspicious page title detected: "${validation.title}"`
            };
        }

        // Validate content length
        if (validation.wordCount < BROWSER_CONFIG.minContentWords) {
            return {
                isValid: false,
                error: `Page contains insufficient content (${validation.wordCount} words)`
            };
        }

        // Validate error content
        if (validation.hasErrorContent) {
            return {
                isValid: false,
                error: 'Page contains error messages or unavailable content'
            };
        }

        // Additional security checks
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

        // Increased initial wait for consent dialog
        await page.waitForTimeout(5000);

        // Specific Google consent dialog selectors based on current structure
        const consentSelectors = [
            // Main dialog container
            'div[role="dialog"][aria-modal="true"]',
            // Specific Google consent classes
            'div.HTjtHe[role="dialog"]',
            'div.KxvlWc',
            'button[class*="tHlp8d"]',
            // Dialog with specific text
            'div[aria-label*="Before you continue to Google Search"]',
            // Consent form
            'form:has(button[class*="tHlp8d"])',
            // Fallback for general consent elements
            'div[aria-modal="true"]:has(button:has-text("Accept all"))'
        ];

        // Multiple attempts to dismiss consent
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                // Check for consent dialog
                const hasConsent = await page.$(consentSelectors.join(', ')).then(Boolean);
                if (!hasConsent) {
                    return;
                }

                // Try specific Google consent button selectors first
                await Promise.any([
                    // Target the exact button structure from the consent dialog
                    page.click('button[class*="tHlp8d"]').catch(() => null),
                    page.click('div[role="dialog"] button[class*="tHlp8d"]').catch(() => null),
                    page.click('div[class*="QS5gu"] button').catch(() => null),
                    
                    // Click by text content with specific class
                    page.click('button:has-text("Accept all")[class*="tHlp8d"]').catch(() => null),
                    
                    // Evaluate in page context with exact class matching
                    page.evaluate(() => {
                        const acceptButton = document.querySelector('button[class*="tHlp8d"]');
                        if (acceptButton) {
                            (acceptButton as HTMLElement).click();
                            return true;
                        }
                        return false;
                    }).catch(() => null),
                    
                    // Fallback to more general selectors
                    page.click('div[role="dialog"] button:has-text("Accept all")').catch(() => null),
                    page.click('button:has-text("Accept all")').catch(() => null)
                ]).catch(() => {
                    logger.warn('Failed to click consent button, retrying with delay...');
                    return page.waitForTimeout(1000).then(() =>
                        page.click('button[class*="tHlp8d"]')
                    );
                });
                
                // Wait for dialog to disappear
                await page.waitForFunction(() => {
                    return !document.querySelector('div[role="dialog"]');
                }, { timeout: 5000 }).catch(() => {
                    logger.warn('Dialog did not disappear after clicking accept');
                });

                // Wait to see if the consent dialog disappears
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