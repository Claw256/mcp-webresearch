// Configuration constants for session management
export const MAX_RESULTS_PER_SESSION = 100; // Maximum number of results to store per session
export const MAX_RETRIES = 3; // Maximum retry attempts for operations
export const RETRY_DELAY = 1000; // Delay between retries in milliseconds
// Available tools for web research functionality
export const TOOLS = [
    {
        name: "search_google",
        description: "Search Google for a query",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" },
            },
            required: ["query"],
        },
    },
    {
        name: "visit_page",
        description: "Visit a webpage and extract its content",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL to visit" },
                takeScreenshot: { type: "boolean", description: "Whether to take a screenshot" },
            },
            required: ["url"],
        },
    },
    {
        name: "take_screenshot",
        description: "Take a screenshot of the current page",
        inputSchema: {
            type: "object",
            properties: {}, // No parameters needed
        },
    },
];
// Configure available prompts with their specifications
export const PROMPTS = {
    "agentic-research": {
        name: "agentic-research",
        description: "Conduct iterative web research on a topic, exploring it thoroughly through multiple steps while maintaining a dialogue with the user",
        arguments: [
            {
                name: "topic",
                description: "The topic or question to research",
                required: true
            }
        ]
    }
};
// Regions that commonly show cookie/consent banners
export const CONSENT_REGIONS = [
    // Europe
    '.google.de', '.google.fr', '.google.co.uk',
    '.google.it', '.google.es', '.google.nl',
    '.google.pl', '.google.ie', '.google.dk',
    '.google.no', '.google.se', '.google.fi',
    '.google.at', '.google.ch', '.google.be',
    '.google.pt', '.google.gr', '.google.com.tr',
    // Asia Pacific
    '.google.co.id', '.google.com.sg', '.google.co.th',
    '.google.com.my', '.google.com.ph', '.google.com.au',
    '.google.co.nz', '.google.com.vn',
    // Generic domains
    '.google.com', '.google.co'
];
//# sourceMappingURL=index.js.map