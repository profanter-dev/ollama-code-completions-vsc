import * as assert from 'assert';
import { CompletionCache } from '../completion/cache';

describe('CompletionCache', () => {
    it('returns exact matches', () => {
        const cache = new CompletionCache(10);
        cache.set('foo', 'bar', 'baz');
        assert.strictEqual(cache.lookup('foo', 'bar'), 'baz');
    });

    it('returns undefined for unknown keys', () => {
        const cache = new CompletionCache(10);
        cache.set('foo', 'bar', 'baz');
        assert.strictEqual(cache.lookup('nope', 'bar'), undefined);
        assert.strictEqual(cache.lookup('foo', 'wrong'), undefined);
    });

    it('evicts least-recently used entries when capacity is exceeded', () => {
        const cache = new CompletionCache(2);
        cache.set('a', '', '1');
        cache.set('b', '', '2');
        cache.set('c', '', '3'); // evicts 'a'
        assert.strictEqual(cache.lookup('a', ''), undefined);
        assert.strictEqual(cache.lookup('b', ''), '2');
        assert.strictEqual(cache.lookup('c', ''), '3');
    });

    it('promotes entries on lookup so they survive eviction', () => {
        const cache = new CompletionCache(2);
        cache.set('a', '', '1');
        cache.set('b', '', '2');
        cache.lookup('a', ''); // 'a' becomes most recent
        cache.set('c', '', '3'); // evicts 'b', not 'a'
        assert.strictEqual(cache.lookup('a', ''), '1');
        assert.strictEqual(cache.lookup('b', ''), undefined);
    });

    it('serves prefix-extension matches when typed-ahead chars match the cached completion', () => {
        const cache = new CompletionCache(10);
        cache.set('function foo(', '', 'arg) { return arg; }');
        // User typed 'a' after 'foo(' - should get the rest of the completion.
        const result = cache.lookup('function foo(a', '');
        assert.strictEqual(result, 'rg) { return arg; }');
    });

    it('does not serve a prefix-extension match if typed chars diverge', () => {
        const cache = new CompletionCache(10);
        cache.set('foo(', '', 'arg) { }');
        assert.strictEqual(cache.lookup('foo(b', ''), undefined);
    });

    it('does not serve a prefix-extension match across different suffixes', () => {
        const cache = new CompletionCache(10);
        cache.set('foo(', '\n}', 'arg) { return arg; }');
        assert.strictEqual(cache.lookup('foo(a', '\nDIFFERENT'), undefined);
    });

    it('avoids the (a,bc) vs (ab,c) key collision', () => {
        const cache = new CompletionCache(10);
        cache.set('a', 'bc', 'first');
        cache.set('ab', 'c', 'second');
        assert.strictEqual(cache.lookup('a', 'bc'), 'first');
        assert.strictEqual(cache.lookup('ab', 'c'), 'second');
    });

    it('clear() empties the cache', () => {
        const cache = new CompletionCache(10);
        cache.set('a', '', '1');
        cache.set('b', '', '2');
        cache.clear();
        assert.strictEqual(cache.size, 0);
        assert.strictEqual(cache.lookup('a', ''), undefined);
    });

    it('returns undefined when the prefix-extension typed-ahead exactly equals the completion', () => {
        // After the user has typed everything the model would have suggested
        // there is nothing left to insert; we should not suggest empty text.
        const cache = new CompletionCache(10);
        cache.set('foo(', '', 'arg)');
        assert.strictEqual(cache.lookup('foo(arg)', ''), undefined);
    });
});
