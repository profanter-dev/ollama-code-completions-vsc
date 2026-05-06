import * as vscode from 'vscode';

/**
 * Wait `ms` milliseconds. Resolves true if the wait completed, false if the
 * cancellation token fired during the wait. Safe to call with ms <= 0.
 */
export function debounceWithCancel(ms: number, token: vscode.CancellationToken): Promise<boolean> {
    if (ms <= 0) {
        return Promise.resolve(!token.isCancellationRequested);
    }
    if (token.isCancellationRequested) {
        return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            sub.dispose();
            resolve(true);
        }, ms);
        const sub = token.onCancellationRequested(() => {
            clearTimeout(timer);
            sub.dispose();
            resolve(false);
        });
    });
}
