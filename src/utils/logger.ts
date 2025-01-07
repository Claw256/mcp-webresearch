export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMessage {
    timestamp: string;
    level: LogLevel;
    component: string;
    message: string;
    data?: unknown;
}

export class Logger {
    private component: string;
    private static logLevel: LogLevel = 'info';

    constructor(component: string) {
        this.component = component;
    }

    static setLogLevel(level: LogLevel): void {
        Logger.logLevel = level;
    }

    private formatMessage(level: LogLevel, message: string, data?: unknown): LogMessage {
        return {
            timestamp: new Date().toISOString(),
            level,
            component: this.component,
            message,
            data
        };
    }

    private shouldLog(level: LogLevel): boolean {
        const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(Logger.logLevel);
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        if (!this.shouldLog(level)) {
            return;
        }

        const logMessage = this.formatMessage(level, message, data);
        const output = `[${logMessage.timestamp}] [${logMessage.level.toUpperCase()}] [${logMessage.component}] ${logMessage.message}`;

        switch (level) {
            case 'debug':
                console.debug(output, data ?? '');
                break;
            case 'info':
                console.info(output, data ?? '');
                break;
            case 'warn':
                console.warn(output, data ?? '');
                break;
            case 'error':
                console.error(output, data ?? '');
                break;
        }
    }

    debug(message: string, data?: unknown): void {
        this.log('debug', message, data);
    }

    info(message: string, data?: unknown): void {
        this.log('info', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.log('warn', message, data);
    }

    error(message: string, data?: unknown): void {
        this.log('error', message, data);
    }
}