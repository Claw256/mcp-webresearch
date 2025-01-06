import { CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { ensureBrowser, dismissGoogleConsent, safePageNavigation } from "../services/browser.js";
import { takeScreenshotWithSizeLimit, saveScreenshot } from "../services/screenshot.js";
import { extractContentAsMarkdown } from "../services/content.js";
import { addResult, getCurrentSession } from "../services/session.js";
import { withRetry, isValidUrl } from "../utils/index.js";
export function registerToolHandlers(server) {
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const page = await ensureBrowser();
        switch (request.params.name) {
            case "search_google": {
                const { query } = request.params.arguments;
                try {
                    const results = await withRetry(async () => {
                        await safePageNavigation(page, 'https://www.google.com');
                        await dismissGoogleConsent(page);
                        await withRetry(async () => {
                            await Promise.race([
                                page.waitForSelector('input[name="q"]', { timeout: 5000 }),
                                page.waitForSelector('textarea[name="q"]', { timeout: 5000 }),
                                page.waitForSelector('input[type="text"]', { timeout: 5000 })
                            ]).catch(() => {
                                throw new Error('Search input not found - no matching selectors');
                            });
                            const searchInput = await page.$('input[name="q"]') ||
                                await page.$('textarea[name="q"]') ||
                                await page.$('input[type="text"]');
                            if (!searchInput) {
                                throw new Error('Search input element not found after waiting');
                            }
                            await searchInput.click({ clickCount: 3 });
                            await searchInput.press('Backspace');
                            await searchInput.type(query);
                        }, 3, 2000);
                        await withRetry(async () => {
                            await Promise.all([
                                page.keyboard.press('Enter'),
                                page.waitForLoadState('networkidle', { timeout: 15000 }),
                            ]);
                        });
                        const searchResults = await withRetry(async () => {
                            const results = await page.evaluate(() => {
                                const elements = document.querySelectorAll('div.g');
                                if (!elements || elements.length === 0) {
                                    throw new Error('No search results found');
                                }
                                return Array.from(elements).map((el) => {
                                    const titleEl = el.querySelector('h3');
                                    const linkEl = el.querySelector('a');
                                    const snippetEl = el.querySelector('div.VwiC3b');
                                    if (!titleEl || !linkEl || !snippetEl) {
                                        return null;
                                    }
                                    return {
                                        title: titleEl.textContent || '',
                                        url: linkEl.getAttribute('href') || '',
                                        snippet: snippetEl.textContent || '',
                                    };
                                }).filter((result) => result !== null);
                            });
                            if (!results || results.length === 0) {
                                throw new Error('No valid search results found');
                            }
                            return results;
                        });
                        searchResults.forEach((result) => {
                            addResult({
                                url: result.url,
                                title: result.title,
                                content: result.snippet,
                                timestamp: new Date().toISOString(),
                            });
                        });
                        return searchResults;
                    });
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify(results, null, 2)
                            }]
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Failed to perform search: ${error.message}`
                            }],
                        isError: true
                    };
                }
            }
            case "visit_page": {
                const { url, takeScreenshot } = request.params.arguments;
                if (!isValidUrl(url)) {
                    return {
                        content: [{
                                type: "text",
                                text: `Invalid URL: ${url}. Only http and https protocols are supported.`
                            }],
                        isError: true
                    };
                }
                try {
                    const result = await withRetry(async () => {
                        await safePageNavigation(page, url);
                        const title = await page.title();
                        const content = await extractContentAsMarkdown(page);
                        if (!content) {
                            throw new Error('Failed to extract content');
                        }
                        const pageResult = {
                            url,
                            title,
                            content,
                            timestamp: new Date().toISOString(),
                        };
                        let screenshotUri;
                        if (takeScreenshot) {
                            const screenshot = await takeScreenshotWithSizeLimit(page);
                            const screenshotPath = await saveScreenshot(screenshot, title);
                            pageResult.screenshotPath = screenshotPath;
                            const resultIndex = getCurrentSession() ? getCurrentSession().results.length : 0;
                            screenshotUri = `research://screenshots/${resultIndex}`;
                            server.notification({
                                method: "notifications/resources/list_changed"
                            });
                        }
                        addResult(pageResult);
                        return { pageResult, screenshotUri };
                    });
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    url: result.pageResult.url,
                                    title: result.pageResult.title,
                                    content: result.pageResult.content,
                                    timestamp: result.pageResult.timestamp,
                                    screenshot: result.screenshotUri ?
                                        `View screenshot via *MCP Resources* (Paperclip icon) @ URI: ${result.screenshotUri}` :
                                        undefined
                                }, null, 2)
                            }]
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Failed to visit page: ${error.message}`
                            }],
                        isError: true
                    };
                }
            }
            case "take_screenshot": {
                try {
                    const screenshot = await withRetry(async () => {
                        return await takeScreenshotWithSizeLimit(page);
                    });
                    const pageUrl = await page.url();
                    const pageTitle = await page.title();
                    const screenshotPath = await saveScreenshot(screenshot, pageTitle || 'untitled');
                    const result = {
                        url: pageUrl,
                        title: pageTitle || "Untitled Page",
                        content: "Screenshot taken",
                        timestamp: new Date().toISOString(),
                        screenshotPath
                    };
                    addResult(result);
                    server.notification({
                        method: "notifications/resources/list_changed"
                    });
                    const resultIndex = getCurrentSession() ? getCurrentSession().results.length - 1 : 0;
                    const resourceUri = `research://screenshots/${resultIndex}`;
                    return {
                        content: [{
                                type: "text",
                                text: `Screenshot taken successfully. You can view it via *MCP Resources* (Paperclip icon) @ URI: ${resourceUri}`
                            }]
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Failed to take screenshot: ${error.message}`
                            }],
                        isError: true
                    };
                }
            }
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
    });
}
//# sourceMappingURL=tools.js.map