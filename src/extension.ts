import * as vscode from 'vscode';
import { Config } from './config';
import { Logger } from './logger';
import { Credentials } from './auth/credentials';
import { OllamaClient } from './ollama/client';
import { CompletionCache } from './completion/cache';
import { InlineProvider } from './completion/provider';

const SUPPORTED_LANGUAGES = [
    'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
    'python', 'csharp', 'go', 'rust', 'java', 'cpp', 'c',
    'php', 'ruby', 'swift', 'kotlin', 'scala', 'dart', 'lua',
    'html', 'css', 'scss', 'json', 'jsonc', 'yaml', 'markdown',
    'sql', 'shellscript', 'powershell', 'vue', 'svelte',
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const config = new Config();
    const logger = Logger.init(config);
    const credentials = new Credentials(context.secrets);
    const client = new OllamaClient(config, credentials);
    const cache = new CompletionCache(100);
    const provider = new InlineProvider(config, client, cache);

    logger.log('Attach', 'Ollama Code Completions activated');

    // Selectors for both file:// documents and unsaved buffers.
    const selector: vscode.DocumentSelector = SUPPORTED_LANGUAGES.flatMap((language) => [
        { language, scheme: 'file' },
        { language, scheme: 'untitled' },
    ]);

    context.subscriptions.push(
        config,
        logger,
        vscode.languages.registerInlineCompletionItemProvider(selector, provider),
        config.onDidChange((e) => {
            if (e.modelChanged) {
                cache.clear();
                logger.log('Cache', `cleared (model changed to ${e.current.model})`);
            }
        }),
        vscode.commands.registerCommand('ollamaCodeCompletions.setCredentials', () =>
            cmdSetCredentials(credentials)
        ),
        vscode.commands.registerCommand('ollamaCodeCompletions.clearCredentials', () =>
            cmdClearCredentials(credentials)
        ),
        vscode.commands.registerCommand('ollamaCodeCompletions.pickModel', () =>
            cmdPickModel(client, config)
        ),
        vscode.commands.registerCommand('ollamaCodeCompletions.testConnection', () =>
            cmdTestConnection(client, config)
        ),
        vscode.commands.registerCommand('ollamaCodeCompletions.showLog', () => logger.show())
    );
}

export function deactivate(): void {
    // VS Code disposes context.subscriptions automatically.
}

async function cmdSetCredentials(credentials: Credentials): Promise<void> {
    const username = await vscode.window.showInputBox({
        prompt: 'Ollama username',
        ignoreFocusOut: true,
    });
    if (username === undefined) return;

    const password = await vscode.window.showInputBox({
        prompt: 'Ollama password',
        password: true,
        ignoreFocusOut: true,
    });
    if (password === undefined) return;

    await credentials.set({ username, password });
    vscode.window.showInformationMessage('Ollama credentials saved.');
}

async function cmdClearCredentials(credentials: Credentials): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
        'Clear stored Ollama credentials?',
        { modal: true },
        'Clear'
    );
    if (choice !== 'Clear') return;
    await credentials.clear();
    vscode.window.showInformationMessage('Ollama credentials cleared.');
}

async function cmdPickModel(client: OllamaClient, config: Config): Promise<void> {
    let models: string[];
    try {
        models = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Loading Ollama models…' },
            () => client.listModels()
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Could not reach Ollama: ${msg}`);
        return;
    }

    if (models.length === 0) {
        vscode.window.showWarningMessage('No models returned by the Ollama server.');
        return;
    }

    const picked = await vscode.window.showQuickPick(models, {
        placeHolder: `Current: ${config.model}`,
    });
    if (!picked) return;

    await config.setModel(picked);
    vscode.window.showInformationMessage(`Ollama model set to ${picked}.`);
}

async function cmdTestConnection(client: OllamaClient, config: Config): Promise<void> {
    const start = Date.now();
    let models: string[];
    try {
        models = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Testing Ollama connection…' },
            () => client.listModels()
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Connection failed: ${msg}`);
        return;
    }

    const elapsed = Date.now() - start;
    if (!models.includes(config.model)) {
        vscode.window.showWarningMessage(
            `Reached server in ${elapsed} ms, but model "${config.model}" is not installed. ` +
            `Available: ${models.join(', ') || '(none)'}`
        );
        return;
    }
    vscode.window.showInformationMessage(
        `Ollama OK in ${elapsed} ms. Model "${config.model}" is available.`
    );
}
