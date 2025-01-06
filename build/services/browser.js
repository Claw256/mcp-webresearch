import { chromium } from 'playwright';
import { CONSENT_REGIONS } from '../config/index.js';
// Global browser instance
let browser;
let page;
// Ensures browser is running, and creates a new page if needed
export async function ensureBrowser() {
    // Launch browser if not already running
    if (!browser) {
        browser = await chromium.launch({
            headless: true, // Run in headless mode for automation
        });
        // Create initial context and page
        const context = await browser.newContext();
        page = await context.newPage();
    }
    // Create new page if current one is closed/invalid
    if (!page) {
        const context = await browser.newContext();
        page = await context.newPage();
    }
    return page;
}
// Specifically handles Google's consent dialog in regions that require it
export async function dismissGoogleConsent(page) {
    try {
        // Get current URL
        const currentUrl = page.url();
        // Skip consent check if not in a supported region
        if (!CONSENT_REGIONS.some(domain => currentUrl.includes(domain))) {
            return;
        }
        // Quick check for consent dialog existence
        const hasConsent = await page.$('form:has(button[aria-label]), div[aria-modal="true"], ' +
            // Common dialog containers
            'div[role="dialog"], div[role="alertdialog"], ' +
            // Common cookie/consent specific elements
            'div[class*="consent"], div[id*="consent"], ' +
            'div[class*="cookie"], div[id*="cookie"], ' +
            // Common modal/popup classes
            'div[class*="modal"]:has(button), div[class*="popup"]:has(button), ' +
            // Common banner patterns
            'div[class*="banner"]:has(button), div[id*="banner"]:has(button)').then(Boolean);
        // If no consent dialog is found, return
        if (!hasConsent) {
            return;
        }
        // Handle the consent dialog using common consent button patterns
        await page.evaluate(() => {
            const consentPatterns = {
                // Common accept button text patterns across languages
                text: [
                    // English
                    'accept all', 'agree', 'consent',
                    // German
                    'alle akzeptieren', 'ich stimme zu', 'zustimmen',
                    // French
                    'tout accepter', "j'accepte",
                    // Spanish
                    'aceptar todo', 'acepto',
                    // Italian
                    'accetta tutto', 'accetto',
                    // Portuguese
                    'aceitar tudo', 'concordo',
                    // Dutch
                    'alles accepteren', 'akkoord',
                    // Polish
                    'zaakceptuj wszystko', 'zgadzam się',
                    // Swedish
                    'godkänn alla', 'godkänn',
                    // Danish
                    'accepter alle', 'accepter',
                    // Norwegian
                    'godta alle', 'godta',
                    // Finnish
                    'hyväksy kaikki', 'hyväksy',
                    // Indonesian
                    'terima semua', 'setuju', 'saya setuju',
                    // Malay
                    'terima semua', 'setuju',
                    // Thai
                    'ยอมรับทั้งหมด', 'ยอมรับ',
                    // Vietnamese
                    'chấp nhận tất cả', 'đồng ý',
                    // Filipino/Tagalog
                    'tanggapin lahat', 'sumang-ayon',
                    // Japanese
                    'すべて同意する', '同意する',
                    // Korean
                    '모두 동의', '동의'
                ],
                // Common aria-label patterns
                ariaLabels: [
                    'consent', 'accept', 'agree',
                    'cookie', 'privacy', 'terms',
                    'persetujuan', 'setuju', // Indonesian
                    'ยอมรับ', // Thai
                    'đồng ý', // Vietnamese
                    '同意' // Japanese/Chinese
                ]
            };
            // Finds the accept button by text or aria-label
            const findAcceptButton = () => {
                const buttons = Array.from(document.querySelectorAll('button'));
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
    }
    catch (error) {
        console.log('Consent handling failed:', error);
    }
}
// Safe page navigation with error handling and bot detection
export async function safePageNavigation(page, url) {
    try {
        // Set cookies to bypass consent banner
        await page.context().addCookies([{
                name: 'CONSENT',
                value: 'YES+',
                domain: '.google.com',
                path: '/'
            }]);
        // Initial navigation
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });
        if (!response) {
            throw new Error('Navigation failed: no response received');
        }
        // Check HTTP status code
        const status = response.status();
        if (status >= 400) {
            throw new Error(`HTTP ${status}: ${response.statusText()}`);
        }
        // Wait for network to become idle or timeout
        await Promise.race([
            page.waitForLoadState('networkidle', { timeout: 5000 })
                .catch(() => { }),
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);
        // Security and content validation
        const validation = await page.evaluate(() => {
            const botProtectionExists = [
                '#challenge-running', // Cloudflare
                '#cf-challenge-running', // Cloudflare
                '#px-captcha', // PerimeterX
                '#ddos-protection', // Various
                '#waf-challenge-html' // Various WAFs
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
            throw new Error('Bot protection detected');
        }
        if (validation.suspiciousTitle) {
            throw new Error(`Suspicious page title detected: "${validation.title}"`);
        }
        if (validation.wordCount < 10) {
            throw new Error('Page contains insufficient content');
        }
    }
    catch (error) {
        throw new Error(`Navigation to ${url} failed: ${error.message}`);
    }
}
// Cleanup browser resources
export async function cleanupBrowser() {
    try {
        if (browser) {
            await browser.close();
        }
    }
    catch (error) {
        console.error('Error closing browser:', error);
    }
    finally {
        browser = undefined;
        page = undefined;
    }
}
//# sourceMappingURL=browser.js.map