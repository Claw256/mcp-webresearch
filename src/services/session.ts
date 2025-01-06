import { ResearchSession, ResearchResult } from '../types/index.js';
import { MAX_RESULTS_PER_SESSION } from '../config/index.js';

// Global session state
let currentSession: ResearchSession | undefined;

// Add a new research result to the current session
export function addResult(result: ResearchResult): void {
    // Initialize new session if none exists
    if (!currentSession) {
        currentSession = {
            query: "Research Session",
            results: [],
            lastUpdated: new Date().toISOString(),
        };
    }

    // Remove oldest result if session is at capacity
    if (currentSession.results.length >= MAX_RESULTS_PER_SESSION) {
        currentSession.results.shift();
    }

    // Add new result and update timestamp
    currentSession.results.push(result);
    currentSession.lastUpdated = new Date().toISOString();
}

// Get current session
export function getCurrentSession(): ResearchSession | undefined {
    return currentSession;
}

// Get result by index
export function getResult(index: number): ResearchResult | undefined {
    return currentSession?.results[index];
}

// Clear current session
export function clearSession(): void {
    currentSession = undefined;
}

// Update session query
export function updateSessionQuery(query: string): void {
    if (currentSession) {
        currentSession.query = query;
        currentSession.lastUpdated = new Date().toISOString();
    }
}

// Get session summary
export function getSessionSummary(): any {
    if (!currentSession) {
        return null;
    }

    return {
        query: currentSession.query,
        resultCount: currentSession.results.length,
        lastUpdated: currentSession.lastUpdated,
        results: currentSession.results.map(r => ({
            title: r.title,
            url: r.url,
            timestamp: r.timestamp,
            screenshotPath: r.screenshotPath
        }))
    };
}