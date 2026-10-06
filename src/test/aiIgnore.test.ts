import * as assert from 'assert';
import * as path from 'path';
import Module from 'module';
import * as vscode from 'vscode';

import type { AiIgnore as AiIgnoreType } from '../completion/aiIgnore';
import type { InlineProvider as InlineProviderType } from '../completion/provider';
import type { Logger as LoggerType } from '../logger';
import type { CompletionCache as CompletionCacheType } from '../completion/cache';
import type { Config } from '../config';
import type { OllamaClient } from '../ollama/client';

// Load the extension modules against a small VS Code host: mocha runs outside VS Code.
const files = new Map<string, string>();
const listeners: Record<string, ((uri: vscode.Uri) => void)[]> = { create: [], change: [], delete: [] };
const roots = ['/project', '/other'];

let reads = 0;
let failRead = false;

class FileSystemError extends Error {
    constructor(readonly code: string) { super(code); }
}

class Uri {
    constructor(readonly fsPath: string, readonly scheme = 'file') {}
    get path(): string { return this.fsPath; }
    toString(): string { return `${this.scheme}:${this.fsPath}`; }
    static joinPath(root: Uri, name: string): Uri { return new Uri(path.join(root.fsPath, name), root.scheme); }
}

class Position {
    constructor(readonly line: number, readonly character: number) {}
}

class Range {
    constructor(readonly start: Position, readonly end: Position) {}
}

const host = {
    Uri, Position, Range, FileSystemError,
    InlineCompletionItem: class {
        constructor(readonly insertText: string, readonly range: Range) {}
    },

    workspace: {
        getWorkspaceFolder(uri: Uri) {
            const root = roots.find(root => uri.fsPath === root || uri.fsPath.startsWith(root + '/'));
            return root ? { uri: new Uri(root) } : undefined;
        },
        createFileSystemWatcher() {
            return {
                onDidCreate: (cb: (uri: vscode.Uri) => void) => { listeners.create.push(cb); return { dispose() {} }; },
                onDidChange: (cb: (uri: vscode.Uri) => void) => { listeners.change.push(cb); return { dispose() {} }; },
                onDidDelete: (cb: (uri: vscode.Uri) => void) => { listeners.delete.push(cb); return { dispose() {} }; },
                dispose() {},
            };
        },
        fs: {
            async readFile(uri: Uri) {
                reads++;
                if (failRead) { throw new Error('permission denied'); }
                const contents = files.get(uri.fsPath);
                if (contents === undefined) { throw new FileSystemError('FileNotFound'); }
                return Buffer.from(contents);
            },
        },
    },
    window: { createOutputChannel: () => ({ dispose() {}, appendLine() {} }) },
};

const loader = Module as typeof Module & { _load: (id: string, parent: Module, isMain: boolean) => unknown };
const originalLoad = loader._load;

let AiIgnore: typeof AiIgnoreType;
let InlineProvider: typeof InlineProviderType;
let Logger: typeof LoggerType;
let CompletionCache: typeof CompletionCacheType;

try {
    loader._load = (id, parent, isMain) => id === 'vscode' ? host : originalLoad(id, parent, isMain);
    ({ AiIgnore } = require('../completion/aiIgnore'));
    ({ InlineProvider } = require('../completion/provider'));
    ({ Logger } = require('../logger'));
    ({ CompletionCache } = require('../completion/cache'));
} finally {
    loader._load = originalLoad;
}

function doc(filename: string): vscode.TextDocument {
    return { uri: new Uri(filename), languageId: 'typescript', lineCount: 1,
        lineAt: () => ({ text: 'x' }), getText: (range: Range) => 'x'.slice(range.start.character, range.end.character),
    } as unknown as vscode.TextDocument;
}

function changed(kind: 'create' | 'change' | 'delete', root = '/project'): void {
    for (const listener of listeners[kind]) { listener(new Uri(root + '/.aiignore') as unknown as vscode.Uri); }
}

describe('.aiignore completion exclusion', () => {
    beforeEach(() => { files.clear(); reads = 0; failRead = false; });

    it('excludes env files by default and lets workspace rules re-include them', async () => {
        const guard = new AiIgnore();
        const secret = doc('/project/src/.env');
        assert.strictEqual(await guard.excludes(secret), true);
        assert.strictEqual(await guard.excludes(doc('/project/.env.production')), true);
        assert.strictEqual(await guard.excludes(doc('/project/src/index.ts')), false);
        files.set('/project/.aiignore', '!.env\n');
        changed('create');
        assert.strictEqual(await guard.excludes(secret), false);
        assert.strictEqual(await guard.excludes(doc('/project/.env.production')), true);
        guard.dispose();
    });

    it('applies gitignore globs, directory rules, root paths, comments and negations', async () => {
        files.set('/project/.aiignore', '# comment\n*.ts\n!allowed.ts\nbuild/\n/root.txt\n');
        const guard = new AiIgnore();
        assert.strictEqual(await guard.excludes(doc('/project/src/index.ts')), true);
        assert.strictEqual(await guard.excludes(doc('/project/src/allowed.ts')), false);
        assert.strictEqual(await guard.excludes(doc('/project/build/output.js')), true);
        assert.strictEqual(await guard.excludes(doc('/project/root.txt')), true);
        assert.strictEqual(await guard.excludes(doc('/project/src/root.txt')), false);
        assert.strictEqual(await guard.excludes(doc('/project/src/other.js')), false);
        assert.strictEqual(await guard.excludes(doc('/other/src/index.ts')), false);
        assert.strictEqual(reads, 2);
        guard.dispose();
    });

    it('refreshes on edit, creation and deletion, without caching failed reads', async () => {
        const guard = new AiIgnore();
        const target = doc('/project/src/index.ts');
        assert.strictEqual(await guard.excludes(target), false);
        files.set('/project/.aiignore', '*.ts\n'); changed('create');
        assert.strictEqual(await guard.excludes(target), true);
        files.set('/project/.aiignore', '*.js\n'); changed('change');
        assert.strictEqual(await guard.excludes(target), false);
        files.delete('/project/.aiignore'); changed('delete');
        assert.strictEqual(await guard.excludes(target), false);
        failRead = true; changed('change');
        await assert.rejects(guard.excludes(target), /permission denied/);
        failRead = false;
        assert.strictEqual(await guard.excludes(target), false);
        assert.strictEqual(reads, 6);
        guard.dispose();
    });

    it('blocks ignored documents before serving a cached completion or contacting Ollama', async () => {
        const config = { enabled: true, disabledLanguages: new Set<string>(), midLineMode: 'smart',
            multilineMode: 'never', maxCompletionLines: 1, maxPrefixChars: 100, maxSuffixChars: 100,
            debounceMs: 0, logToFile: false, logToOutputChannel: false };
        const logger = Logger.init(config as unknown as Config);
        const guard = new AiIgnore();
        let requests = 0;
        const client = { complete: async () => { requests++; return { text: 'hello', elapsedMs: 1 }; } };
        const provider = new InlineProvider(config as unknown as Config, client as unknown as OllamaClient, new CompletionCache(10), guard);
        const target = doc('/project/src/index.ts');
        const position = new Position(0, 1) as unknown as vscode.Position;
        const token = { isCancellationRequested: false } as vscode.CancellationToken;
        const context = {} as vscode.InlineCompletionContext;
        const allowed = await provider.provideInlineCompletionItems(target, position, context, token);
        assert.strictEqual(allowed?.[0].insertText, 'hello');
        assert.strictEqual(requests, 1);
        files.set('/project/.aiignore', '*.ts\n'); changed('create');
        assert.strictEqual(await provider.provideInlineCompletionItems(target, position, context, token), undefined);
        assert.strictEqual(requests, 1);
        logger.dispose();
        guard.dispose();
    });
});
