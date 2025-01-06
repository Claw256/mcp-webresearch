import { Page } from 'playwright';
import TurndownService from "turndown";
import type { Node } from "turndown";

// Initialize Turndown service for converting HTML to Markdown
const turndownService: TurndownService = new TurndownService({
    headingStyle: 'atx',       // Use # style headings
    hr: '---',                 // Horizontal rule style
    bulletListMarker: '-',     // List item marker
    codeBlockStyle: 'fenced',  // Use ``` for code blocks
    emDelimiter: '_',          // Italics style
    strongDelimiter: '**',     // Bold style
    linkStyle: 'inlined',      // Use inline links
});

// Custom Turndown rules for better content extraction
turndownService.addRule('removeScripts', {
    filter: ['script', 'style', 'noscript'],
    replacement: () => ''
});

turndownService.addRule('preserveLinks', {
    filter: 'a',
    replacement: (content: string, node: Node) => {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute('href');
        return href ? `[${content}](${href})` : content;
    }
});

turndownService.addRule('preserveImages', {
    filter: 'img',
    replacement: (_content: string, node: Node) => {
        const element = node as HTMLImageElement;
        const alt = element.getAttribute('alt') || '';
        const src = element.getAttribute('src');
        return src ? `![${alt}](${src})` : '';
    }
});

// Convert HTML content to clean, readable markdown format
export async function extractContentAsMarkdown(
    page: Page,
    selector?: string
): Promise<string> {
    // Execute content extraction in browser context
    const html = await page.evaluate((sel) => {
        if (sel) {
            const element = document.querySelector(sel);
            return element ? element.outerHTML : '';
        }

        // Try standard content containers first
        const contentSelectors = [
            'main',           // HTML5 semantic main content
            'article',        // HTML5 semantic article content
            '[role="main"]',  // ARIA main content role
            '#content',       // Common content ID
            '.content',       // Common content class
            '.main',          // Alternative main class
            '.post',          // Blog post content
            '.article',       // Article content container
        ];

        // Try each selector in priority order
        for (const contentSelector of contentSelectors) {
            const element = document.querySelector(contentSelector);
            if (element) {
                return element.outerHTML;
            }
        }

        // Fallback to cleaning full body content
        const body = document.body;

        // Define elements to remove for cleaner content
        const elementsToRemove = [
            // Navigation elements
            'header',                    // Page header
            'footer',                    // Page footer
            'nav',                       // Navigation sections
            '[role="navigation"]',       // ARIA navigation elements

            // Sidebars and complementary content
            'aside',                     // Sidebar content
            '.sidebar',                  // Sidebar by class
            '[role="complementary"]',    // ARIA complementary content

            // Navigation-related elements
            '.nav',                      // Navigation classes
            '.menu',                     // Menu elements

            // Page structure elements
            '.header',                   // Header classes
            '.footer',                   // Footer classes

            // Advertising and notices
            '.advertisement',            // Advertisement containers
            '.ads',                      // Ad containers
            '.cookie-notice',            // Cookie consent notices
        ];

        // Remove each unwanted element from content
        elementsToRemove.forEach(sel => {
            body.querySelectorAll(sel).forEach(el => el.remove());
        });

        return body.outerHTML;
    }, selector);

    if (!html) {
        return '';
    }

    try {
        // Convert HTML to Markdown
        const markdown = turndownService.turndown(html);

        // Clean up and format markdown
        return markdown
            .replace(/\n{3,}/g, '\n\n')  // Replace excessive newlines with double
            .replace(/^- $/gm, '')       // Remove empty list items
            .replace(/^\s+$/gm, '')      // Remove whitespace-only lines
            .trim();                     // Remove leading/trailing whitespace

    } catch (error) {
        console.error('Error converting HTML to Markdown:', error);
        return html;
    }
}