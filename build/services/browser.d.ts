import { Page } from 'playwright';
export declare function cleanupPage(page: Page): Promise<void>;
export declare function ensureBrowser(): Promise<Page>;
export declare function cleanupBrowser(): Promise<void>;
export declare function safePageNavigation(page: Page, url: string): Promise<void>;
export declare function dismissGoogleConsent(page: Page): Promise<void>;
