import { ResearchSession, ResearchResult } from '../types/index.js';
export declare function addResult(result: ResearchResult): void;
export declare function getCurrentSession(): ResearchSession | undefined;
export declare function getResult(index: number): ResearchResult | undefined;
export declare function clearSession(): void;
export declare function updateSessionQuery(query: string): void;
export declare function getSessionSummary(): any;
