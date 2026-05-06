import * as assert from 'assert';
import { isInsideJsxTag } from '../completion/midLine';
import { findSuffixOverlapLength } from '../completion/postprocess';

describe('isInsideJsxTag', () => {
    it('cursor inside an opening tag attribute → true', () => {
        assert.strictEqual(isInsideJsxTag('<Button onClick={'), true);
    });

    it('tag already closed by > → false', () => {
        assert.strictEqual(isInsideJsxTag('<Button onClick={x}>'), false);
    });

    it('comparison with both < and > on the line → false', () => {
        // last '<' (index 12) is followed by '>' (index 21) so the
        // algorithm correctly returns false.
        // NOTE: a line like `a < b && c < d` (two '<', no '>') IS a known
        // false-positive that returns true. This causes one extra request
        // whose completion the post-processor will silently reject — no
        // incorrect text is shown to the user.
        assert.strictEqual(isInsideJsxTag('const x = a < b && c > d ? '), false);
    });

    it('empty string → false', () => {
        assert.strictEqual(isInsideJsxTag(''), false);
    });

    it('no angle brackets → false', () => {
        assert.strictEqual(isInsideJsxTag('no angle brackets here'), false);
    });
});

describe('findSuffixOverlapLength', () => {
    it('single char overlap', () => {
        assert.strictEqual(findSuffixOverlapLength('foo)', ')'), 1);
    });

    it('two char overlap', () => {
        assert.strictEqual(findSuffixOverlapLength('foo})', '})'), 2);
    });

    it('no overlap', () => {
        assert.strictEqual(findSuffixOverlapLength('foo', 'bar'), 0);
    });

    it('empty text → 0', () => {
        assert.strictEqual(findSuffixOverlapLength('', 'abc'), 0);
    });
});
