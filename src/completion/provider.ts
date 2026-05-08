import * as vscode from 'vscode';
import * as path from 'path';
import { Config } from '../config';
import { Logger } from '../logger';
import { OllamaClient } from '../ollama/client';
import { OllamaError } from '../ollama/types';
import { StatusBar } from '../statusBar';
import { CompletionCache } from './cache';
import { debounceWithCancel } from './debouncer';
import { findSuffixOverlapLength, postProcess } from './postprocess';
import { CLOSING_ONLY_RE, isInsideJsxTag } from './midLine';
import { isInsideJsonStringValue } from './contextDetect';
import { decideMultiline } from './multilineDecider';

export class InlineProvider implements vscode.InlineCompletionItemProvider {
    constructor(
        private readonly config: Config,
        private readonly client: OllamaClient,
        private readonly cache: CompletionCache,
        private readonly statusBar?: StatusBar
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

        const lineText = document.lineAt(position.line).text;
        const lineBeforeCursor = lineText.slice(0, position.character);
        const afterCursor = lineText.slice(position.character);
        const trimmedAfter = afterCursor.trim();

        // JSON/JSONC string bypass: inside a quoted string value the mid-line
        // gating rules do not apply — string content is inherently mid-line and
        // the closing punctuation heuristics are irrelevant.
        const jsonStringBypass = isInsideJsonStringValue(document, position);

        // Mid-line gating: decide whether to proceed when there is content
        // after the cursor on the same line.
        let midLine = false;
        if (!jsonStringBypass && trimmedAfter.length > 0) {
            if (this.config.midLineMode === 'never') {
                log.log('Skip', 'midline-never');
                return undefined;
            }
            // smart mode: allow completions when afterCursor looks safe to
            // replace or is clearly inside a JSX tag attribute.
            if (CLOSING_ONLY_RE.test(trimmedAfter)) {
                midLine = true;
                log.log('Provide', 'midline-punctuation');
            } else if (trimmedAfter.length <= 80 && isInsideJsxTag(lineText.slice(0, position.character))) {
                midLine = true;
                log.log('Provide', 'midline-jsx');
            } else {
                log.log('Skip', `midline-substantive chars-after=${trimmedAfter.length}`);
                return undefined;
            }
        }

        const prefix = capPrefix(getPrefix(document, position), this.config.maxPrefixChars);
        const suffix = capSuffix(getSuffix(document, position), this.config.maxSuffixChars);

        const multilineDecision = decideMultiline({
            mode: this.config.multilineMode,
            languageId: document.languageId,
            prefix,
            lineBeforeCursor,
            afterCursor,
        });
        const maxLines = multilineDecision === 'single' ? 1 : this.config.maxCompletionLines;
        log.log('Provide', `mode=${multilineDecision}`);

        // 1. Cache lookup (synchronous) before any async work.
        const cached = this.cache.lookup(prefix, suffix);
        if (cached !== undefined) {
            log.log('Cache', `hit prefixLen=${prefix.length} suffixLen=${suffix.length} resultLen=${cached.length}`);
            return [makeItem(cached, position, midLine ? afterCursor : '')];
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
        this.statusBar?.setThinking();

        let result;
        try {
            result = await this.client.complete(
                { prefix, suffix, filename, multiline: multilineDecision === 'multi' },
                token
            );
        } catch (err) {
            if (!token.isCancellationRequested) {
                const message = err instanceof Error ? err.message : String(err);
                const status = err instanceof OllamaError ? err.httpStatus : undefined;
                this.statusBar?.setError(message, status);
            }
            return undefined;
        }

        if (!result || token.isCancellationRequested) {
            return undefined;
        }

        // 4. Post-process. For mid-line completions, skip suffix-overlap removal
        // from the pipeline — we encode any overlap into the replacement range
        // instead of stripping it from the text.
        const cleaned = postProcess({ raw: result.text, prefix, suffix, skipSuffixOverlap: midLine, maxLines });
        if (cleaned === null) {
            log.log('PostProcess', `rejected rawLen=${result.text.length}`);
            this.statusBar?.setIdle();
            return undefined;
        }
        log.log('PostProcess', `ok rawLen=${result.text.length} cleanedLen=${cleaned.length}`);

        // 5. Cache & return.
        this.cache.set(prefix, suffix, cleaned);
        log.log('Provide', `len=${cleaned.length} elapsedMs=${result.elapsedMs}`);
        this.statusBar?.setIdle();
        return [makeItem(cleaned, position, midLine ? afterCursor : '')];
    }
}

// Build an InlineCompletionItem whose replacement range absorbs any suffix
// of afterCursor that the completion already ends with. When afterCursor is
// empty (end-of-line) the range collapses to a point.
function makeItem(
    text: string,
    position: vscode.Position,
    afterCursor: string
): vscode.InlineCompletionItem {
    const overlapLen = afterCursor ? findSuffixOverlapLength(text, afterCursor) : 0;
    const endPos = overlapLen > 0
        ? new vscode.Position(position.line, position.character + overlapLen)
        : position;
    return new vscode.InlineCompletionItem(text, new vscode.Range(position, endPos));
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
