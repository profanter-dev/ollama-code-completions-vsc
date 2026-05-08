export type MultilineDecision = 'single' | 'multi';

export interface DecideMultilineArgs {
    mode: 'auto' | 'always' | 'never';
    languageId: string;
    prefix: string;
    lineBeforeCursor: string;
    afterCursor: string;
}

// Comment markers indexed by VS Code languageId.
const LINE_COMMENT_MARKERS: Record<string, string> = {
    javascript: '//',
    typescript: '//',
    javascriptreact: '//',
    typescriptreact: '//',
    csharp: '//',
    go: '//',
    rust: '//',
    java: '//',
    cpp: '//',
    c: '//',
    php: '//',
    swift: '//',
    kotlin: '//',
    scala: '//',
    dart: '//',
    vue: '//',
    svelte: '//',
    jsonc: '//',
    python: '#',
    ruby: '#',
    shellscript: '#',
    yaml: '#',
    dockerfile: '#',
    makefile: '#',
    toml: '#',
    r: '#',
    perl: '#',
    elixir: '#',
    nim: '#',
    sql: '--',
    lua: '--',
    haskell: '--',
    lisp: ';',
    scheme: ';',
    clojure: ';',
    matlab: '%',
    erlang: '%',
    prolog: '%',
    tex: '%',
    latex: '%',
};

export function isLineCommentStart(line: string, languageId: string): boolean {
    const marker = LINE_COMMENT_MARKERS[languageId];
    if (marker) {
        return line.startsWith(marker);
    }
    // Unknown language: treat both // and # as line-comment triggers.
    return line.startsWith('//') || line.startsWith('#');
}

export function isInJsxAttributeValue(lineBeforeCursor: string): boolean {
    const lastOpen = lineBeforeCursor.lastIndexOf('<');
    const lastClose = lineBeforeCursor.lastIndexOf('>');
    if (lastOpen === -1 || lastClose > lastOpen) { return false; }
    const afterOpen = lineBeforeCursor.slice(lastOpen + 1);
    if (!/^[a-zA-Z/!>]/.test(afterOpen)) { return false; }
    return /(?:=\{|="|=')\s*$/.test(lineBeforeCursor);
}

export function decideMultiline(args: DecideMultilineArgs): MultilineDecision {
    const { mode, languageId, lineBeforeCursor } = args;

    if (mode === 'never') { return 'single'; }
    if (mode === 'always') { return 'multi'; }

    // mode === 'auto': apply heuristics.

    // a. Line comment — single-line context.
    if (isLineCommentStart(lineBeforeCursor.trimStart(), languageId)) {
        return 'single';
    }

    // b. Cursor inside a JSON/JSONC string value — keep to one line.
    if ((languageId === 'json' || languageId === 'jsonc') && isInsideDoubleQuoteString(lineBeforeCursor)) {
        return 'single';
    }

    // c. JSX attribute value — one expression only.
    if (isInJsxAttributeValue(lineBeforeCursor)) {
        return 'single';
    }

    // d. Block openers — clear signals that the user is starting a block.
    const trimmedEnd = lineBeforeCursor.trimEnd();
    if (
        trimmedEnd.endsWith('{') ||
        /=>\{?$/.test(trimmedEnd) ||
        /\/\*\*?$/.test(trimmedEnd) ||
        (languageId === 'python' && trimmedEnd.endsWith(':')) ||
        /\bdo$/.test(trimmedEnd) ||
        /\bthen$/.test(trimmedEnd)
    ) {
        return 'multi';
    }

    // e. Blank line — the classic "model, write the next chunk" position.
    if (lineBeforeCursor.trim() === '') {
        return 'multi';
    }

    // f. Default: single-line is safe; user can always continue.
    return 'single';
}

function isInsideDoubleQuoteString(text: string): boolean {
    let inside = false;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\\' && inside) {
            i++;
            continue;
        }
        if (text[i] === '"') {
            inside = !inside;
        }
    }
    return inside;
}
