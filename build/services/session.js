import { SESSION_CONFIG } from '../config/index.js';
import { Logger } from '../utils/logger.js';
class SessionManager {
    static instance;
    sessions;
    logger;
    cleanupInterval;
    constructor() {
        this.sessions = new Map();
        this.logger = new Logger('SessionManager');
        this.startCleanupInterval();
    }
    static getInstance() {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }
    startCleanupInterval() {
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 60 * 60 * 1000); // Run every hour
    }
    cleanupExpiredSessions() {
        const now = Date.now();
        const expirationTime = SESSION_CONFIG.maxSessionAgeHours * 60 * 60 * 1000;
        for (const [sessionId, session] of this.sessions.entries()) {
            const lastUpdated = new Date(session.lastUpdated).getTime();
            if (now - lastUpdated > expirationTime) {
                this.sessions.delete(sessionId);
                this.logger.info(`Cleaned up expired session: ${sessionId}`);
            }
        }
    }
    validateResult(result) {
        if (!result.url || !result.title) {
            return false;
        }
        const contentSize = new TextEncoder().encode(result.content).length;
        return contentSize <= SESSION_CONFIG.maxContentSizeBytes;
    }
    currentSessionId;
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    getCurrentSessionId() {
        return this.currentSessionId;
    }
    createSession(query = "Research Session") {
        this.currentSessionId = this.generateSessionId();
        if (this.sessions.size >= SESSION_CONFIG.maxResultsPerSession) {
            this.logger.warn('Maximum session limit reached, cleaning oldest session');
            let oldestSession;
            for (const entry of this.sessions.entries()) {
                if (!oldestSession || new Date(entry[1].lastUpdated) < new Date(oldestSession[1].lastUpdated)) {
                    oldestSession = entry;
                }
            }
            if (oldestSession) {
                this.sessions.delete(oldestSession[0]);
            }
        }
        const sessionId = this.generateSessionId();
        this.sessions.set(sessionId, {
            id: sessionId,
            query,
            results: [],
            lastUpdated: new Date().toISOString()
        });
        this.logger.info(`Created new session: ${sessionId}`);
        return sessionId;
    }
    addResult(sessionId, result) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.error(`Session not found: ${sessionId}`);
            return false;
        }
        if (!this.validateResult(result)) {
            this.logger.error('Invalid result or content size exceeds limit');
            return false;
        }
        if (session.results.length >= SESSION_CONFIG.maxResultsPerSession) {
            session.results.shift();
            this.logger.info(`Removed oldest result from session ${sessionId} (max limit reached)`);
        }
        session.results.push(result);
        session.lastUpdated = new Date().toISOString();
        this.sessions.set(sessionId, session);
        this.logger.info(`Added result to session ${sessionId}`);
        return true;
    }
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.warn(`Session not found: ${sessionId}`);
            return undefined;
        }
        return { ...session };
    }
    getResult(sessionId, index) {
        const session = this.sessions.get(sessionId);
        if (!session || index < 0 || index >= session.results.length) {
            this.logger.warn(`Result not found: session ${sessionId}, index ${index}`);
            return undefined;
        }
        return { ...session.results[index] };
    }
    updateSessionQuery(sessionId, query) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.error(`Session not found: ${sessionId}`);
            return false;
        }
        session.query = query;
        session.lastUpdated = new Date().toISOString();
        this.sessions.set(sessionId, session);
        this.logger.info(`Updated query for session ${sessionId}`);
        return true;
    }
    deleteSession(sessionId) {
        const deleted = this.sessions.delete(sessionId);
        if (deleted) {
            this.logger.info(`Deleted session: ${sessionId}`);
        }
        else {
            this.logger.warn(`Failed to delete session: ${sessionId} (not found)`);
        }
        return deleted;
    }
    getSessionSummary(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.warn(`Session not found: ${sessionId}`);
            return null;
        }
        return {
            query: session.query,
            resultCount: session.results.length,
            lastUpdated: session.lastUpdated,
            results: session.results.map(r => ({
                title: r.title,
                url: r.url,
                timestamp: r.timestamp,
                screenshotPath: r.screenshotPath
            }))
        };
    }
    cleanup() {
        clearInterval(this.cleanupInterval);
        this.sessions.clear();
        this.logger.info('Cleaned up all sessions');
    }
}
// Singleton instance
const sessionManager = SessionManager.getInstance();
// Export functions that use the singleton
export function createSession(query) {
    return sessionManager.createSession(query);
}
export function addResult(sessionId, result) {
    return sessionManager.addResult(sessionId, result);
}
export function getSession(sessionId) {
    return sessionManager.getSession(sessionId);
}
export function getResult(sessionId, index) {
    return sessionManager.getResult(sessionId, index);
}
export function updateSessionQuery(sessionId, query) {
    return sessionManager.updateSessionQuery(sessionId, query);
}
export function deleteSession(sessionId) {
    return sessionManager.deleteSession(sessionId);
}
export function getSessionSummary(sessionId) {
    return sessionManager.getSessionSummary(sessionId);
}
export function getCurrentSession() {
    const currentId = sessionManager.getCurrentSessionId();
    return currentId ? sessionManager.getSession(currentId) : undefined;
}
export function cleanup() {
    return sessionManager.cleanup();
}
//# sourceMappingURL=session.js.map