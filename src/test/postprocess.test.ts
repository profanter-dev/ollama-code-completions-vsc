import * as assert from 'assert';
import {
    postProcess,
    stages,
    trimSuffixOverlap,
    trimPrefixEcho,
    balanceBrackets,
    capLines,
} from '../completion/postprocess';

describe('postProcess pipeline', () => {
    it('rejects empty raw text (stage 1)', () => {
        assert.strictEqual(postProcess({ raw: '', prefix: '', suffix: '' }), null);
    });

    it('rejects whitespace-only raw text (stage 1)', () => {
        assert.strictEqual(postProcess({ raw: '   \n  \t  ', prefix: '', suffix: '' }), null);
    });

    it('strips a leading newline (stage 2)', () => {
        const out = postProcess({ raw: '\nhello', prefix: 'x', suffix: '' });
        assert.strictEqual(out, 'hello');
    });

    it('trims to a single line when the prefix ends mid-expression (stage 3)', () => {
        const out = postProcess({
            raw: 'first(\nsecond\n)',
            prefix: 'foo(',
            suffix: '',
        });
        assert.strictEqual(out, 'first(');
    });

    it('keeps multi-line completions when the prefix is at a statement boundary (stage 3)', () => {
        const out = postProcess({
            raw: 'line1\nline2',
            prefix: 'function foo() {\n    ',
            suffix: '',
        });
        assert.ok(out !== null && out.includes('\n'));
    });

    it('strips suffix overlap (stage 4)', () => {
        // Completion ends with `}` which is already the start of the suffix.
        const out = postProcess({
            raw: 'return arg;\n}',
            prefix: 'foo(arg) {\n    ',
            suffix: '\n}',
        });
        assert.strictEqual(out, 'return arg;');
    });

    it('balances brackets by trimming at an unmatched closer (stage 5)', () => {
        const out = postProcess({
            raw: 'doStuff();\n}\nextra',
            prefix: 'function foo() {\n',
            suffix: '',
        });
        assert.strictEqual(out, 'doStuff();\n');
    });

    it('does not trim closers that match openers inside the completion (stage 5)', () => {
        const out = postProcess({
            raw: 'if (x) { go(); }',
            prefix: 'function f() {\n    ',
            suffix: '',
        });
        assert.strictEqual(out, 'if (x) { go(); }');
    });

    it('ignores closers inside string literals when balancing (stage 5)', () => {
        const out = postProcess({
            raw: 'log("}");\nmore',
            prefix: 'function f() {\n',
            suffix: '',
        });
        // The } inside the string should not cause a trim.
        assert.strictEqual(out, 'log("}");\nmore');
    });

    it('ignores closers inside line comments when balancing (stage 5)', () => {
        const out = postProcess({
            raw: 'x; // }\ny',
            prefix: 'function f() {\n',
            suffix: '',
        });
        assert.strictEqual(out, 'x; // }\ny');
    });

    it('trims prefix echo (stage 6)', () => {
        const out = postProcess({
            raw: 'foo(bar);',
            prefix: 'const x = foo(',
            suffix: '',
        });
        assert.strictEqual(out, 'bar);');
    });

    it('rejects results that become empty after processing (stage 7)', () => {
        // Suffix overlap consumes the entire completion.
        const out = postProcess({
            raw: '})',
            prefix: 'foo(',
            suffix: '})',
        });
        assert.strictEqual(out, null);
    });
});

describe('post-process helpers', () => {
    it('trimSuffixOverlap finds the largest matching tail', () => {
        assert.strictEqual(trimSuffixOverlap('abcdef', 'def!!!'), 'abc');
        assert.strictEqual(trimSuffixOverlap('abcdef', 'xyz'), 'abcdef');
        assert.strictEqual(trimSuffixOverlap('', 'abc'), '');
        assert.strictEqual(trimSuffixOverlap('abc', ''), 'abc');
    });

    it('trimPrefixEcho strips a matching prefix tail', () => {
        assert.strictEqual(trimPrefixEcho('barbaz', 'foobar'), 'baz');
        assert.strictEqual(trimPrefixEcho('hello', 'world'), 'hello');
    });

    it('balanceBrackets returns text unchanged when balanced', () => {
        assert.strictEqual(balanceBrackets('a + (b * c)'), 'a + (b * c)');
        assert.strictEqual(balanceBrackets('arr[0]'), 'arr[0]');
    });

    it('balanceBrackets handles backtick template strings', () => {
        const text = '`closing }` then more';
        assert.strictEqual(balanceBrackets(text), text);
    });

    it('balanceBrackets handles block comments', () => {
        const text = '/* } */\nrun();';
        assert.strictEqual(balanceBrackets(text), text);
    });

    it('stages.singleLineIfMidExpression detects operator endings', () => {
        const out = stages.singleLineIfMidExpression('a\nb', 'x =');
        assert.strictEqual(out, 'a');
    });

    it('stages.singleLineIfMidExpression leaves complete statements alone', () => {
        const out = stages.singleLineIfMidExpression('a\nb', 'x = 1;');
        assert.strictEqual(out, 'a\nb');
    });
});

describe('capLines', () => {
    it('truncates to maxLines lines', () => {
        const input = 'line1\nline2\nline3\nline4\nline5';
        assert.strictEqual(capLines(input, 3), 'line1\nline2\nline3');
    });

    it('is a no-op when text has fewer lines than the cap', () => {
        const input = 'line1\nline2\nline3';
        assert.strictEqual(capLines(input, 10), input);
    });

    it('preserves embedded blank lines within the cap', () => {
        const input = 'line1\n\nline3\nline4\nline5';
        assert.strictEqual(capLines(input, 3), 'line1\n\nline3');
    });

    it('strips trailing whitespace on the last kept line when truncating', () => {
        const input = 'line1   \nline2\nline3';
        assert.strictEqual(capLines(input, 1), 'line1');
    });

    it('does not strip trailing whitespace when no truncation occurs', () => {
        const input = 'line1   \nline2';
        assert.strictEqual(capLines(input, 5), input);
    });
});

describe('postProcess with maxLines', () => {
    it('maxLines=1 returns at most one line even when raw contains many', () => {
        const out = postProcess({
            raw: 'line1\nline2\nline3',
            prefix: 'function foo() {\n    ',
            suffix: '',
            maxLines: 1,
        });
        assert.strictEqual(out, 'line1');
    });

    it('maxLines=3 keeps 3 lines of a 5-line completion', () => {
        const out = postProcess({
            raw: 'a\nb\nc\nd\ne',
            prefix: 'function foo() {\n    ',
            suffix: '',
            maxLines: 3,
        });
        assert.ok(out !== null);
        assert.strictEqual(out!.split('\n').length, 3);
    });
});
