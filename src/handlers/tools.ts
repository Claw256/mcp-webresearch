import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolHandlerResponse, SearchResult, ResearchResult } from "../types/index.js";
import { Page } from 'patchright';
import { ensureBrowser, dismissGoogleConsent, safePageNavigation, cleanupPage } from "../services/browser.js";
import { BROWSER_CONFIG } from "../config/index.js";
import { takeScreenshotWithSizeLimit, saveScreenshot } from "../services/screenshot.js";
import { extractContentAsMarkdown } from "../services/content.js";
import { addResult, getCurrentSession, createSession } from "../services/session.js";
import { withRetry, withTimeout } from "../utils/index.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger('ToolHandler');

const MCP_ERRORS = {
    InvalidRequest: ErrorCode.InvalidRequest,
    InvalidParams: ErrorCode.InvalidParams,
    MethodNotFound: ErrorCode.MethodNotFound,
    InternalError: ErrorCode.InternalError
} as const;

function createErrorResponse(error: unknown): ToolHandlerResponse {
    let mcpError: McpError;
    
    if (error instanceof McpError) {
        mcpError = error;
    } else {
        const message = error instanceof Error ? error.message : String(error);
        mcpError = new McpError(MCP_ERRORS.InternalError, message);
    }

    logger.error('Operation failed:', mcpError);
    return Promise.resolve({
        content: [{
            type: "text",
            text: mcpError.message
        }],
        isError: true,
        _meta: {
            code: mcpError.code
        }
    });
}

function createSuccessResponse(text: string, meta?: Record<string, unknown>): ToolHandlerResponse {
    return Promise.resolve({
        content: [{
            type: "text",
            text
        }],
        _meta: meta
    });
}

async function performGoogleSearch(page: Page, query: string): Promise<SearchResult[]> {
    if (page.isClosed()) {
        throw new McpError(MCP_ERRORS.InternalError, 'Browser page is not available');
    }

    return await withTimeout(async () => {
        // Navigate to Google with timeout
        await safePageNavigation(page, 'https://www.google.com');
        await dismissGoogleConsent(page);

        // Search input with shorter timeout
        const searchInput = await withTimeout(
            () => page.waitForSelector(
                'input[name="q"], textarea[name="q"], input[type="text"]'
            ),
            5000
        ).catch(() => null);

        if (!searchInput) {
            throw new McpError(MCP_ERRORS.InternalError, 'Search input not found');
        }

        // Type search query
        await searchInput.fill(query);

        // Submit search and wait for results
        await withTimeout(async () => {
            await Promise.all([
                page.keyboard.press('Enter'),
                page.waitForNavigation({
                    waitUntil: 'domcontentloaded'
                })
            ]);
        }, 8000).catch(() => {
            throw new McpError(MCP_ERRORS.InternalError, 'Search submission failed');
        });

        // Wait for results with short timeout
        const resultsPresent = await withTimeout(
            () => page.waitForSelector('div.g'),
            8000
        ).catch(() => null);

        if (!resultsPresent) {
            throw new McpError(MCP_ERRORS.InternalError, 'No search results found');
        }

        // Extract results immediately
        const searchResults = await page.$$eval('div.g', (elements) => {
            return elements.map((el) => {
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
            }).filter((result): result is SearchResult => 
                result !== null && 
                typeof result.title === 'string' &&
                typeof result.url === 'string' &&
                typeof result.snippet === 'string'
            );
        });

        if (!searchResults || searchResults.length === 0) {
            throw new McpError(MCP_ERRORS.InternalError, 'No valid search results found');
        }

        return searchResults;
    }, 30000); // Overall timeout for the entire search operation (increased to account for bot detection and delays)
}

export function registerToolHandlers(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "search_google",
                description: "Search Google and return results",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query"
                        }
                    },
                    required: ["query"]
                }
            },
            {
                name: "visit_page",
                description: "Visit a webpage and extract its content",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "URL to visit"
                        },
                        takeScreenshot: {
                            type: "boolean",
                            description: "Whether to take a screenshot of the page"
                        }
                    },
                    required: ["url"]
                }
            },
            {
                name: "take_screenshot",
                description: "Take a screenshot of the current page",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                name: "close_browser",
                description: "Close the current browser session",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        let page: Page | undefined;

        try {
            page = await ensureBrowser();
            if (!page) {
                throw new McpError(MCP_ERRORS.InternalError, 'Failed to initialize browser session');
            }

            const currentPage = page;

            // Validate request arguments
            if (!request.params.arguments || typeof request.params.arguments !== 'object') {
                throw new McpError(MCP_ERRORS.InvalidParams, 'Invalid or missing arguments');
            }

            switch (request.params.name) {
                case "search_google": {
                    const args = request.params.arguments as Record<string, unknown>;
                    if (!args.query || typeof args.query !== 'string') {
                        throw new McpError(MCP_ERRORS.InvalidParams, 'Query parameter must be a string');
                    }

                    const query = args.query;

                    try {
                        const results = await withRetry(
                            () => performGoogleSearch(currentPage, query),
                            2,  // maxRetries
                            1000  // initial delay
                        );

                        let sessionId = getCurrentSession()?.id;
                        if (!sessionId) {
                            sessionId = createSession(query);
                        }

                        results.forEach((result) => {
                            addResult(sessionId!, {
                                url: result.url,
                                title: result.title,
                                content: result.snippet,
                                timestamp: new Date().toISOString(),
                            });
                        });

                        return createSuccessResponse(JSON.stringify(results, null, 2));
                    } catch (error) {
                        return createErrorResponse(error);
                    }
                }

                case "visit_page": {
                    const args = request.params.arguments as Record<string, unknown>;
                    if (!args.url || typeof args.url !== 'string') {
                        throw new McpError(MCP_ERRORS.InvalidParams, 'URL parameter must be a string');
                    }

                    const takeScreenshot = typeof args.takeScreenshot === 'boolean' ? args.takeScreenshot : false;

                    try {
                        if (currentPage.isClosed()) {
                            throw new McpError(MCP_ERRORS.InternalError, 'Browser session has been closed');
                        }

                        const result = await withRetry(
                            () => withTimeout(async () => {
                                if (currentPage.isClosed()) {
                                    throw new McpError(MCP_ERRORS.InternalError, 'Page was closed during operation');
                                }

                                // Find and click the link that matches the URL
                                const targetUrl = args.url as string;
                                const found = await currentPage.evaluate((url) => {
                                    const links = Array.from(document.querySelectorAll('a'));
                                    const targetLink = links.find(link => link.href === url);
                                    if (targetLink) {
                                        targetLink.click();
                                        return true;
                                    }
                                    return false;
                                }, targetUrl);

                                if (!found) {
                                    // If link not found, fall back to direct navigation
                                    await safePageNavigation(currentPage, targetUrl);
                                } else {
                                    // Wait for navigation after clicking
                                    await currentPage.waitForNavigation({
                                        waitUntil: 'networkidle',
                                        timeout: BROWSER_CONFIG.navigationTimeout
                                    });
                                }
                                const title = await currentPage.title();
                                const content = await extractContentAsMarkdown(currentPage);

                                if (!content) {
                                    throw new McpError(MCP_ERRORS.InternalError, 'Failed to extract content');
                                }

                                let sessionId = getCurrentSession()?.id;
                                if (!sessionId) {
                                    sessionId = createSession(title);
                                }

                                const pageResult: ResearchResult = {
                                    url: args.url as string,
                                    title,
                                    content,
                                    timestamp: new Date().toISOString(),
                                };

                                let screenshotUri: string | undefined;
                                if (takeScreenshot && !currentPage.isClosed()) {
                                    const screenshot = await takeScreenshotWithSizeLimit(currentPage);
                                    const screenshotPath = await saveScreenshot(screenshot, title);
                                    pageResult.screenshotPath = screenshotPath;

                                    const resultIndex = getCurrentSession()?.results.length ?? 0;
                                    screenshotUri = `research://screenshots/${resultIndex}`;
                                }

                                addResult(sessionId, pageResult);
                                return { pageResult, screenshotUri };
                            }, 30000), // Increased timeout to match search_google
                            2, // maxRetries
                            1000 // initial delay
                        );

                        return createSuccessResponse(JSON.stringify({
                            url: result.pageResult.url,
                            title: result.pageResult.title,
                            content: result.pageResult.content,
                            timestamp: result.pageResult.timestamp,
                            screenshot: result.screenshotUri ? 
                                `View screenshot via *MCP Resources* (Paperclip icon) @ URI: ${result.screenshotUri}` : 
                                undefined
                        }, null, 2));
                    } catch (error) {
                        return createErrorResponse(error);
                    }
                }

                case "take_screenshot": {
                    if (currentPage.isClosed()) {
                        throw new McpError(MCP_ERRORS.InternalError, 'No active browser session');
                    }

                    const result = await withTimeout(async () => {
                        const screenshot = await takeScreenshotWithSizeLimit(currentPage);
                        const pageUrl = await currentPage.url();
                        const pageTitle = await currentPage.title();
                        const screenshotPath = await saveScreenshot(screenshot, pageTitle || 'untitled');

                        let sessionId = getCurrentSession()?.id;
                        if (!sessionId) {
                            sessionId = createSession('Screenshot Session');
                        }

                        const result: ResearchResult = {
                            url: pageUrl,
                            title: pageTitle || "Untitled Page",
                            content: "Screenshot taken",
                            timestamp: new Date().toISOString(),
                            screenshotPath
                        };

                        addResult(sessionId, result);

                        const resultIndex = getCurrentSession()?.results.length ?? 0;
                        return `research://screenshots/${resultIndex}`;
                    }, 5000).catch(error => {
                        throw new McpError(MCP_ERRORS.InternalError, `Screenshot failed: ${error.message}`);
                    });

                    return createSuccessResponse(
                        `Screenshot taken successfully. You can view it via *MCP Resources* (Paperclip icon) @ URI: ${result}`,
                        { uri: result }
                    );
                }

                case "close_browser": {
                    if (!page) {
                        return createSuccessResponse("No active browser session to close");
                    }

                    if (page.isClosed()) {
                        return createSuccessResponse("Browser session already closed");
                    }

                    await cleanupPage(page).catch(error => {
                        throw new McpError(MCP_ERRORS.InternalError, `Failed to close browser: ${error.message}`);
                    });

                    return createSuccessResponse("Browser session closed successfully", {
                        timestamp: new Date().toISOString()
                    });
                }

                default:
                    return createErrorResponse(new McpError(
                        MCP_ERRORS.MethodNotFound,
                        `Unknown tool: ${request.params.name}`
                    ));
            }
        } catch (error) {
            // Only cleanup page on error
            if (page) {
                await cleanupPage(page).catch(error => {
                    logger.error('Failed to cleanup page:', error);
                });
            }
            return createErrorResponse(error);
        }
    });
}