import { BrowserContext, Page } from 'playwright';

// List of common user agents to rotate through
// Reduced User-Agent strings following Chrome's UA reduction
const USER_AGENTS = [
    // Windows - reduced OS version and CPU info
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // macOS - reduced OS version
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Android - fixed version and model K
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    // Linux - reduced CPU info
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Common screen resolutions with refresh rates
const VIEWPORT_SIZES = [
    { width: 1920, height: 1080, refreshRate: 60 },
    { width: 1366, height: 768, refreshRate: 60 },
    { width: 1536, height: 864, refreshRate: 75 },
    { width: 1440, height: 900, refreshRate: 60 },
    { width: 1280, height: 800, refreshRate: 60 },
    { width: 2560, height: 1440, refreshRate: 144 },
    { width: 3440, height: 1440, refreshRate: 100 },
    { width: 1680, height: 1050, refreshRate: 60 }
];

// Browser languages with weights
const LANGUAGES = [
    { code: 'en-US', weight: 0.3 },
    { code: 'en-GB', weight: 0.2 },
    { code: 'en-CA', weight: 0.1 },
    { code: 'en-AU', weight: 0.1 },
    { code: 'fr-FR', weight: 0.05 },
    { code: 'de-DE', weight: 0.05 },
    { code: 'es-ES', weight: 0.05 },
    { code: 'it-IT', weight: 0.05 },
    { code: 'nl-NL', weight: 0.05 },
    { code: 'pt-BR', weight: 0.05 }
];

// Time zones
const TIMEZONES = [
    'America/New_York',
    'America/Los_Angeles',
    'America/Chicago',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Australia/Sydney',
    'Asia/Tokyo'
];

// WebGL vendor and renderer pairs
const WEBGL_VENDORS = [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Apple', renderer: 'Apple M1' },
    { vendor: 'Google Inc.', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)' }
];

// Hardware concurrency values
const CPU_CORES = [2, 4, 6, 8, 12, 16];

// Device memory values (in GB)
const MEMORY_SIZES = [4, 8, 16, 32];

// Platform variations
const PLATFORMS = [
    'Win32',
    'MacIntel',
    'Linux x86_64'
];

export function getRandomItem<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

export async function applyStealth(context: BrowserContext): Promise<void> {
    const userAgent = getRandomItem(USER_AGENTS);
    const viewportSize = getRandomItem(VIEWPORT_SIZES);
    const webgl = getRandomItem(WEBGL_VENDORS);
    const cores = getRandomItem(CPU_CORES);
    const memory = getRandomItem(MEMORY_SIZES);
    const platform = getRandomItem(PLATFORMS);
    const language = getRandomItem(LANGUAGES);
    const timezone = getRandomItem(TIMEZONES);

    // Set viewport and screen properties with realistic values
    await context.addInitScript(`
        // Screen and viewport setup
        const dpr = window.devicePixelRatio || 1;
        window.outerWidth = ${viewportSize.width};
        window.outerHeight = ${viewportSize.height};
        window.innerWidth = ${viewportSize.width};
        window.innerHeight = ${viewportSize.height};
        window.screen = {
            width: ${viewportSize.width},
            height: ${viewportSize.height},
            availWidth: ${viewportSize.width},
            availHeight: ${viewportSize.height},
            colorDepth: 24,
            pixelDepth: 24,
            orientation: {
                type: window.innerWidth > window.innerHeight ? 'landscape-primary' : 'portrait-primary',
                angle: 0
            },
            refreshRate: ${viewportSize.refreshRate}
        };

        // Override language and timezone
        Object.defineProperty(navigator, 'language', { get: () => '${language.code}' });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['${language.code}', 'en']
        });
        Object.defineProperty(Intl, 'DateTimeFormat', {
            get: () => function(...args) {
                return new Intl.DateTimeFormat(...args);
            }
        });

        // Add realistic performance timing
        const originalGetEntries = Performance.prototype.getEntries;
        Performance.prototype.getEntries = function() {
            const entries = originalGetEntries.call(this);
            const navigationEntry = entries.find(e => e.entryType === 'navigation');
            if (navigationEntry) {
                navigationEntry.domComplete += Math.random() * 100;
                navigationEntry.loadEventEnd += Math.random() * 150;
            }
            return entries;
        };

        // Add realistic battery API
        if ('getBattery' in navigator) {
            navigator.getBattery = async () => ({
                charging: Math.random() > 0.3,
                chargingTime: Math.random() > 0.5 ? Infinity : Math.floor(Math.random() * 3600),
                dischargingTime: Math.floor(Math.random() * 7200),
                level: Math.random() * 0.4 + 0.6
            });
        }

        // Only override essential properties that match the reduced UA string
        Object.defineProperty(navigator, 'platform', { get: () => '${platform}' });
        
        // Remove navigator.userAgent override since it's being phased out
        delete Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        
        // Add basic WebGL properties without excessive randomization
        if (!window.WebGLRenderingContext) {
            window.WebGLRenderingContext = function(){};
        }
    `);

    // Set randomized headers
    const acceptLanguages = [
        language.code,
        'en-US;q=0.9',
        'en;q=0.8'
    ].join(',');

    // Only include the default low-entropy Client Hints that Chrome sends
    const headers: { [key: string]: string } = {
        'Accept-Language': acceptLanguages,
        'Accept': [
            'text/html,application/xhtml+xml,application/xml;q=0.9',
            'image/avif,image/webp,image/apng,*/*;q=0.8'
        ].join(','),
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        // Only include the default low-entropy hints
        'Sec-CH-UA': `"Chrome";v="120"`,
        'Sec-CH-UA-Mobile': platform.toLowerCase().includes('android') ? '?1' : '?0',
        'Sec-CH-UA-Platform': `"${platform}"`
    };

    // Add optional DNT header
    if (Math.random() > 0.5) {
        headers['DNT'] = '1';
    }

    await context.setExtraHTTPHeaders(headers);

    // Set user agent and viewport
    await context.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
    });

    // Override permissions
    await context.grantPermissions(['geolocation']);

    // Inject fingerprint evasion scripts
    await context.addInitScript(`
        // Override property descriptors
        const propertyDescriptors = {
            hardwareConcurrency: { value: ${cores} },
            deviceMemory: { value: ${memory} },
            platform: { value: '${platform}' },
            userAgent: { value: '${userAgent}' }
        };

        for (const [key, descriptor] of Object.entries(propertyDescriptors)) {
            try {
                Object.defineProperty(navigator, key, descriptor);
            } catch (e) {}
        }

        // Override WebGL fingerprinting
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
            const context = getContext.call(this, contextType, contextAttributes);
            if (contextType === 'webgl' || contextType === 'webgl2') {
                const getParameter = context.getParameter.bind(context);
                context.getParameter = function(parameter) {
                    if (parameter === 37445) return '${webgl.vendor}';
                    if (parameter === 37446) return '${webgl.renderer}';
                    return getParameter(parameter);
                };
            }
            return context;
        };

        // Add noise to canvas fingerprinting
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
            const context = this.getContext('2d');
            if (context) {
                const imageData = context.getImageData(0, 0, this.width, this.height);
                const pixels = imageData.data;
                for (let i = 0; i < pixels.length; i += 4) {
                    pixels[i] = pixels[i] + (Math.random() * 2 - 1);
                    pixels[i + 1] = pixels[i + 1] + (Math.random() * 2 - 1);
                    pixels[i + 2] = pixels[i + 2] + (Math.random() * 2 - 1);
                }
                context.putImageData(imageData, 0, 0);
            }
            return originalToDataURL.call(this, type);
        };

        // Override audio fingerprinting
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(channel) {
            const data = originalGetChannelData.call(this, channel);
            for (let i = 0; i < data.length; i += 100) {
                data[i] = data[i] + (Math.random() * 0.0001 - 0.00005);
            }
            return data;
        };
    `);
}

export async function evasivePage(page: Page): Promise<void> {
    // Add minimal page interaction to avoid bot detection
    await page.evaluate(() => {
        // Track scroll position without animation
        let lastScrollY = window.scrollY;
        window.addEventListener('scroll', () => {
            const currentScroll = window.scrollY;
            const distance = Math.abs(currentScroll - lastScrollY);
            // Only update if scroll distance is reasonable
            if (distance < window.innerHeight * 0.8) {
                lastScrollY = currentScroll;
            }
        });

        // Track mouse position without simulation
        let lastMoveTime = Date.now();
        window.addEventListener('mousemove', () => {
            const now = Date.now();
            // Only process events with reasonable timing
            if (now - lastMoveTime > 16) { // ~60fps
                lastMoveTime = now;
            }
        });

        // Handle focus events naturally
        window.addEventListener('focus', () => {
            // Don't override default behavior
        });

        window.addEventListener('blur', () => {
            // Don't override default behavior
        });
    });

    // Enhanced automation flags override
    await page.evaluate(() => {
        // Override webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        
        // Override plugins with realistic values
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const FakePlugin = class {
                    constructor(name: string) {
                        this.name = name;
                        this.description = `${name} Plugin`;
                        this.filename = `${name.toLowerCase().replace(/\s+/g, '')}.dll`;
                    }
                    name: string;
                    description: string;
                    filename: string;
                };

                return {
                    length: 3,
                    item: (index: number) => [
                        new FakePlugin('Chrome PDF Plugin'),
                        new FakePlugin('Chrome PDF Viewer'),
                        new FakePlugin('Native Client')
                    ][index],
                    namedItem: (name: string) => null,
                    refresh: () => {},
                    [Symbol.iterator]: function* () {
                        yield new FakePlugin('Chrome PDF Plugin');
                        yield new FakePlugin('Chrome PDF Viewer');
                        yield new FakePlugin('Native Client');
                    }
                };
            }
        });

        // Add random focus/blur events
        function simulateUserActivity() {
            const focusEvent = new FocusEvent('focus', { bubbles: true });
            const blurEvent = new FocusEvent('blur', { bubbles: true });

            if (Math.random() > 0.5) {
                window.dispatchEvent(focusEvent);
            } else {
                window.dispatchEvent(blurEvent);
            }
        }

        setInterval(simulateUserActivity, Math.random() * 10000 + 5000); // 5-15 seconds
    });
}