import { ResearchSession, ResearchResult } from '../types/index.js';
interface SessionSummary {
    query: string;
    resultCount: number;
    lastUpdated: string;
    results: Array<{
        title: string;
        url: string;
        timestamp: string;
        screenshotPath?: string;
    }>;
}
export declare function createSession(query?: string): string;
export declare function addResult(sessionId: string, result: ResearchResult): boolean;
export declare function getSession(sessionId: string): ResearchSession | undefined;
export declare function getResult(sessionId: string, index: number): ResearchResult | undefined;
export declare function updateSessionQuery(sessionId: string, query: string): boolean;
export declare function deleteSession(sessionId: string): boolean;
export declare function getSessionSummary(sessionId: string): SessionSummary | null;
export declare function getCurrentSession(): ResearchSession | undefined;
export declare function cleanup(): void;
export {};
