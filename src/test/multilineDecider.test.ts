import * as assert from 'assert';
import {
    decideMultiline,
    isLineCommentStart,
    isInJsxAttributeValue,
} from '../completion/multilineDecider';

const BASE = { prefix: '', afterCursor: '' };

describe('decideMultiline', () => {
    it("mode='never' always returns 'single'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'never', languageId: 'typescript', lineBeforeCursor: '' }),
            'single'
        );
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'never', languageId: 'typescript', lineBeforeCursor: 'function foo() {' }),
            'single'
        );
    });

    it("mode='always' always returns 'multi'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'always', languageId: 'typescript', lineBeforeCursor: '// comment' }),
            'multi'
        );
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'always', languageId: 'typescript', lineBeforeCursor: '' }),
            'multi'
        );
    });

    it("mode='auto' on a `// foo` line in TypeScript returns 'single' (screenshot case)", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: '    // test' }),
            'single'
        );
    });

    it("mode='auto' on a `# foo` line in Python returns 'single'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'python', lineBeforeCursor: '# setup' }),
            'single'
        );
    });

    it("mode='auto' on a `/**` JSDoc line returns 'multi' (block comment is NOT a line comment)", () => {
        // Cursor right after /** — opening a JSDoc block, multi-line is appropriate.
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: '/**' }),
            'multi'
        );
    });

    it("mode='auto' inside `<Button onClick={` JSX attribute returns 'single'", () => {
        assert.strictEqual(
            decideMultiline({
                ...BASE,
                mode: 'auto',
                languageId: 'typescriptreact',
                lineBeforeCursor: '<Button onClick={',
                afterCursor: '}>',
            }),
            'single'
        );
    });

    it("mode='auto' on a line ending with `{` returns 'multi'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: 'function foo() {' }),
            'multi'
        );
    });

    it("mode='auto' on a line ending with `=> {` returns 'multi'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: 'const f = () => {' }),
            'multi'
        );
    });

    it("mode='auto' on a Python line ending with `:` returns 'multi'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'python', lineBeforeCursor: 'def foo():' }),
            'multi'
        );
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'python', lineBeforeCursor: 'if x > 0:' }),
            'multi'
        );
    });

    it("mode='auto' on a TypeScript line ending with `:` (type annotation) returns 'single'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: 'const x:' }),
            'single'
        );
    });

    it("mode='auto' on a blank line returns 'multi'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: '' }),
            'multi'
        );
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: '    ' }),
            'multi'
        );
    });

    it("mode='auto' inside a JSON string value returns 'single'", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'json', lineBeforeCursor: '  "key": "partial' }),
            'single'
        );
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'jsonc', lineBeforeCursor: '  "save": "Sav' }),
            'single'
        );
    });

    it("mode='auto' default fallback returns 'single' (mid-expression)", () => {
        assert.strictEqual(
            decideMultiline({ ...BASE, mode: 'auto', languageId: 'typescript', lineBeforeCursor: 'const x = foo' }),
            'single'
        );
    });
});

describe('isLineCommentStart', () => {
    it('detects // for TypeScript', () => {
        assert.strictEqual(isLineCommentStart('// hello', 'typescript'), true);
        assert.strictEqual(isLineCommentStart('/* block */', 'typescript'), false);
        assert.strictEqual(isLineCommentStart('const x = 1', 'typescript'), false);
    });

    it('detects # for Python', () => {
        assert.strictEqual(isLineCommentStart('# note', 'python'), true);
        assert.strictEqual(isLineCommentStart('x = 1', 'python'), false);
    });

    it('detects -- for SQL', () => {
        assert.strictEqual(isLineCommentStart('-- comment', 'sql'), true);
        assert.strictEqual(isLineCommentStart('SELECT 1', 'sql'), false);
    });

    it('falls back to // and # for unknown languages', () => {
        assert.strictEqual(isLineCommentStart('// note', 'unknown-lang'), true);
        assert.strictEqual(isLineCommentStart('# note', 'unknown-lang'), true);
        assert.strictEqual(isLineCommentStart('hello', 'unknown-lang'), false);
    });
});

describe('isInJsxAttributeValue', () => {
    it('returns true when cursor is right after ={', () => {
        assert.strictEqual(isInJsxAttributeValue('<Button onClick={'), true);
    });

    it('returns true when cursor is right after ="', () => {
        assert.strictEqual(isInJsxAttributeValue('<Input value="'), true);
    });

    it('returns false for non-JSX lines', () => {
        assert.strictEqual(isInJsxAttributeValue('const x = {'), false);
    });

    it('returns false when tag is already closed', () => {
        assert.strictEqual(isInJsxAttributeValue('<Button>text'), false);
    });
});
