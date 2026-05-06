import * as vscode from 'vscode';
import * as path from 'path';
import { Config } from '../config';
import { Logger } from '../logger';
import { OllamaClient } from '../ollama/client';
import { CompletionCache } from './cache';
import { debounceWithCancel } from './debouncer';
import { postProcess } from './postprocess';

export class InlineProvider implements vscode.InlineCompletionItemProvider {
    constructor(
        private readonly config: Config,
        private readonly client: OllamaClient,
        private readonly cache: CompletionCache
    ) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const log = Logger.get();

        if (!this.config.enabled) {
            return undefined;
        }

        // Skip mid-line cursor positions: if there is non-whitespace text after
        // the cursor on the same line, we do not request a completion. This
        // avoids inserting text that collides with content the user has
        // already typed further along the line.
        const lineText = document.lineAt(position.line).text;
        const afterCursor = lineText.slice(position.character);
        if (afterCursor.trim().length > 0) {
            log.log('Skip', `mid-line: chars-after=${afterCursor.length}`);
            return undefined;
        }

        const prefix = capPrefix(getPrefix(document, position), this.config.maxPrefixChars);
        const suffix = capSuffix(getSuffix(document, position), this.config.maxSuffixChars);

        // 1. Cache lookup (synchronous) before any async work.
        const cached = this.cache.lookup(prefix, suffix);
        if (cached !== undefined) {
            log.log('Cache', `hit prefixLen=${prefix.length} suffixLen=${suffix.length} resultLen=${cached.length}`);
            return [new vscode.InlineCompletionItem(cached, new vscode.Range(position, position))];
        }
        log.log('Cache', `miss prefixLen=${prefix.length} suffixLen=${suffix.length}`);

        // 2. Debounce.
        if (!(await debounceWithCancel(this.config.debounceMs, token))) {
            return undefined;
        }
        if (token.isCancellationRequested) {
            return undefined;
        }

        // 3. Request.
        const filename = filenameFor(document);
        const result = await this.client.complete({ prefix, suffix, filename }, token);
        if (!result || token.isCancellationRequested) {
            return undefined;
        }

        // 4. Post-process.
        const cleaned = postProcess({ raw: result.text, prefix, suffix });
        if (cleaned === null) {
            log.log('PostProcess', `rejected rawLen=${result.text.length}`);
            return undefined;
        }
        log.log('PostProcess', `ok rawLen=${result.text.length} cleanedLen=${cleaned.length}`);

        // 5. Cache & return.
        this.cache.set(prefix, suffix, cleaned);
        log.log('Provide', `len=${cleaned.length} elapsedMs=${result.elapsedMs}`);
        return [new vscode.InlineCompletionItem(cleaned, new vscode.Range(position, position))];
    }
}

function getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
    const start = new vscode.Position(0, 0);
    return document.getText(new vscode.Range(start, position));
}

function getSuffix(document: vscode.TextDocument, position: vscode.Position): string {
    const lastLine = document.lineCount - 1;
    const end = new vscode.Position(lastLine, document.lineAt(lastLine).text.length);
    return document.getText(new vscode.Range(position, end));
}

function capPrefix(prefix: string, max: number): string {
    if (prefix.length <= max) {
        return prefix;
    }
    // Keep the tail (closest to cursor); try to cut at a line boundary.
    const sliced = prefix.slice(prefix.length - max);
    const nl = sliced.indexOf('\n');
    return nl >= 0 ? sliced.slice(nl + 1) : sliced;
}

function capSuffix(suffix: string, max: number): string {
    if (suffix.length <= max) {
        return suffix;
    }
    const sliced = suffix.slice(0, max);
    const nl = sliced.lastIndexOf('\n');
    return nl >= 0 ? sliced.slice(0, nl) : sliced;
}

function filenameFor(document: vscode.TextDocument): string | undefined {
    if (document.uri.scheme === 'untitled') {
        return undefined;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        for (const folder of folders) {
            const folderPath = folder.uri.fsPath;
            const docPath = document.uri.fsPath;
            if (docPath.startsWith(folderPath)) {
                return path.relative(folderPath, docPath).replace(/\\/g, '/');
            }
        }
    }
    return path.basename(document.uri.fsPath);
}
