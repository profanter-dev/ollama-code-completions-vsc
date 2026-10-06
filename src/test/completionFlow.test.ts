import * as assert from 'assert';
import type * as vscode from 'vscode';

import type { Config } from '../config';
import type { InlineProvider as ProviderType } from '../completion/provider';
import type { CompletionCache as CacheType } from '../completion/cache';
import type { Logger as LoggerType } from '../logger';
import type { OllamaClient as ClientType } from '../ollama/client';
import type { StatusBar } from '../statusBar';
import type { CompletionResult } from '../ollama/types';

// VS Code is not available in the Node unit-test runner.
class Position {
    constructor(readonly line: number, readonly character: number) {}
}

class Range {
    constructor(readonly start: Position, readonly end: Position) {}
}

class InlineCompletionItem {
    constructor(readonly insertText: string, readonly range: Range) {}
}

const loader = require('module') as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
    return id === 'vscode' ? { Position, Range, InlineCompletionItem } : originalLoad.call(this, id, ...args);
};

let OllamaClient: typeof ClientType;
let InlineProvider: typeof ProviderType;
let CompletionCache: typeof CacheType;
let Logger: typeof LoggerType;

try {
    ({ OllamaClient } = require('../ollama/client'));
    ({ InlineProvider } = require('../completion/provider'));
    ({ CompletionCache } = require('../completion/cache'));
    ({ Logger } = require('../logger'));
} finally {
    loader._load = originalLoad;
}

const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
} as unknown as vscode.CancellationToken;

describe('completion requests across prompt changes', () => {
    const originalGet = Logger.get;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        Logger.get = () => ({ log() {}, error() {} }) as unknown as LoggerType;
    });
    afterEach(() => {
        Logger.get = originalGet;
        globalThis.fetch = originalFetch;
    });

    it('uses the template flow if show is unsupported, and caches that decision', async () => {
        const config = {
            serverUrl: 'http://example.invalid', model: 'qwen2.5-coder:1.5b', promptMode: 'auto',
            timeoutSeconds: 1, maxPredict: 20, useAuthentication: false,
        } as Config;
        const client = new OllamaClient(config, {} as ConstructorParameters<typeof OllamaClient>[1]);
        let showCalls = 0;
        const generated: Array<{ prompt: string; suffix?: string; raw?: boolean; think?: boolean }> = [];
        globalThis.fetch = async (url, init) => {
            if (String(url).endsWith('/api/show')) {
                showCalls++;
                return new Response('unsupported', { status: 404 });
            }
            generated.push(JSON.parse(String(init?.body)));
            return Response.json({ response: 'suggestion' });
        };

        const request = { prefix: 'before', suffix: 'after' };
        assert.strictEqual((await client.complete(request, token))?.text, 'suggestion');
        assert.strictEqual((await client.complete(request, token))?.text, 'suggestion');
        assert.strictEqual(showCalls, 1);
        assert.strictEqual(generated.length, 2);
        assert.strictEqual(generated[0].prompt, 'before');
        assert.strictEqual(generated[0].suffix, 'after');
        assert.strictEqual(generated[0].raw, undefined);
        assert.strictEqual(generated[0].think, false);
        assert.deepStrictEqual(generated[1], generated[0]);
    });

    it('does not mask show authorization failures by falling back', async () => {
        const config = {
            serverUrl: 'http://example.invalid', model: 'qwen2.5-coder:1.5b', promptMode: 'auto',
            timeoutSeconds: 1, maxPredict: 20, useAuthentication: false,
        } as Config;
        const client = new OllamaClient(config, {} as ConstructorParameters<typeof OllamaClient>[1]);
        let generated = false;
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('/api/show')) {
                return new Response('unauthorized', { status: 401 });
            }
            generated = true;
            return Response.json({ response: 'suggestion' });
        };

        await assert.rejects(client.complete({ prefix: 'before', suffix: 'after' }, token), /HTTP 401/);
        assert.strictEqual(generated, false);
    });

    it('uses the native FIM template at end of file and disables thinking', async () => {
        const config = {
            serverUrl: 'http://example.invalid', model: 'qwen2.5-coder:1.5b', promptMode: 'auto',
            timeoutSeconds: 1, maxPredict: 20, useAuthentication: false,
        } as Config;
        const client = new OllamaClient(config, {} as ConstructorParameters<typeof OllamaClient>[1]);
        let generated!: { prompt: string; suffix?: string; raw?: boolean; think?: boolean };
        globalThis.fetch = async (url, init) => {
            if (String(url).endsWith('/api/show')) {
                return Response.json({ capabilities: ['completion', 'insert'] });
            }
            generated = JSON.parse(String(init?.body));
            return Response.json({ response: 'suggestion' });
        };

        assert.strictEqual((await client.complete({ prefix: 'before', suffix: '' }, token))?.text, 'suggestion');
        assert.strictEqual(generated.prompt, 'before');
        assert.strictEqual(generated.suffix, '\n');
        assert.strictEqual(generated.raw, undefined);
        assert.strictEqual(generated.think, false);
    });

    it('generates an insertion at the start of an empty document', async () => {
        const config = {
            serverUrl: 'http://example.invalid', model: 'granite-fim', promptMode: 'auto',
            timeoutSeconds: 1, maxPredict: 20, useAuthentication: false,
        } as Config;
        const client = new OllamaClient(config, {} as ConstructorParameters<typeof OllamaClient>[1]);
        let generated!: { prompt: string; suffix?: string };
        globalThis.fetch = async (url, init) => {
            if (String(url).endsWith('/api/show')) {
                return Response.json({ capabilities: ['completion', 'insert'] });
            }
            generated = JSON.parse(String(init?.body));
            // Ollama interprets an empty generate prompt as a model-load request.
            return Response.json({ response: generated.prompt ? 'const answer = 42;' : '' });
        };

        assert.strictEqual((await client.complete({ prefix: '', suffix: '' }, token))?.text, 'const answer = 42;');
        assert.strictEqual(generated.prompt, '\n');
        assert.strictEqual(generated.suffix, '\n');
    });

    it('refreshes the format after credentials change and discards an obsolete show result', async () => {
        const config = {
            serverUrl: 'http://example.invalid', model: 'shared-name', promptMode: 'auto',
            fimTemplate: '<PRE>{prefix}<SUF>{suffix}<MID>',
            timeoutSeconds: 1, maxPredict: 20, useAuthentication: true,
        } as Config;
        let username = 'alice';
        const client = new OllamaClient(config, {
            get: async () => ({ username, password: 'password' }),
        } as ConstructorParameters<typeof OllamaClient>[1]);
        let finishOldShow!: (response: Response) => void;
        let oldShowStarted!: () => void;
        const oldShowStartedPromise = new Promise<void>((resolve) => { oldShowStarted = resolve; });
        let showCalls = 0;
        const generated: Array<{ auth: string; raw?: boolean; suffix?: string }> = [];
        globalThis.fetch = async (url, init) => {
            const auth = String((init?.headers as Record<string, string>).Authorization);
            if (String(url).endsWith('/api/show')) {
                showCalls++;
                if (showCalls === 1) {
                    oldShowStarted();
                    return new Promise<Response>((resolve) => { finishOldShow = resolve; });
                }
                return Response.json({ capabilities: ['completion'] });
            }
            const body = JSON.parse(String(init?.body));
            generated.push({ auth, raw: body.raw, suffix: body.suffix });
            return Response.json({ response: 'suggestion' });
        };

        const old = client.complete({ prefix: 'before', suffix: 'after' }, token);
        await oldShowStartedPromise;
        username = 'bob';
        client.clearCapabilities();
        assert.strictEqual((await client.complete({ prefix: 'before', suffix: 'after' }, token))?.text, 'suggestion');
        finishOldShow(Response.json({ capabilities: ['insert'] }));
        assert.strictEqual(await old, null);
        assert.strictEqual(showCalls, 2);
        assert.deepStrictEqual(generated, [{
            auth: `Basic ${Buffer.from('bob:password').toString('base64')}`, raw: true, suffix: undefined,
        }]);
    });

    it('settles a cancelled completion without aborting another caller’s shared show lookup', async () => {
        const config = {
            serverUrl: 'http://example.invalid', model: 'qwen2.5-coder:1.5b', promptMode: 'auto',
            timeoutSeconds: 10, maxPredict: 20, useAuthentication: false,
        } as Config;
        const client = new OllamaClient(config, {} as ConstructorParameters<typeof OllamaClient>[1]);
        let finishShow!: (response: Response) => void;
        let showStarted!: () => void;
        const started = new Promise<void>((resolve) => { showStarted = resolve; });
        const showResponse = new Promise<Response>((resolve) => { finishShow = resolve; });
        let showCalls = 0;
        let showAborted = false;
        globalThis.fetch = async (url, init) => {
            if (String(url).endsWith('/api/show')) {
                showCalls++;
                init?.signal?.addEventListener('abort', () => { showAborted = true; });
                showStarted();
                return showResponse;
            }
            return Response.json({ response: 'suggestion' });
        };
        const cancelToken = {
            isCancellationRequested: false,
            onCancellationRequested(listener: () => void) {
                this.cancel = () => { this.isCancellationRequested = true; listener(); };
                return { dispose() {} };
            },
            cancel() {},
        };

        const first = client.complete({ prefix: 'before', suffix: 'after' }, cancelToken as unknown as vscode.CancellationToken);
        await started;
        const second = client.complete({ prefix: 'before', suffix: 'after' }, token);
        cancelToken.cancel();
        assert.strictEqual(await Promise.race([first, new Promise((resolve) => setTimeout(() => resolve('pending'), 100))]), null);
        finishShow(Response.json({ capabilities: ['insert'] }));
        assert.strictEqual((await second)?.text, 'suggestion');
        assert.strictEqual(showCalls, 1);
        assert.strictEqual(showAborted, false);
    });

    it('retries a failed show lookup after its original caller cancels', async () => {
        const config = {
            serverUrl: 'http://example.invalid', model: 'qwen2.5-coder:1.5b', promptMode: 'auto',
            timeoutSeconds: 10, maxPredict: 20, useAuthentication: false,
        } as Config;
        const client = new OllamaClient(config, {} as ConstructorParameters<typeof OllamaClient>[1]);
        let rejectShow!: (reason: Error) => void;
        let showStarted!: () => void;
        const started = new Promise<void>((resolve) => { showStarted = resolve; });
        let showCalls = 0;
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('/api/show')) {
                if (++showCalls === 1) {
                    return new Promise<Response>((_, reject) => {
                        rejectShow = reject;
                        showStarted();
                    });
                }
                return Response.json({ capabilities: ['insert'] });
            }
            return Response.json({ response: 'suggestion' });
        };
        const cancelToken = {
            isCancellationRequested: false,
            onCancellationRequested(listener: () => void) {
                this.cancel = () => { this.isCancellationRequested = true; listener(); };
                return { dispose() {} };
            },
            cancel() {},
        };
        const first = client.complete({ prefix: 'before', suffix: 'after' }, cancelToken as unknown as vscode.CancellationToken);
        await started;
        cancelToken.cancel();
        assert.strictEqual(await first, null);
        rejectShow(new Error('show failed'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual((await client.complete({ prefix: 'before', suffix: 'after' }, token))?.text, 'suggestion');
        assert.strictEqual(showCalls, 2);
    });

    it('discards a completion started before the cache was cleared', async () => {
        const config = {
            enabled: true, midLineMode: 'smart', multilineMode: 'never', maxCompletionLines: 6,
            maxPrefixChars: 4096, maxSuffixChars: 1024, debounceMs: 0,
        } as Config;
        const text = 'const answer = ';
        const document = {
            languageId: 'typescript', uri: { scheme: 'untitled' }, lineCount: 1,
            lineAt: () => ({ text }),
            getText: (range: Range) => text.slice(range.start.character, range.end.character),
        } as unknown as vscode.TextDocument;
        const position = new Position(0, text.length) as vscode.Position;
        const cache = new CompletionCache();
        const status = {
            currentState: 'idle',
            setThinking() { this.currentState = 'thinking'; },
            setIdle() { this.currentState = 'idle'; },
        };
        let started!: () => void;
        const invoked = new Promise<void>((resolve) => { started = resolve; });
        let finish!: (value: CompletionResult) => void;
        let calls = 0;
        const client = {
            complete: async () => {
                calls++;
                if (calls === 1) {
                    started();
                    return new Promise<CompletionResult>((resolve) => { finish = resolve; });
                }
                return { text: 'fresh', elapsedMs: 1 };
            },
        } as unknown as InstanceType<typeof OllamaClient>;
        const provider = new InlineProvider(config, client, cache, status as unknown as StatusBar);

        const pending = provider.provideInlineCompletionItems(document, position, {} as vscode.InlineCompletionContext, token);
        await invoked;
        cache.clear();
        finish({ text: 'stale', elapsedMs: 1 });
        assert.strictEqual(await pending, undefined);
        assert.strictEqual(status.currentState, 'idle');
        assert.strictEqual(cache.size, 0);
        const next = await provider.provideInlineCompletionItems(document, position, {} as vscode.InlineCompletionContext, token);
        assert.strictEqual(next?.[0].insertText, 'fresh');
        assert.strictEqual(calls, 2);
    });

    it('does not let a stale failure replace a newer request status', async () => {
        const config = {
            enabled: true, midLineMode: 'smart', multilineMode: 'never', maxCompletionLines: 6,
            maxPrefixChars: 4096, maxSuffixChars: 1024, debounceMs: 0,
        } as Config;
        const text = 'const answer = ';
        const document = {
            languageId: 'typescript', uri: { scheme: 'untitled' }, lineCount: 1,
            lineAt: () => ({ text }),
            getText: (range: Range) => text.slice(range.start.character, range.end.character),
        } as unknown as vscode.TextDocument;
        const position = new Position(0, text.length) as vscode.Position;
        const cache = new CompletionCache();
        const status = {
            currentState: 'idle',
            setThinking() { this.currentState = 'thinking'; },
            setIdle() { this.currentState = 'idle'; },
            setError() { this.currentState = 'error'; },
        };
        let firstStarted!: () => void;
        const firstInvoked = new Promise<void>((resolve) => { firstStarted = resolve; });
        let secondStarted!: () => void;
        const secondInvoked = new Promise<void>((resolve) => { secondStarted = resolve; });
        let failFirst!: (reason: Error) => void;
        let finishSecond!: (value: CompletionResult) => void;
        let calls = 0;
        const client = {
            complete: () => {
                calls++;
                if (calls === 1) {
                    firstStarted();
                    return new Promise<CompletionResult>((_, reject) => { failFirst = reject; });
                }
                secondStarted();
                return new Promise<CompletionResult>((resolve) => { finishSecond = resolve; });
            },
        } as unknown as InstanceType<typeof OllamaClient>;
        const provider = new InlineProvider(config, client, cache, status as unknown as StatusBar);

        const first = provider.provideInlineCompletionItems(document, position, {} as vscode.InlineCompletionContext, token);
        await firstInvoked;
        cache.clear();
        const second = provider.provideInlineCompletionItems(document, position, {} as vscode.InlineCompletionContext, token);
        await secondInvoked;
        failFirst(new Error('obsolete server error'));
        assert.strictEqual(await first, undefined);
        assert.strictEqual(status.currentState, 'thinking');
        finishSecond({ text: 'fresh', elapsedMs: 1 });
        assert.strictEqual((await second)?.[0].insertText, 'fresh');
        assert.strictEqual(status.currentState, 'idle');
    });
});
