import * as path from 'path';
import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';

const DEFAULT_RULES = ['.env', '.env.*'];

/** Workspace-root .aiignore rules, refreshed when the file changes. */
export class AiIgnore implements vscode.Disposable {
    private readonly rules = new Map<string, Promise<Ignore | undefined>>();
    private readonly watcher = vscode.workspace.createFileSystemWatcher('**/.aiignore');
    private readonly subscriptions: vscode.Disposable[];

    constructor() {
        const invalidate = (uri: vscode.Uri) => {
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (folder && uri.toString() === vscode.Uri.joinPath(folder.uri, '.aiignore').toString()) {
                this.rules.delete(folder.uri.toString());
            }
        };
        this.subscriptions = [
            this.watcher,
            this.watcher.onDidCreate(invalidate),
            this.watcher.onDidChange(invalidate),
            this.watcher.onDidDelete(invalidate),
        ];
    }

    async excludes(document: vscode.TextDocument): Promise<boolean> {
        if (document.uri.scheme !== 'file' && document.uri.scheme !== 'vscode-remote') {
            return false;
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) {
            return false;
        }
        const key = folder.uri.toString();
        let rules = this.rules.get(key);
        if (!rules) {
            rules = this.load(folder.uri);
            this.rules.set(key, rules);
        }
        let matcher: Ignore | undefined;
        try {
            matcher = await rules;
        } catch (error) {
            if (this.rules.get(key) === rules) {
                this.rules.delete(key);
            }
            throw error;
        }
        if (!matcher) {
            return false;
        }
        const relative = folder.uri.scheme === 'file'
            ? path.relative(folder.uri.fsPath, document.uri.fsPath).replace(/\\/g, '/')
            : path.posix.relative(folder.uri.path, document.uri.path);
        return relative !== '' && matcher.ignores(relative);
    }

    private async load(root: vscode.Uri): Promise<Ignore | undefined> {
        const matcher = ignore().add(DEFAULT_RULES);

        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.aiignore'));
            return matcher.add(new TextDecoder().decode(bytes));
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return matcher;
            }
            // A failed read must not leak a file that might be excluded.
            throw error;
        }
    }

    dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.rules.clear();
    }
}
