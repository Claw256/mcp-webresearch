import { Page } from 'playwright';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateSafeFilename } from '../utils/index.js';

// Initialize temp directory for screenshots
const SCREENSHOTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-screenshots-'));

// Take and optimize a screenshot
export async function takeScreenshotWithSizeLimit(page: Page): Promise<string> {
    const MAX_SIZE = 5 * 1024 * 1024;  // 5MB
    const MAX_DIMENSION = 1920;
    const MIN_DIMENSION = 800;

    // Set viewport size
    await page.setViewportSize({
        width: 1600,
        height: 900
    });

    // Take initial screenshot
    let screenshot = await page.screenshot({
        type: 'png',
        fullPage: false
    });

    // Handle buffer conversion
    let buffer = screenshot;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    // While screenshot is too large, reduce size
    while (buffer.length > MAX_SIZE && attempts < MAX_ATTEMPTS) {
        const viewport = page.viewportSize();
        if (!viewport) continue;

        // Calculate new dimensions
        const scaleFactor = Math.pow(0.75, attempts + 1);
        let newWidth = Math.round(viewport.width * scaleFactor);
        let newHeight = Math.round(viewport.height * scaleFactor);

        // Ensure dimensions are within bounds
        newWidth = Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, newWidth));
        newHeight = Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, newHeight));

        // Update viewport with new dimensions
        await page.setViewportSize({
            width: newWidth,
            height: newHeight
        });

        // Take new screenshot
        screenshot = await page.screenshot({
            type: 'png',
            fullPage: false
        });

        buffer = screenshot;
        attempts++;
    }

    // Final attempt with minimum settings if still too large
    if (buffer.length > MAX_SIZE) {
        await page.setViewportSize({
            width: MIN_DIMENSION,
            height: MIN_DIMENSION
        });

        screenshot = await page.screenshot({
            type: 'png',
            fullPage: false
        });

        buffer = screenshot;

        if (buffer.length > MAX_SIZE) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                `Failed to reduce screenshot to under 5MB even with minimum settings`
            );
        }
    }

    return buffer.toString('base64');
}

// Save screenshot to disk
export async function saveScreenshot(screenshot: string, title: string): Promise<string> {
    const buffer = Buffer.from(screenshot, 'base64');

    // Check size before saving
    const MAX_SIZE = 5 * 1024 * 1024;  // 5MB
    if (buffer.length > MAX_SIZE) {
        throw new McpError(
            ErrorCode.InvalidRequest,
            `Screenshot too large: ${Math.round(buffer.length / (1024 * 1024))}MB exceeds ${MAX_SIZE / (1024 * 1024)}MB limit`
        );
    }

    // Generate filename and save
    const filename = generateSafeFilename(title, new Date().getTime());
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    await fs.promises.writeFile(filepath, buffer);

    return filepath;
}

// Cleanup screenshots from disk
export async function cleanupScreenshots(): Promise<void> {
    try {
        const files = await fs.promises.readdir(SCREENSHOTS_DIR);
        await Promise.all(files.map(file =>
            fs.promises.unlink(path.join(SCREENSHOTS_DIR, file))
        ));
        await fs.promises.rmdir(SCREENSHOTS_DIR);
    } catch (error) {
        console.error('Error cleaning up screenshots:', error);
    }
}