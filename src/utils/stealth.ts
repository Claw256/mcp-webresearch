import { BrowserContext, Page } from 'playwright';

// List of common user agents to rotate through
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Edge/120.0.0.0'
];

// Common screen resolutions
const VIEWPORT_SIZES = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 }
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

    // Set viewport in context options
    await context.addInitScript(`
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
            pixelDepth: 24
        };
    `);

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
    // Add random mouse movements
    await page.evaluate(() => {
        function randomMove() {
            const x = Math.floor(Math.random() * window.innerWidth);
            const y = Math.floor(Math.random() * window.innerHeight);
            const event = new MouseEvent('mousemove', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y
            });
            document.dispatchEvent(event);
        }
        
        setInterval(randomMove, Math.random() * 2000 + 1000);
    });

    // Add random scrolling behavior
    await page.evaluate(() => {
        function randomScroll() {
            const maxScroll = Math.max(
                document.documentElement.scrollHeight - window.innerHeight,
                0
            );
            const scrollTo = Math.floor(Math.random() * maxScroll);
            window.scrollTo({
                top: scrollTo,
                behavior: 'smooth'
            });
        }
        
        setInterval(randomScroll, Math.random() * 3000 + 2000);
    });

    // Override automation flags
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin' },
                { name: 'Chrome PDF Viewer' },
                { name: 'Native Client' }
            ]
        });
    });
}