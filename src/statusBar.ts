import * as vscode from 'vscode';
import { Config } from './config';

type State = 'idle' | 'thinking' | 'disabled' | 'error' | 'no_auth';

const ICONS: Record<State, string> = {
    idle:     '$(sparkle)',
    thinking: '$(sync~spin)',
    disabled: '$(circle-slash)',
    error:    '$(error)',
    no_auth:  '$(lock)',
};

const STATE_LABELS: Record<State, string> = {
    idle:     'Idle',
    thinking: 'Thinking',
    disabled: 'Disabled',
    error:    'Error',
    no_auth:  'Authentication required',
};

const ERROR_AUTO_CLEAR_MS = 5_000;
const LONG_REQUEST_MS = 10_000;

export class StatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private state: State = 'idle';
    private errorTimeout?: ReturnType<typeof setTimeout>;
    private longRequestTimeout?: ReturnType<typeof setTimeout>;
    private thinkingStart?: Date;
    private lastSuccess?: Date;
    private lastError?: { message: string; status?: number };

    constructor(private readonly config: Config) {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.item.command = 'ollamaCodeCompletions.statusBarClicked';
        this.refresh();
        if (config.showStatusBarItem) {
            this.item.show();
        }
    }

    get currentState(): State {
        return this.state;
    }

    applyVisibility(): void {
        if (this.config.showStatusBarItem) {
            this.item.show();
        } else {
            this.item.hide();
        }
    }

    setThinking(): void {
        this.clearTimers();
        this.thinkingStart = new Date();
        this.state = 'thinking';
        this.refresh();
        this.longRequestTimeout = setTimeout(() => {
            if (this.state === 'thinking') {
                this.refresh();
            }
        }, LONG_REQUEST_MS);
    }

    setIdle(): void {
        if (this.state === 'idle') {
            return;
        }
        this.clearTimers();
        this.thinkingStart = undefined;
        this.lastSuccess = new Date();
        this.state = 'idle';
        this.refresh();
    }

    setError(message: string, status?: number): void {
        this.clearTimers();
        this.thinkingStart = undefined;
        this.lastError = { message, status };
        this.state = 'error';
        this.refresh();
        this.errorTimeout = setTimeout(() => {
            if (this.state === 'error') {
                this.state = 'idle';
                this.refresh();
            }
        }, ERROR_AUTO_CLEAR_MS);
    }

    setDisabled(): void {
        this.clearTimers();
        this.thinkingStart = undefined;
        this.state = 'disabled';
        this.refresh();
    }

    setNoAuth(): void {
        this.clearTimers();
        this.thinkingStart = undefined;
        this.state = 'no_auth';
        this.refresh();
    }

    private clearTimers(): void {
        if (this.errorTimeout !== undefined) {
            clearTimeout(this.errorTimeout);
            this.errorTimeout = undefined;
        }
        if (this.longRequestTimeout !== undefined) {
            clearTimeout(this.longRequestTimeout);
            this.longRequestTimeout = undefined;
        }
    }

    private refresh(): void {
        this.item.text = `${ICONS[this.state]} Ollama`;
        this.item.tooltip = this.buildTooltip();
    }

    private buildTooltip(): vscode.MarkdownString {
        const cfg = this.config.current;
        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;

        md.appendMarkdown(`**${STATE_LABELS[this.state]}**`);
        md.appendMarkdown('\n\n---\n\n');
        md.appendMarkdown(`Server: \`${escMd(cfg.serverUrl)}\`  \nModel: \`${escMd(cfg.model)}\``);

        if (this.lastSuccess) {
            md.appendMarkdown('\n\n---\n\n');
            md.appendMarkdown(`Last success: ${this.lastSuccess.toLocaleTimeString()}`);
        }

        if (this.state === 'thinking' && this.thinkingStart) {
            const elapsedMs = Date.now() - this.thinkingStart.getTime();
            if (elapsedMs >= LONG_REQUEST_MS) {
                md.appendMarkdown('\n\n---\n\n');
                md.appendMarkdown('Request taking longer than usual…');
            }
        }

        if (this.state === 'error' && this.lastError) {
            md.appendMarkdown('\n\n---\n\n');
            md.appendMarkdown(`**Error:** ${escMd(this.lastError.message)}`);
            if (this.lastError.status !== undefined) {
                md.appendMarkdown(`  \nHTTP ${this.lastError.status}`);
            }
        }

        return md;
    }

    dispose(): void {
        this.clearTimers();
        this.item.dispose();
    }
}

function escMd(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}
