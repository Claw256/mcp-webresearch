# System Patterns

## Architecture Patterns

### 1. Browser Pool Pattern
- Singleton pool manager
- Lazy browser instance creation
- Instance recycling mechanism
- Health monitoring system
- Automatic cleanup of stale instances

### 2. Circuit Breaker Pattern
- State management (CLOSED, OPEN, HALF_OPEN)
- Failure counting
- Automatic recovery
- Request queuing
- Health monitoring

### 3. Retry Pattern
- Exponential backoff with jitter
- Error categorization
- Non-retryable error list
- Timeout management
- Resource cleanup

### 4. Session Management Pattern
- Research session tracking
- Result storage
- Screenshot management
- Session cleanup
- Resource quotas

## Key Technical Decisions

### 1. Timeout Management
```typescript
// Multiple timeout layers
withTimeout(
    async () => {
        // Operation timeout
        const result = await operation();
        // Resource cleanup
        cleanup();
        return result;
    },
    timeout
);
```

### 2. Error Handling
```typescript
// Error categorization
const NON_RETRYABLE_ERRORS = [
    'timeout',
    'Session closed',
    'Browser closed',
    // ...
];

// Error handling strategy
try {
    await operation();
} catch (error) {
    if (isNonRetryable(error)) {
        throw error;
    }
    await retry();
}
```

### 3. Resource Management
```typescript
// Resource lifecycle
try {
    const resource = await acquire();
    await use(resource);
} finally {
    await cleanup();
}
```

### 4. Consent Handling
```typescript
// Pre-emptive consent handling
await page.evaluate(() => {
    window.addEventListener('DOMContentLoaded', () => {
        const observer = new MutationObserver(() => {
            // Handle consent dialog
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
});
```

## Design Principles

### 1. Fail Fast
- Quick timeout detection
- Non-retryable error identification
- Resource limit enforcement
- Early validation

### 2. Clean Cleanup
- Proper resource disposal
- Timeout cleanup
- Memory management
- Stale resource removal

### 3. Graceful Degradation
- Circuit breaker protection
- Fallback mechanisms
- Error recovery
- Session persistence

### 4. Performance First
- Resource pooling
- Request queuing
- Memory limits
- Operation timeouts