import { Page } from 'playwright';
interface ContentExtractionOptions {
    includeMetadata?: boolean;
    maxContentLength?: number;
    excludeSelectors?: string[];
}
export declare function extractContentAsMarkdown(page: Page, options?: ContentExtractionOptions): Promise<string>;
export declare function extractMainText(page: Page): Promise<string>;
interface ExtractedLink {
    text: string;
    url: string;
}
export declare function extractLinks(page: Page): Promise<ExtractedLink[]>;
export declare function extractMetadata(page: Page): Promise<Record<string, string>>;
export {};
