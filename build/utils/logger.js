export class Logger {
    component;
    static logLevel = 'info';
    constructor(component) {
        this.component = component;
    }
    static setLogLevel(level) {
        Logger.logLevel = level;
    }
    formatMessage(level, message, data) {
        return {
            timestamp: new Date().toISOString(),
            level,
            component: this.component,
            message,
            data
        };
    }
    shouldLog(level) {
        const levels = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(Logger.logLevel);
    }
    log(level, message, data) {
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
    debug(message, data) {
        this.log('debug', message, data);
    }
    info(message, data) {
        this.log('info', message, data);
    }
    warn(message, data) {
        this.log('warn', message, data);
    }
    error(message, data) {
        this.log('error', message, data);
    }
}
//# sourceMappingURL=logger.js.map