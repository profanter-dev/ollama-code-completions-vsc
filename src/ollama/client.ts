import * as vscode from 'vscode';
import { Config } from '../config';
import { Credentials } from '../auth/credentials';
import { Logger } from '../logger';
import {
    CompletionRequest,
    CompletionResult,
    GenerateRequest,
    GenerateResponse,
    OllamaError,
    ShowResponse,
    TagsResponse,
} from './types';

type PromptFormat = 'template' | 'raw';

export class OllamaClient {
    private capabilityLookup?: { model: string; serverUrl: string; promise: Promise<PromptFormat> };
    private capabilityGeneration = 0;

    clearCapabilities(): void {
        this.capabilityLookup = undefined;
        this.capabilityGeneration++;
    }

    private async resolvePromptFormat(model: string, token: vscode.CancellationToken): Promise<PromptFormat | null> {
        if (token.isCancellationRequested) {
            return null;
        }

        const serverUrl = this.config.serverUrl;
        const cached = this.capabilityLookup;

        if (cached?.model === model && cached.serverUrl === serverUrl) {
            return waitForCancellation(cached.promise, token);
        }

        // The lookup is shared; cancelling one completion must not abort it for other callers.
        const lookup = {
            model,
            serverUrl,
            promise: this.post<ShowResponse>('/api/show', { model }).then(
                (show): PromptFormat => !Array.isArray(show?.capabilities)
                    ? 'template'
                    : show.capabilities.includes('insert') ? 'template' : 'raw',
                (err): PromptFormat => {
                    // A missing model also yields 404; do not cache it as an unsupported endpoint.
                    if (err instanceof OllamaError) {
                        if (err.httpStatus === 404 && isMissingModel(err.responseBody)) {
                            throw err;
                        }

                        if (err.httpStatus === 404 || err.httpStatus === 405 || err.httpStatus === 501) {
                            return 'template';
                        }
                    }

                    throw err;
                }
            ),
        };

        this.capabilityLookup = lookup;

        // Clear failed lookups even if every caller has stopped waiting for them.
        void lookup.promise.catch(() => {
            if (this.capabilityLookup === lookup) {
                this.capabilityLookup = undefined;
            }
        });

        return waitForCancellation(lookup.promise, token);
    }

    constructor(
        private readonly config: Config,
        private readonly credentials: Credentials
    ) {}

    async complete(req: CompletionRequest, token: vscode.CancellationToken): Promise<CompletionResult | null> {
        const log = Logger.get();
        const start = Date.now();

        const model = this.config.model;
        const setting = this.config.promptMode;
        const serverUrl = this.config.serverUrl;
        const capabilityGeneration = this.capabilityGeneration;

        let format: PromptFormat | null;
        try {
            format = setting === 'auto' ? await this.resolvePromptFormat(model, token) : setting;
        } catch (err) {
            if (isAbortError(err)) {
                return null;
            }
            log.error('show failed', err);
            throw err;
        }

        if (format === null || token.isCancellationRequested || model !== this.config.model ||
            setting !== this.config.promptMode || serverUrl !== this.config.serverUrl ||
            capabilityGeneration !== this.capabilityGeneration) {
            return null;
        }

        let prompt = req.prefix;
        if (req.filename) {
            prompt = `// File: ${req.filename}\n${prompt}`;
        }

        const stop: string[] = ['\n\n\n'];
        if (req.multiline === false) {
            stop.push('\n');
        }

        const body: GenerateRequest = {
            model,
            prompt: format === 'template'
                ? prompt || '\n'
                : this.config.fimTemplate.replace(/\{prefix\}|\{suffix\}/g, (slot) =>
                    slot === '{prefix}' ? prompt : req.suffix
                ),
            // Ollama requires both a nonempty prompt and suffix to render its FIM template.
            ...(format === 'template' ? { suffix: req.suffix || '\n' } : { raw: true }),
            think: false,
            stream: false,
            options: {
                num_predict: this.config.maxPredict,
                temperature: 0.2,
                stop,
            },
        };

        log.log('Request', `model=${body.model} mode=${format} prefixLen=${prompt.length} suffixLen=${req.suffix.length}`);

        try {
            const res = await this.post<GenerateResponse>('/api/generate', body, token);
            if (!res) {
                return null;
            }
            const elapsed = Date.now() - start;
            log.log('Http', `generate ok elapsed=${elapsed}ms responseLen=${res.response.length}`);
            return { text: res.response, elapsedMs: elapsed };
        } catch (err) {
            if (isAbortError(err)) {
                log.log('Http', 'generate cancelled');
                return null;
            }
            log.error('generate failed', err);
            throw err;
        }
    }

    async listModels(token?: vscode.CancellationToken): Promise<string[]> {
        const log = Logger.get();
        try {
            const res = await this.get<TagsResponse>('/api/tags', token);
            if (!res) {
                return [];
            }
            const names = res.models.map((m) => m.name);
            log.log('Http', `tags ok count=${names.length}`);
            return names;
        } catch (err) {
            if (isAbortError(err)) {
                return [];
            }
            log.error('tags failed', err);
            throw err;
        }
    }

    private async post<T>(path: string, body: unknown, token?: vscode.CancellationToken): Promise<T | null> {
        return this.request<T>(path, 'POST', body, token);
    }

    private async get<T>(path: string, token?: vscode.CancellationToken): Promise<T | null> {
        return this.request<T>(path, 'GET', undefined, token);
    }

    private async request<T>(
        path: string,
        method: 'GET' | 'POST',
        body: unknown,
        token?: vscode.CancellationToken
    ): Promise<T | null> {
        const controller = new AbortController();
        const timeoutMs = Math.max(1, this.config.timeoutSeconds) * 1000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const cancelSub = token?.onCancellationRequested(() => controller.abort());

        try {
            const headers: Record<string, string> = {
                Accept: 'application/json',
            };

            if (method !== 'GET' && body !== undefined) {
                headers['Content-Type'] = 'application/json';
            }

            if (this.config.useAuthentication) {
                const creds = await this.credentials.get();
                if (creds) {
                    const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
                    headers['Authorization'] = `Basic ${encoded}`;
                }
            }

            const url = `${this.config.serverUrl}${path}`;
            const res = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            if (!res.ok) {
                const text = await safeReadText(res);
                throw new OllamaError(
                    `HTTP ${res.status} ${res.statusText}: ${truncate(text, 200)}`,
                    res.status,
                    text
                );
            }

            return (await res.json()) as T;
        } finally {
            clearTimeout(timer);
            cancelSub?.dispose();
        }
    }
}

function isMissingModel(body: string | undefined): boolean {
    if (!body) {
        return false;
    }
    try {
        const { error } = JSON.parse(body) as { error?: unknown };
        return typeof error === 'string' &&
            /^model (?:'.+'|".+") not found(?:, try pulling it first)?$/.test(error);
    } catch {
        return false;
    }
}

async function waitForCancellation<T>(promise: Promise<T>, token: vscode.CancellationToken): Promise<T | null> {
    if (token.isCancellationRequested) {
        return null;
    }
    let subscription: vscode.Disposable | undefined;
    const cancelled = new Promise<null>((resolve) => {
        subscription = token.onCancellationRequested(() => resolve(null));
    });
    try {
        if (token.isCancellationRequested) {
            return null;
        }
        return await Promise.race([promise, cancelled]);
    } finally {
        subscription?.dispose();
    }
}

function isAbortError(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
}

async function safeReadText(res: Response): Promise<string> {
    try {
        return await res.text();
    } catch {
        return '';
    }
}

function truncate(s: string, n: number): string {
    return s.length <= n ? s : s.slice(0, n) + '…';
}
