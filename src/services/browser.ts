import { chromium, Browser, Page, BrowserContext, Response } from 'playwright';
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
        const parsedUrl = new URL(url);
        if (!SECURITY_CONFIG.allowedProtocols.includes(parsedUrl.protocol)) {
            throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
        }

        if (url.length > SECURITY_CONFIG.maxUrlLength) {
            throw new Error('URL exceeds maximum length');
        }

        await page.context().addCookies([{
            name: 'CONSENT',
            value: 'YES+',
            domain: '.google.com',
            path: '/'
        }]);

        let attempts = 0;
        while (attempts < BROWSER_CONFIG.maxRetries) {
            try {
                const response = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: BROWSER_CONFIG.navigationTimeout
                });

                if (!response) {
                    throw new Error('No response received');
                }

                const status = response.status();
                if (status >= 400) {
                    throw new Error(`HTTP ${status}: ${response.statusText()}`);
                }

                await Promise.race([
                    page.waitForLoadState('networkidle', { 
                        timeout: BROWSER_CONFIG.networkIdleTimeout 
                    }).catch(() => {}),
                    new Promise(resolve => 
                        setTimeout(resolve, BROWSER_CONFIG.networkIdleTimeout)
                    )
                ]);

                const validation = await validatePage(page);
                if (!validation.isValid) {
                    throw new Error(validation.error);
                }

                return;
            } catch (error) {
                attempts++;
                if (attempts >= BROWSER_CONFIG.maxRetries) {
                    throw error;
                }
                logger.warn(`Navigation attempt ${attempts} failed, retrying...`);
                await new Promise(resolve => 
                    setTimeout(resolve, BROWSER_CONFIG.retryDelay)
                );
            }
        }
    } catch (error) {
        logger.error(`Navigation to ${url} failed:`, error);
        throw error;
    }
}

async function validatePage(page: Page): Promise<ValidationResult> {
    const validation = await page.evaluate((): PageValidation => {
        const botProtectionExists = [
            '#challenge-running',
            '#cf-challenge-running',
            '#px-captcha',
            '#ddos-protection',
            '#waf-challenge-html'
        ].some(selector => document.querySelector(selector));

        const suspiciousTitle = [
            'security check',
            'ddos protection',
            'please wait',
            'just a moment',
            'attention required'
        ].some(phrase => document.title.toLowerCase().includes(phrase));

        const bodyText = document.body.innerText || '';
        const words = bodyText.trim().split(/\s+/).length;

        return {
            wordCount: words,
            botProtection: botProtectionExists,
            suspiciousTitle,
            title: document.title
        };
    });

    if (validation.botProtection) {
        return { isValid: false, error: 'Bot protection detected' };
    }

    if (validation.suspiciousTitle) {
        return { 
            isValid: false, 
            error: `Suspicious page title detected: "${validation.title}"` 
        };
    }

    if (validation.wordCount < BROWSER_CONFIG.minContentWords) {
        return { isValid: false, error: 'Page contains insufficient content' };
    }

    return { isValid: true };
}

export async function dismissGoogleConsent(page: Page): Promise<void> {
    const logger = new Logger('ConsentHandler');

    try {
        const currentUrl = page.url();
        if (!CONSENT_REGIONS.some(domain => currentUrl.includes(domain))) {
            return;
        }

        const hasConsent = await page.$(
            'form:has(button[aria-label]), div[aria-modal="true"], ' +
            'div[role="dialog"], div[role="alertdialog"], ' +
            'div[class*="consent"], div[id*="consent"], ' +
            'div[class*="cookie"], div[id*="cookie"], ' +
            'div[class*="modal"]:has(button), div[class*="popup"]:has(button), ' +
            'div[class*="banner"]:has(button), div[id*="banner"]:has(button)'
        ).then(Boolean);

        if (!hasConsent) {
            return;
        }

        await page.evaluate(() => {
            const consentPatterns = {
                text: [
                    'accept all', 'agree', 'consent',
                    'alle akzeptieren', 'ich stimme zu', 'zustimmen',
                    'tout accepter', "j'accepte",
                    'aceptar todo', 'acepto',
                    'accetta tutto', 'accetto',
                    'aceitar tudo', 'concordo',
                    'alles accepteren', 'akkoord',
                    'zaakceptuj wszystko', 'zgadzam się',
                    'godkänn alla', 'godkänn',
                    'accepter alle', 'accepter',
                    'godta alle', 'godta',
                    'hyväksy kaikki', 'hyväksy',
                    'terima semua', 'setuju',
                    'ยอมรับทั้งหมด', 'ยอมรับ',
                    'chấp nhận tất cả', 'đồng ý',
                    'tanggapin lahat', 'sumang-ayon',
                    'すべて同意する', '同意する',
                    '모두 동의', '동의'
                ],
                ariaLabels: [
                    'consent', 'accept', 'agree',
                    'cookie', 'privacy', 'terms',
                    'persetujuan', 'setuju',
                    'ยอมรับ',
                    'đồng ý',
                    '同意'
                ]
            };

            const findAcceptButton = () => {
                const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
                return buttons.find(button => {
                    const text = button.textContent?.toLowerCase() || '';
                    const label = button.getAttribute('aria-label')?.toLowerCase() || '';
                    return consentPatterns.text.some(pattern => text.includes(pattern)) ||
                           consentPatterns.ariaLabels.some(pattern => label.includes(pattern));
                });
            };

            const acceptButton = findAcceptButton();
            if (acceptButton) {
                acceptButton.click();
            }
        });
    } catch (error) {
        logger.error('Consent handling failed:', error);
    }
}