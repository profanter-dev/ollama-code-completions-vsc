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
    TagsResponse,
} from './types';

export class OllamaClient {
    constructor(
        private readonly config: Config,
        private readonly credentials: Credentials
    ) {}

    async complete(req: CompletionRequest, token: vscode.CancellationToken): Promise<CompletionResult | null> {
        const log = Logger.get();
        const start = Date.now();

        let prompt = req.prefix;
        if (req.filename) {
            prompt = `// File: ${req.filename}\n${prompt}`;
        }

        const body: GenerateRequest = {
            model: this.config.model,
            prompt,
            suffix: req.suffix,
            stream: false,
            options: {
                num_predict: this.config.maxPredict,
                temperature: 0.2,
            },
        };

        log.log('Request', `model=${body.model} prefixLen=${prompt.length} suffixLen=${(req.suffix ?? '').length}`);

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
                'Content-Type': 'application/json',
                Accept: 'application/json',
            };

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
                    res.status
                );
            }

            return (await res.json()) as T;
        } finally {
            clearTimeout(timer);
            cancelSub?.dispose();
        }
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
