import { Page } from 'playwright';
export declare function takeScreenshotWithSizeLimit(page: Page): Promise<string>;
export declare function saveScreenshot(screenshot: string, title: string): Promise<string>;
export declare function cleanupScreenshots(): Promise<void>;
