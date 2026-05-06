import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Config } from './config';

export type LogCategory =
    | 'Request'
    | 'Cache'
    | 'Http'
    | 'PostProcess'
    | 'Provide'
    | 'Skip'
    | 'Attach'
    | 'Error';

export class Logger implements vscode.Disposable {
    private static instance: Logger | undefined;

    private readonly channel: vscode.OutputChannel;
    private readonly filePath: string;

    private constructor(private readonly config: Config) {
        this.channel = vscode.window.createOutputChannel('Ollama Code Completions');
        this.filePath = path.join(os.tmpdir(), 'OllamaCodeCompletions.log');
    }

    static init(config: Config): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(config);
        }
        return Logger.instance;
    }

    static get(): Logger {
        if (!Logger.instance) {
            throw new Error('Logger.init must be called before Logger.get');
        }
        return Logger.instance;
    }

    show(): void {
        this.channel.show(true);
    }

    log(category: LogCategory, message: string): void {
        const toFile = this.config.logToFile;
        const toChannel = this.config.logToOutputChannel;
        if (!toFile && !toChannel) {
            return;
        }
        const line = formatLine(category, message);
        if (toChannel) {
            this.channel.appendLine(line);
        }
        if (toFile) {
            // Fire-and-forget; log failures should never break extension behavior.
            fs.appendFile(this.filePath, line + '\n', (err) => {
                if (err && toChannel) {
                    this.channel.appendLine(formatLine('Error', `log file write failed: ${err.message}`));
                }
            });
        }
    }

    error(message: string, err?: unknown): void {
        const detail = err instanceof Error ? `${err.message}` : err !== undefined ? String(err) : '';
        this.log('Error', detail ? `${message}: ${detail}` : message);
    }

    dispose(): void {
        this.channel.dispose();
        Logger.instance = undefined;
    }
}

function formatLine(category: LogCategory, message: string): string {
    const ts = new Date().toISOString();
    return `[${ts}] [${category}] ${message}`;
}
