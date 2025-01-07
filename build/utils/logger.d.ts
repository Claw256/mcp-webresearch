export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogMessage {
    timestamp: string;
    level: LogLevel;
    component: string;
    message: string;
    data?: unknown;
}
export declare class Logger {
    private component;
    private static logLevel;
    constructor(component: string);
    static setLogLevel(level: LogLevel): void;
    private formatMessage;
    private shouldLog;
    private log;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}
