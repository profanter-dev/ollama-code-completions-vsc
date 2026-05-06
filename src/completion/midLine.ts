// Closing punctuation characters that are safe to appear after the cursor
// when deciding whether to allow a mid-line completion in smart mode.
// The set includes whitespace, closing brackets/braces/parens, comparison
// closers, and common delimiters.
export const CLOSING_ONLY_RE = /^[\s)\]}>,:;'"`]+$/;

// Walk lineBeforeCursor left-to-right tracking the last-seen '<' and '>'.
// Returns true if the last '<' appears after the last '>' AND the character
// immediately following that '<' is a letter, '/', or '>' (indicating an
// HTML/JSX tag rather than a comparison operator).
//
// Known false-positive: a line like `a < b && c < d` (two '<' operators,
// no '>') returns true because the last '<' has no following '>'. This
// allows one extra request whose completion the post-processor will silently
// reject, so no incorrect text is shown.
export function isInsideJsxTag(lineBeforeCursor: string): boolean {
    let lastLt = -1;
    let lastGt = -1;
    for (let i = 0; i < lineBeforeCursor.length; i++) {
        const ch = lineBeforeCursor[i];
        if (ch === '<') {
            lastLt = i;
        } else if (ch === '>') {
            lastGt = i;
        }
    }
    if (lastLt <= lastGt) {
        return false;
    }
    const afterLt = lineBeforeCursor[lastLt + 1];
    return afterLt !== undefined && /[a-zA-Z/>]/.test(afterLt);
}
