import { Page } from 'playwright';
export declare function takeScreenshotWithSizeLimit(page: Page): Promise<Buffer>;
export declare function saveScreenshot(buffer: Buffer, title: string): Promise<string>;
export declare function getScreenshot(id: string): Promise<Buffer>;
export declare function cleanupScreenshots(): Promise<void>;
