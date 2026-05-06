// Post-processing pipeline applied to raw FIM completions before they are
// shown as ghost text. Stages, in order:
//
//   1. Null/whitespace - empty or whitespace-only completions are rejected.
//   2. Leading-newline strip - FIM models often emit a stray leading \n.
//   3. Single-line decision - if the prefix's last line ends mid-expression
//      we trim the completion to a single line (avoids inserting a multi-line
//      block in the middle of an argument list, etc.).
//   4. Suffix overlap - if the completion ends with text that matches the
//      start of the suffix, drop the overlapping tail.
//   5. Bracket balance - trim at the first point where the running bracket
//      depth would go negative, with comment/string/regex awareness so we
//      don't mistake a `}` inside a string for code.
//   6. Prefix echo - some FIM models re-emit part of the prefix; strip it.
//   7. Final whitespace recheck - reject if stages above whittled away
//      everything substantive.

export interface PostProcessInput {
    raw: string;
    prefix: string;
    suffix: string;
}

export function postProcess(input: PostProcessInput): string | null {
    return runPipeline(input.raw, input.prefix, input.suffix);
}

// Exposed for unit tests so each stage is individually checkable.
export const stages = {
    nullOrWhitespace: (text: string): string | null =>
        !text || text.trim().length === 0 ? null : text,

    stripLeadingNewlines: (text: string): string =>
        text.replace(/^[\r\n]+/, ''),

    singleLineIfMidExpression: (text: string, prefix: string): string => {
        const lastLine = lastLineOf(prefix);
        if (isMidExpression(lastLine)) {
            const nl = text.indexOf('\n');
            if (nl >= 0) {
                return text.slice(0, nl).replace(/\s+$/, '');
            }
        }
        return text;
    },

    trimSuffixOverlap,
    balanceBrackets,
    trimPrefixEcho,
};

function runPipeline(raw: string, prefix: string, suffix: string): string | null {
    let text: string | null = stages.nullOrWhitespace(raw);
    if (text === null) return null;

    text = stages.stripLeadingNewlines(text);
    text = stages.singleLineIfMidExpression(text, prefix);
    text = trimSuffixOverlap(text, suffix);
    text = balanceBrackets(text);
    text = trimPrefixEcho(text, prefix);

    return stages.nullOrWhitespace(text);
}

function lastLineOf(s: string): string {
    const i = s.lastIndexOf('\n');
    return i === -1 ? s : s.slice(i + 1);
}

// Heuristic: the prefix line is "mid-expression" if it ends with an operator,
// comma, opening bracket, etc. - a place where multi-line completion would
// produce malformed code.
function isMidExpression(line: string): boolean {
    return /[(\[{,=+\-*/<>!&|^?:]\s*$/.test(line);
}

export function trimSuffixOverlap(text: string, suffix: string): string {
    if (!suffix || !text) return text;
    // Find the largest k such that text.slice(-k) === suffix.slice(0, k).
    const max = Math.min(text.length, suffix.length);
    for (let k = max; k > 0; k--) {
        if (text.endsWith(suffix.slice(0, k))) {
            return text.slice(0, text.length - k);
        }
    }
    return text;
}

export function trimPrefixEcho(text: string, prefix: string): string {
    if (!text || !prefix) return text;
    // Look at up to the last 200 chars of the prefix; if the completion starts
    // with a chunk equal to the tail of the prefix, drop that chunk.
    const tail = prefix.slice(-Math.min(prefix.length, 200));
    const max = Math.min(text.length, tail.length);
    for (let k = max; k > 0; k--) {
        if (tail.endsWith(text.slice(0, k))) {
            return text.slice(k);
        }
    }
    return text;
}

// State machine for tracking string/comment/regex regions while we count
// bracket depth. This is a heuristic - it covers the common cases for C-family,
// JS, Python, and similar languages. It is not a full lexer.
type ScanState =
    | 'code'
    | 'lineComment'
    | 'blockComment'
    | 'stringSingle'
    | 'stringDouble'
    | 'stringBacktick';

export function balanceBrackets(text: string): string {
    let depth = 0;
    let state: ScanState = 'code';

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1] ?? '';

        switch (state) {
            case 'code':
                if (ch === '/' && next === '/') {
                    state = 'lineComment'; i++; continue;
                }
                if (ch === '/' && next === '*') {
                    state = 'blockComment'; i++; continue;
                }
                if (ch === "'") { state = 'stringSingle'; continue; }
                if (ch === '"') { state = 'stringDouble'; continue; }
                if (ch === '`') { state = 'stringBacktick'; continue; }
                if (ch === '#') {
                    // Treat as line comment for shell/python-like languages.
                    state = 'lineComment'; continue;
                }
                if (ch === '(' || ch === '[' || ch === '{') {
                    depth++;
                } else if (ch === ')' || ch === ']' || ch === '}') {
                    if (depth === 0) {
                        // Closing bracket without a matching opener inside the
                        // completion - trim here.
                        return text.slice(0, i);
                    }
                    depth--;
                }
                break;

            case 'lineComment':
                if (ch === '\n') state = 'code';
                break;

            case 'blockComment':
                if (ch === '*' && next === '/') { state = 'code'; i++; }
                break;

            case 'stringSingle':
                if (ch === '\\') { i++; break; }
                if (ch === "'") state = 'code';
                if (ch === '\n') state = 'code'; // unterminated - bail out of string
                break;

            case 'stringDouble':
                if (ch === '\\') { i++; break; }
                if (ch === '"') state = 'code';
                if (ch === '\n') state = 'code';
                break;

            case 'stringBacktick':
                if (ch === '\\') { i++; break; }
                if (ch === '`') state = 'code';
                break;
        }
    }
    return text;
}
