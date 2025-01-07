import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SERVER_CONFIG } from '../config/index.js';
import { Logger } from '../utils/logger.js';
class ScreenshotError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'ScreenshotError';
    }
}
class ScreenshotManager {
    static instance;
    screenshots;
    totalSize;
    cleanupInterval;
    logger;
    constructor() {
        this.screenshots = new Map();
        this.totalSize = 0;
        this.logger = new Logger('ScreenshotManager');
        this.initializeScreenshotDirectory();
        this.startCleanupInterval();
    }
    static getInstance() {
        if (!ScreenshotManager.instance) {
            ScreenshotManager.instance = new ScreenshotManager();
        }
        return ScreenshotManager.instance;
    }
    async initializeScreenshotDirectory() {
        try {
            await fs.mkdir(SERVER_CONFIG.screenshotDir, { recursive: true });
            this.logger.info(`Screenshot directory initialized: ${SERVER_CONFIG.screenshotDir}`);
        }
        catch (error) {
            this.logger.error('Failed to initialize screenshot directory:', error);
            throw new ScreenshotError('Failed to initialize screenshot directory', error);
        }
    }
    startCleanupInterval() {
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredScreenshots().catch(error => {
                this.logger.error('Failed to cleanup screenshots:', error);
            });
        }, 60 * 60 * 1000); // Run every hour
    }
    async cleanupExpiredScreenshots() {
        const now = Date.now();
        const expirationTime = SERVER_CONFIG.screenshotRetentionHours * 60 * 60 * 1000;
        for (const [id, metadata] of this.screenshots.entries()) {
            if (now - metadata.timestamp > expirationTime) {
                try {
                    await fs.unlink(metadata.path);
                    this.screenshots.delete(id);
                    this.totalSize -= metadata.size;
                    this.logger.info(`Cleaned up expired screenshot: ${id}`);
                }
                catch (error) {
                    this.logger.error(`Failed to delete screenshot ${id}:`, error);
                }
            }
        }
    }
    async enforceStorageLimit() {
        if (this.totalSize <= SERVER_CONFIG.maxTotalScreenshotStorageBytes) {
            return;
        }
        const sortedScreenshots = Array.from(this.screenshots.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        while (this.totalSize > SERVER_CONFIG.maxTotalScreenshotStorageBytes && sortedScreenshots.length > 0) {
            const [id, metadata] = sortedScreenshots.shift();
            try {
                await fs.unlink(metadata.path);
                this.screenshots.delete(id);
                this.totalSize -= metadata.size;
                this.logger.info(`Removed old screenshot ${id} to free up space`);
            }
            catch (error) {
                this.logger.error(`Failed to delete screenshot ${id}:`, error);
            }
        }
    }
    sanitizeFilename(title) {
        return title
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()
            .slice(0, 32);
    }
    async saveScreenshot(buffer, title) {
        await this.enforceStorageLimit();
        const hash = crypto.createHash('sha256')
            .update(buffer)
            .digest('hex')
            .slice(0, 16);
        const sanitizedTitle = this.sanitizeFilename(title);
        const filename = `${sanitizedTitle}_${hash}.png`;
        const filepath = path.join(SERVER_CONFIG.screenshotDir, filename);
        try {
            await fs.writeFile(filepath, buffer);
            const stats = await fs.stat(filepath);
            if (stats.size > SERVER_CONFIG.maxScreenshotSizeBytes) {
                await fs.unlink(filepath);
                throw new ScreenshotError('Screenshot exceeds maximum size limit');
            }
            const metadata = {
                path: filepath,
                timestamp: Date.now(),
                size: stats.size
            };
            this.screenshots.set(hash, metadata);
            this.totalSize += stats.size;
            this.logger.info(`Saved screenshot: ${filename}`);
            return filepath;
        }
        catch (error) {
            this.logger.error('Failed to save screenshot:', error);
            if (error instanceof ScreenshotError) {
                throw error;
            }
            throw new ScreenshotError('Failed to save screenshot', error);
        }
    }
    async getScreenshot(id) {
        const metadata = this.screenshots.get(id);
        if (!metadata) {
            throw new ScreenshotError(`Screenshot not found: ${id}`);
        }
        try {
            return await fs.readFile(metadata.path);
        }
        catch (error) {
            this.logger.error(`Failed to read screenshot ${id}:`, error);
            throw new ScreenshotError(`Failed to read screenshot: ${id}`, error);
        }
    }
    async cleanup() {
        clearInterval(this.cleanupInterval);
        try {
            const deletePromises = Array.from(this.screenshots.entries()).map(async ([id, metadata]) => {
                try {
                    await fs.unlink(metadata.path);
                    this.screenshots.delete(id);
                }
                catch (error) {
                    this.logger.error(`Failed to delete screenshot ${id}:`, error);
                }
            });
            await Promise.all(deletePromises);
            this.totalSize = 0;
            this.logger.info('All screenshots cleaned up');
        }
        catch (error) {
            this.logger.error('Failed to cleanup screenshots:', error);
            throw new ScreenshotError('Failed to cleanup screenshots', error);
        }
    }
}
// Screenshot service functions
const manager = ScreenshotManager.getInstance();
export async function takeScreenshotWithSizeLimit(page) {
    const fullPageOptions = {
        type: 'png',
        fullPage: true,
        timeout: 10000
    };
    const viewportOptions = {
        type: 'png',
        fullPage: false,
        timeout: 5000
    };
    try {
        const screenshot = await page.screenshot(fullPageOptions);
        if (screenshot.length > SERVER_CONFIG.maxScreenshotSizeBytes) {
            // If full page screenshot is too large, try viewport only
            return await page.screenshot(viewportOptions);
        }
        return screenshot;
    }
    catch (error) {
        const logger = new Logger('ScreenshotService');
        logger.error('Failed to take screenshot:', error);
        throw new ScreenshotError('Failed to take screenshot', error);
    }
}
export async function saveScreenshot(buffer, title) {
    return await manager.saveScreenshot(buffer, title);
}
export async function getScreenshot(id) {
    return await manager.getScreenshot(id);
}
export async function cleanupScreenshots() {
    return await manager.cleanup();
}
//# sourceMappingURL=screenshot.js.map