import { 
    CallToolRequestSchema, 
    McpError, 
    ErrorCode,
    TextContent
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

// Error codes from MCP SDK
const MCP_ERRORS = {
    InvalidRequest: ErrorCode.InvalidRequest,
    InvalidParams: ErrorCode.InvalidParams,
    MethodNotFound: ErrorCode.MethodNotFound,
    InternalError: ErrorCode.InternalError
} as const;

interface SearchArguments {
    query: string;
}

interface VisitPageArguments {
    url: string;
    takeScreenshot?: boolean;
}

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

export function registerToolHandlers(server: Server): void {
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        let page: Page | undefined;

        try {
            page = await ensureBrowser();
            if (!page) {
                throw new McpError(MCP_ERRORS.InternalError, 'Failed to initialize browser');
            }

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
                        const results = await withRetry(async () => {
                            await safePageNavigation(page!, 'https://www.google.com');
                            await dismissGoogleConsent(page!);

                            await withRetry(async () => {
                                await Promise.race([
                                    page!.waitForSelector('input[name="q"]', { timeout: 5000 }),
                                    page!.waitForSelector('textarea[name="q"]', { timeout: 5000 }),
                                    page!.waitForSelector('input[type="text"]', { timeout: 5000 })
                                ]).catch(() => {
                                    throw new McpError(MCP_ERRORS.InternalError, 'Search input not found');
                                });

                                const searchInput = await page!.$('input[name="q"]') ||
                                    await page!.$('textarea[name="q"]') ||
                                    await page!.$('input[type="text"]');

                                if (!searchInput) {
                                    throw new McpError(MCP_ERRORS.InternalError, 'Search input not found after waiting');
                                }

                                await searchInput.click({ clickCount: 3 });
                                await searchInput.press('Backspace');
                                await searchInput.type(query);
                            }, 3, 2000);

                            await withRetry(async () => {
                                await Promise.all([
                                    page!.keyboard.press('Enter'),
                                    page!.waitForLoadState('networkidle', { timeout: 15000 }),
                                ]);
                            });

                            const searchResults = await withRetry(async () => {
                                const results = await page!.evaluate(() => {
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
                                    }).filter((result): result is SearchResult => result !== null);
                                });

                                if (!results || results.length === 0) {
                                    throw new McpError(MCP_ERRORS.InternalError, 'No valid search results found');
                                }

                                return results;
                            });

                            // Ensure we have a session
                            let sessionId = getCurrentSession()?.id;
                            if (!sessionId) {
                                sessionId = createSession(query);
                            }

                            searchResults.forEach((result) => {
                                addResult(sessionId!, {
                                    url: result.url,
                                    title: result.title,
                                    content: result.snippet,
                                    timestamp: new Date().toISOString(),
                                });
                            });

                            return searchResults;
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

                    const visitArgs: VisitPageArguments = {
                        url: args.url,
                        takeScreenshot: typeof args.takeScreenshot === 'boolean' ? args.takeScreenshot : false
                    };

                    try {
                        const result = await withRetry(async () => {
                            await safePageNavigation(page!, visitArgs.url);
                            const title = await page!.title();
                            const content = await extractContentAsMarkdown(page!);

                            if (!content) {
                                throw new McpError(MCP_ERRORS.InternalError, 'Failed to extract content');
                            }

                            // Ensure we have a session
                            let sessionId = getCurrentSession()?.id;
                            if (!sessionId) {
                                sessionId = createSession(title);
                            }

                            const pageResult: ResearchResult = {
                                url: visitArgs.url,
                                title,
                                content,
                                timestamp: new Date().toISOString(),
                            };

                            let screenshotUri: string | undefined;
                            if (visitArgs.takeScreenshot) {
                                const screenshot = await takeScreenshotWithSizeLimit(page!);
                                const screenshotPath = await saveScreenshot(screenshot, title);
                                pageResult.screenshotPath = screenshotPath;

                                const resultIndex = getCurrentSession()?.results.length ?? 0;
                                screenshotUri = `research://screenshots/${resultIndex}`;

                                server.notification({
                                    method: "notifications/resources/list_changed"
                                });
                            }

                            addResult(sessionId, pageResult);
                            return { pageResult, screenshotUri } as PageResult;
                        });

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
                        const result = await withRetry(async () => {
                            const screenshot = await takeScreenshotWithSizeLimit(page!);
                            const pageUrl = await page!.url();
                            const pageTitle = await page!.title();
                            const screenshotPath = await saveScreenshot(screenshot, pageTitle || 'untitled');

                            // Ensure we have a session
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

                            server.notification({
                                method: "notifications/resources/list_changed"
                            });

                            const resultIndex = getCurrentSession()?.results.length ?? 0;
                            return `research://screenshots/${resultIndex}`;
                        });

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