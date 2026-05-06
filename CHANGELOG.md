# Changelog

## 0.1.0

Initial release.

- Inline ghost-text completions via VS Code's `InlineCompletionItemProvider` API
- FIM prompting via Ollama's `/api/generate` `suffix` parameter
- LRU completion cache with prefix-extension lookup
- Seven-stage post-processor (whitespace, leading-newline, single-line, suffix-overlap, bracket-balance, prefix-echo, final-whitespace)
- Mid-line cursor skip
- HTTP Basic auth via OS keychain (`SecretStorage`)
- Commands: Set Credentials, Clear Credentials, Pick Model, Test Connection, Show Log
- Diagnostic logging to file and/or output channel
- Per-document debouncing with cancellation
