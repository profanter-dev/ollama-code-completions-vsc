import * as assert from 'assert';
import Module from 'module';

import type { Config as ConfigType } from '../config';

let disabledLanguages: string[] = [];
const host = {
    EventEmitter: class {
        readonly event = () => undefined;
        dispose() {}
    },
    workspace: {
        getConfiguration: () => ({
            get: (key: string, fallback: unknown) => key === 'disabledLanguages' ? disabledLanguages : fallback,
        }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
    },
};

const loader = Module as typeof Module & { _load: (id: string, parent: Module, isMain: boolean) => unknown };
const originalLoad = loader._load;
let Config: typeof ConfigType;
try {
    loader._load = (id, parent, isMain) => id === 'vscode' ? host : originalLoad(id, parent, isMain);
    ({ Config } = require('../config'));
} finally {
    loader._load = originalLoad;
}

describe('disabled languages configuration', () => {
    it('normalizes array entries independently', () => {
        disabledLanguages = [' TypeScript ', 'PYTHON', 'typescript', ''];
        const config = new Config();
        assert.deepStrictEqual([...config.disabledLanguages], ['typescript', 'python']);
        config.dispose();
    });
});

