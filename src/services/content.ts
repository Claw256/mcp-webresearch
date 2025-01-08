import { Page } from 'patchright';
import TurndownService from 'turndown';
import { Logger } from '../utils/logger.js';

import type { Rule, Node, Filter } from 'turndown';

const logger = new Logger('ContentService');
const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_'
});

// Configure Turndown rules
const rules: Record<string, Rule> = {
    removeScripts: {
        filter: ['script', 'style', 'noscript'] as Filter,
        replacement: () => ''
    },
    preserveLinks: {
        filter: 'a' as Filter,
        replacement: (content: string, node: Node) => {
            const element = node as HTMLElement;
            const href = element.getAttribute('href');
            return href ? `[${content}](${href})` : content;
        }
    },
    preserveImages: {
        filter: 'img' as Filter,
        replacement: (_content: string, node: Node) => {
            const element = node as HTMLElement;
            const alt = element.getAttribute('alt') || '';
            const src = element.getAttribute('src');
            return src ? `![${alt}](${src})` : '';
        }
    }
};

// Add rules to turndown service
Object.entries(rules).forEach(([name, rule]) => {
    turndownService.addRule(name, rule);
});

interface ContentExtractionOptions {
    includeMetadata?: boolean;
    maxContentLength?: number;
    excludeSelectors?: string[];
}

interface ExtractedContent {
    metadata: string;
    content: string;
}

export async function extractContentAsMarkdown(
    page: Page,
    options: ContentExtractionOptions = {}
): Promise<string> {
    const {
        includeMetadata = true,
        maxContentLength = 100000,
        excludeSelectors = [
            'header',
            'footer',
            'nav',
            '.advertisement',
            '.ads',
            '#cookie-banner',
            '.cookie-notice',
            '.social-share',
            '.comments'
        ]
    } = options;

    try {
        // Remove unwanted elements
        await page.evaluate((selectors: string[]) => {
            selectors.forEach((selector: string) => {
                document.querySelectorAll(selector).forEach(element => {
                    element.remove();
                });
            });
        }, excludeSelectors);

        // Extract content
        const content = await page.evaluate((includeMetadata: boolean): ExtractedContent => {
            // Helper function to get meta content
            const getMeta = (name: string): string | null => {
                const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                return element ? element.getAttribute('content') : null;
            };

            // Build metadata section if requested
            let metadata = '';
            if (includeMetadata) {
                const title = document.title;
                const description = getMeta('description') || getMeta('og:description');
                const keywords = getMeta('keywords');
                const author = getMeta('author') || getMeta('og:site_name');
                const publishedTime = getMeta('article:published_time') || getMeta('date');

                metadata = [
                    `# ${title}`,
                    '',
                    description ? `> ${description}` : '',
                    '',
                    keywords ? `**Keywords**: ${keywords}` : '',
                    author ? `**Author**: ${author}` : '',
                    publishedTime ? `**Published**: ${publishedTime}` : '',
                    '---',
                    ''
                ].filter(Boolean).join('\n');
            }

            // Get main content
            const article = document.querySelector('article') ||
                          document.querySelector('main') ||
                          document.querySelector('.main-content') ||
                          document.querySelector('.content') ||
                          document.body;

            return {
                metadata,
                content: article.innerHTML
            };
        }, includeMetadata);

        // Convert HTML to Markdown
        const markdown = turndownService.turndown(content.content);
        const fullContent = content.metadata + markdown;

        // Truncate if necessary
        if (fullContent.length > maxContentLength) {
            logger.warn(`Content exceeded maximum length, truncating to ${maxContentLength} characters`);
            return fullContent.slice(0, maxContentLength) + '\n\n[Content truncated...]';
        }

        return fullContent;
    } catch (error) {
        logger.error('Failed to extract content:', error);
        throw new Error(`Content extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function extractMainText(page: Page): Promise<string> {
    try {
        return await page.evaluate(() => {
            // Remove unwanted elements
            const elementsToRemove = [
                'script',
                'style',
                'noscript',
                'iframe',
                'header',
                'footer',
                'nav',
                '.ad',
                '.ads',
                '.advertisement',
                '#cookie-banner',
                '.cookie-notice'
            ];

            elementsToRemove.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Get text content
            const content = document.body.innerText;
            
            // Clean up whitespace
            return content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n');
        });
    } catch (error) {
        logger.error('Failed to extract text content:', error);
        throw new Error(`Text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

interface ExtractedLink {
    text: string;
    url: string;
}

export async function extractLinks(page: Page): Promise<ExtractedLink[]> {
    try {
        return await page.evaluate(() => {
            return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
                .map(a => ({
                    text: a.textContent?.trim() || '',
                    url: a.getAttribute('href') || ''
                }))
                .filter(link => 
                    link.text && 
                    link.url && 
                    !link.url.startsWith('#') && 
                    !link.url.startsWith('javascript:')
                );
        });
    } catch (error) {
        logger.error('Failed to extract links:', error);
        throw new Error(`Link extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function extractMetadata(page: Page): Promise<Record<string, string>> {
    try {
        return await page.evaluate(() => {
            const metadata: Record<string, string> = {};
            
            // Standard meta tags
            document.querySelectorAll('meta[name], meta[property]').forEach(meta => {
                const name = meta.getAttribute('name') || meta.getAttribute('property');
                const content = meta.getAttribute('content');
                if (name && content) {
                    metadata[name] = content;
                }
            });

            // Title
            const title = document.title;
            if (title) {
                metadata['title'] = title;
            }

            // Canonical URL
            const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
            if (canonical?.href) {
                metadata['canonical'] = canonical.href;
            }

            return metadata;
        });
    } catch (error) {
        logger.error('Failed to extract metadata:', error);
        throw new Error(`Metadata extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}