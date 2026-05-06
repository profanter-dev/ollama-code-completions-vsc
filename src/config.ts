import * as vscode from 'vscode';

const SECTION = 'ollamaCodeCompletions';

export interface ConfigSnapshot {
    serverUrl: string;
    model: string;
    useAuthentication: boolean;
    enabled: boolean;
    debounceMs: number;
    maxPrefixChars: number;
    maxSuffixChars: number;
    maxPredict: number;
    timeoutSeconds: number;
    logToFile: boolean;
    logToOutputChannel: boolean;
    showStatusBarItem: boolean;
}

export interface ConfigChangeEvent {
    previous: ConfigSnapshot;
    current: ConfigSnapshot;
    modelChanged: boolean;
    enabledChanged: boolean;
    authChanged: boolean;
    showStatusBarItemChanged: boolean;
}

export class Config implements vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<ConfigChangeEvent>();
    readonly onDidChange = this._onDidChange.event;

    private snapshot: ConfigSnapshot;
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        this.snapshot = this.read();
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (!e.affectsConfiguration(SECTION)) {
                    return;
                }
                const previous = this.snapshot;
                this.snapshot = this.read();
                this._onDidChange.fire({
                    previous,
                    current: this.snapshot,
                    modelChanged: previous.model !== this.snapshot.model,
                    enabledChanged: previous.enabled !== this.snapshot.enabled,
                    authChanged: previous.useAuthentication !== this.snapshot.useAuthentication,
                    showStatusBarItemChanged: previous.showStatusBarItem !== this.snapshot.showStatusBarItem,
                });
            })
        );
    }

    get current(): ConfigSnapshot {
        return this.snapshot;
    }

    get serverUrl(): string { return this.snapshot.serverUrl; }
    get model(): string { return this.snapshot.model; }
    get useAuthentication(): boolean { return this.snapshot.useAuthentication; }
    get enabled(): boolean { return this.snapshot.enabled; }
    get debounceMs(): number { return this.snapshot.debounceMs; }
    get maxPrefixChars(): number { return this.snapshot.maxPrefixChars; }
    get maxSuffixChars(): number { return this.snapshot.maxSuffixChars; }
    get maxPredict(): number { return this.snapshot.maxPredict; }
    get timeoutSeconds(): number { return this.snapshot.timeoutSeconds; }
    get logToFile(): boolean { return this.snapshot.logToFile; }
    get logToOutputChannel(): boolean { return this.snapshot.logToOutputChannel; }
    get showStatusBarItem(): boolean { return this.snapshot.showStatusBarItem; }

    async setModel(model: string): Promise<void> {
        const cfg = vscode.workspace.getConfiguration(SECTION);
        await cfg.update('model', model, vscode.ConfigurationTarget.Global);
    }

    private read(): ConfigSnapshot {
        const cfg = vscode.workspace.getConfiguration(SECTION);
        return {
            serverUrl: trimTrailingSlash(cfg.get<string>('serverUrl', 'http://localhost:11434')),
            model: cfg.get<string>('model', 'qwen2.5-coder:1.5b'),
            useAuthentication: cfg.get<boolean>('useAuthentication', false),
            enabled: cfg.get<boolean>('enabled', true),
            debounceMs: cfg.get<number>('debounceMs', 300),
            maxPrefixChars: cfg.get<number>('maxPrefixChars', 4096),
            maxSuffixChars: cfg.get<number>('maxSuffixChars', 1024),
            maxPredict: cfg.get<number>('maxPredict', 128),
            timeoutSeconds: cfg.get<number>('timeoutSeconds', 30),
            logToFile: cfg.get<boolean>('logToFile', false),
            logToOutputChannel: cfg.get<boolean>('logToOutputChannel', false),
            showStatusBarItem: cfg.get<boolean>('showStatusBarItem', true),
        };
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.disposables.forEach((d) => d.dispose());
    }
}

function trimTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}
