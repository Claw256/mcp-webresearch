# Product Context

## Purpose
The MCP Web Research server provides tools for performing web research tasks through a Model Context Protocol (MCP) interface. It enables AI assistants to:
- Search Google for information
- Visit and extract content from web pages
- Take screenshots of web pages
- Manage research sessions and results

## Problems Solved
1. Web Access: Provides controlled and reliable web access capabilities to AI assistants
2. Content Extraction: Handles complex web scraping and content parsing
3. Session Management: Maintains research context and history
4. Resource Management: Handles browser lifecycle and resource cleanup
5. Error Handling: Provides robust error recovery and timeout management

## Expected Behavior
- Tools should execute reliably within reasonable timeouts
- Failed operations should be retried with appropriate backoff
- Resources should be properly cleaned up
- Errors should be handled gracefully with clear messages
- Operations should fail fast when appropriate
- Results should be properly stored in sessions