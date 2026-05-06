// Minimal document/position interfaces so this module remains free of the
// vscode runtime dependency and can be unit-tested with simple fakes.
// vscode.TextDocument and vscode.Position satisfy both interfaces via
// TypeScript structural typing.

export interface DocLike {
    languageId: string;
    lineAt(line: number): { text: string };
}

export interface PosLike {
    line: number;
    character: number;
}

// Returns true when the cursor is inside a double-quoted string in a JSON or
// JSONC file. Scans the text on the current line up to the cursor position,
// tracking quote state with backslash-escape awareness.
//
// Deliberately does not distinguish string keys from string values — both
// are useful completion targets in translation/config files, and reliable
// disambiguation would require a real JSON parser.
export function isInsideJsonStringValue(document: DocLike, position: PosLike): boolean {
    if (document.languageId !== 'json' && document.languageId !== 'jsonc') {
        return false;
    }
    const lineText = document.lineAt(position.line).text;
    const textBeforeCursor = lineText.slice(0, position.character);
    return isInsideDoubleQuoteString(textBeforeCursor);
}

function isInsideDoubleQuoteString(text: string): boolean {
    let inside = false;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\\' && inside) {
            i++; // skip the escaped character
            continue;
        }
        if (text[i] === '"') {
            inside = !inside;
        }
    }
    return inside;
}
