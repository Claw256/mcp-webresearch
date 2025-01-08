# Technical Context

## Technologies Used
- TypeScript/Node.js: Core server implementation
- Patchright: Undetected browser automation with Chromium
- MCP SDK: Model Context Protocol implementation
- Axios: HTTP client for API requests

## Development Setup
- Build System: TypeScript compiler (tsc)
- Package Manager: npm
- Testing: Jest (planned)
- Linting: ESLint (planned)

## Technical Constraints
1. Browser Management:
   - Limited concurrent browser instances
   - Memory usage limits per instance
   - Resource cleanup requirements
   - Non-headless mode for undetectability
   - Simplified context settings
   - Patchright's recommended configuration

2. Timeout Constraints:
   - Navigation timeout: 10s
   - Network idle timeout: 5s
   - Resource timeout: 3s
   - Overall operation timeout: 15s

3. Retry Constraints:
   - Maximum retries: 2
   - Initial delay: 500ms
   - Maximum delay: 2000ms
   - Exponential backoff with jitter

4. Memory Constraints:
   - Max memory per browser: 512MB
   - Screenshot size limit: 5MB
   - Total screenshot storage: 100MB

5. Performance Constraints:
   - CPU usage threshold: 70%
   - Memory usage threshold: 70%
   - Queue size limit: 1
   - Request timeout: 15s

## Error Handling Strategy
1. Non-retryable Errors:
   - Timeouts
   - Connection failures
   - Browser crashes
   - Navigation failures
   - Session closures

2. Retryable Errors:
   - Network fluctuations
   - Temporary resource issues
   - Transient failures

3. Resource Management:
   - Automatic cleanup of stale resources
   - Proper timeout handling
   - Memory leak prevention
   - Browser instance recycling

## Security Measures
1. URL Validation:
   - Protocol whitelist
   - Length limits
   - Domain validation

2. Resource Limits:
   - Request rate limiting
   - Concurrent operation limits
   - Storage quotas

3. Content Security:
   - CSP bypass controls
   - Resource type filtering
   - Response validation