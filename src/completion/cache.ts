// LRU cache with two access modes:
//
//   1. exact match by (prefix, suffix) hash key
//   2. prefix-extension match: if the user has typed N additional characters
//      beyond a previous prefix and the cached completion starts with those
//      N characters, the remainder of the completion can be served instantly.
//
// The hash key includes prefix.length explicitly to avoid the
// (a, bc) vs (ab, c) collision class.

interface Node {
    key: string;
    prefix: string;
    suffix: string;
    completion: string;
    prev: Node | null;
    next: Node | null;
}

export class CompletionCache {
    private readonly map = new Map<string, Node>();
    private head: Node | null = null;
    private tail: Node | null = null;

    constructor(private readonly capacity: number = 100, private readonly extensionLookbackEntries: number = 20) {
        if (capacity < 1) {
            throw new Error('capacity must be >= 1');
        }
    }

    get size(): number {
        return this.map.size;
    }

    /**
     * Look up a completion. Returns the cached completion text if either an
     * exact match or a prefix-extension match is found. For a prefix-extension
     * match the returned text is the cached completion with the typed-ahead
     * characters removed from the front.
     */
    lookup(prefix: string, suffix: string): string | undefined {
        // 1. Exact match.
        const key = makeKey(prefix, suffix);
        const exact = this.map.get(key);
        if (exact) {
            this.touch(exact);
            return exact.completion;
        }

        // 2. Prefix-extension match against most-recent entries.
        let node = this.head;
        let scanned = 0;
        while (node && scanned < this.extensionLookbackEntries) {
            if (suffix === node.suffix && prefix.length > node.prefix.length && prefix.startsWith(node.prefix)) {
                const typed = prefix.slice(node.prefix.length);
                if (node.completion.startsWith(typed)) {
                    const remaining = node.completion.slice(typed.length);
                    if (remaining.length > 0) {
                        this.touch(node);
                        return remaining;
                    }
                }
            }
            node = node.next;
            scanned++;
        }
        return undefined;
    }

    set(prefix: string, suffix: string, completion: string): void {
        const key = makeKey(prefix, suffix);
        const existing = this.map.get(key);
        if (existing) {
            existing.completion = completion;
            this.touch(existing);
            return;
        }

        const node: Node = { key, prefix, suffix, completion, prev: null, next: null };
        this.map.set(key, node);
        this.pushFront(node);

        while (this.map.size > this.capacity) {
            this.evictTail();
        }
    }

    clear(): void {
        this.map.clear();
        this.head = null;
        this.tail = null;
    }

    /** Iteration order is most-recent first. Exposed for tests. */
    *entries(): IterableIterator<{ prefix: string; suffix: string; completion: string }> {
        let node = this.head;
        while (node) {
            yield { prefix: node.prefix, suffix: node.suffix, completion: node.completion };
            node = node.next;
        }
    }

    private touch(node: Node): void {
        if (node === this.head) {
            return;
        }
        this.unlink(node);
        this.pushFront(node);
    }

    private pushFront(node: Node): void {
        node.prev = null;
        node.next = this.head;
        if (this.head) {
            this.head.prev = node;
        }
        this.head = node;
        if (!this.tail) {
            this.tail = node;
        }
    }

    private unlink(node: Node): void {
        if (node.prev) {
            node.prev.next = node.next;
        } else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this.tail = node.prev;
        }
        node.prev = null;
        node.next = null;
    }

    private evictTail(): void {
        if (!this.tail) {
            return;
        }
        const evicted = this.tail;
        this.unlink(evicted);
        this.map.delete(evicted.key);
    }
}

// Use prefix.length as a separator so (a, bc) and (ab, c) hash differently.
// The U+0001 / U+0002 control characters cannot appear in source code in a
// way that would create ambiguity at the boundary.
function makeKey(prefix: string, suffix: string): string {
    return `${prefix.length}\u0001${prefix}\u0002${suffix}`;
}
