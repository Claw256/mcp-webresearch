import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolHandlerResponse, SearchResult, PageResult, ResearchResult } from "../types/index.js";
import { Page } from 'playwright';
import { ensureBrowser, dismissGoogleConsent, safePageNavigation, cleanupPage } from "../services/browser.js";
import { takeScreenshotWithSizeLimit, saveScreenshot } from "../services/screenshot.js";
import { extractContentAsMarkdown } from "../services/content.js";
import { addResult, getCurrentSession, createSession } from "../services/session.js";
import { withRetry, isValidUrl } from "../utils/index.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger('ToolHandler');

const MCP_ERRORS = {
    InvalidRequest: ErrorCode.InvalidRequest,
    InvalidParams: ErrorCode.InvalidParams,
    MethodNotFound: ErrorCode.MethodNotFound,
    InternalError: ErrorCode.InternalError
} as const;

function createErrorResponse(error: unknown): ToolHandlerResponse {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Operation failed:', error);
    return Promise.resolve({
        content: [{
            type: "text",
            text: message
        }],
        isError: true
    });
}

function createSuccessResponse(text: string): ToolHandlerResponse {
    return Promise.resolve({
        content: [{
            type: "text",
            text
        }]
    });
}

async function performGoogleSearch(page: Page, query: string): Promise<SearchResult[]> {
    if (page.isClosed()) {
        throw new McpError(MCP_ERRORS.InternalError, 'Browser page is not available');
    }

    await safePageNavigation(page, 'https://www.google.com');
    await dismissGoogleConsent(page);

    const searchInput = await page.waitForSelector(
        'input[name="q"], textarea[name="q"], input[type="text"]',
        { timeout: 5000 }
    );

    if (!searchInput) {
        throw new McpError(MCP_ERRORS.InternalError, 'Search input not found');
    }

    await searchInput.fill(query);

    await Promise.all([
        page.keyboard.press('Enter'),
        page.waitForNavigation({
            waitUntil: 'domcontentloaded',
            timeout: 5000
        })
    ]).catch(() => {
        throw new McpError(MCP_ERRORS.InternalError, 'Search submission failed');
    });

    const resultsPresent = await page.waitForSelector('div.g', { timeout: 5000 });
    if (!resultsPresent) {
        throw new McpError(MCP_ERRORS.InternalError, 'No search results found');
    }

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
        }).filter((result): result is SearchResult => result !== null);
    });

    if (!searchResults || searchResults.length === 0) {
        throw new McpError(MCP_ERRORS.InternalError, 'No valid search results found');
    }

    return searchResults;
}

async function performVisitPage(page: Page, url: string, takeScreenshot: boolean): Promise<PageResult> {
    if (page.isClosed()) {
        throw new McpError(MCP_ERRORS.InternalError, 'Page was closed during operation');
    }

    await safePageNavigation(page, url);
    const title = await page.title();
    const content = await extractContentAsMarkdown(page);

    if (!content) {
        throw new McpError(MCP_ERRORS.InternalError, 'Failed to extract content');
    }

    let sessionId = getCurrentSession()?.id;
    if (!sessionId) {
        sessionId = createSession(title);
    }

    const pageResult: ResearchResult = {
        url,
        title,
        content,
        timestamp: new Date().toISOString(),
    };

    let screenshotUri: string | undefined;
    if (takeScreenshot && !page.isClosed()) {
        const screenshot = await takeScreenshotWithSizeLimit(page);
        const screenshotPath = await saveScreenshot(screenshot, title);
        pageResult.screenshotPath = screenshotPath;

        const resultIndex = getCurrentSession()?.results.length ?? 0;
        screenshotUri = `research://screenshots/${resultIndex}`;
    }

    addResult(sessionId, pageResult);
    return { pageResult, screenshotUri };
}

async function performScreenshot(page: Page): Promise<string> {
    if (page.isClosed()) {
        throw new McpError(MCP_ERRORS.InternalError, 'Page was closed during operation');
    }

    const screenshot = await takeScreenshotWithSizeLimit(page);
    const pageUrl = await page.url();
    const pageTitle = await page.title();
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
            }
        ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        let page: Page | undefined;

        try {
            page = await ensureBrowser();
            if (!page) {
                throw new McpError(MCP_ERRORS.InternalError, 'Failed to initialize browser');
            }

            const currentPage = page;

            switch (request.params.name) {
                case "search_google": {
                    if (!request.params.arguments || typeof request.params.arguments !== 'object') {
                        return createErrorResponse(new McpError(MCP_ERRORS.InvalidParams, 'Invalid arguments'));
                    }

                    const args = request.params.arguments as Record<string, unknown>;
                    if (!args.query || typeof args.query !== 'string') {
                        return createErrorResponse(new McpError(MCP_ERRORS.InvalidParams, 'Query parameter must be a string'));
                    }

                    const query = args.query;

                    try {
                        const timeoutPromise = new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new McpError(MCP_ERRORS.InternalError, 'Operation timed out')), 15000)
                        );

                        const searchPromise = withRetry(
                            () => performGoogleSearch(currentPage, query),
                            2,
                            1000
                        );

                        const results = await Promise.race([searchPromise, timeoutPromise]);

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
                    if (!request.params.arguments || typeof request.params.arguments !== 'object') {
                        return createErrorResponse(new McpError(MCP_ERRORS.InvalidParams, 'Invalid arguments'));
                    }

                    const args = request.params.arguments as Record<string, unknown>;
                    if (!args.url || typeof args.url !== 'string') {
                        return createErrorResponse(new McpError(MCP_ERRORS.InvalidParams, 'URL parameter must be a string'));
                    }

                    if (!isValidUrl(args.url)) {
                        return createErrorResponse(new McpError(
                            MCP_ERRORS.InvalidParams,
                            `Invalid URL: ${args.url}. Only http and https protocols are supported.`
                        ));
                    }

                    const takeScreenshot = typeof args.takeScreenshot === 'boolean' ? args.takeScreenshot : false;

                    try {
                        const result = await withRetry(
                            () => performVisitPage(currentPage, args.url as string, takeScreenshot),
                            2,
                            1000
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
                    try {
                        const result = await withRetry(
                            () => performScreenshot(currentPage),
                            2,
                            1000
                        );

                        return createSuccessResponse(
                            `Screenshot taken successfully. You can view it via *MCP Resources* (Paperclip icon) @ URI: ${result}`
                        );
                    } catch (error) {
                        return createErrorResponse(error);
                    }
                }

                default:
                    return createErrorResponse(new McpError(
                        MCP_ERRORS.MethodNotFound,
                        `Unknown tool: ${request.params.name}`
                    ));
            }
        } catch (error) {
            return createErrorResponse(error);
        } finally {
            if (page) {
                await cleanupPage(page).catch(error => {
                    logger.error('Failed to cleanup page:', error);
                });
            }
        }
    });
}