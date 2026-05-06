import * as assert from 'assert';
import { isInsideJsonStringValue } from '../completion/contextDetect';

function fakeDoc(languageId: string, lineText: string): any {
    return { languageId, lineAt: (_line: number) => ({ text: lineText }) };
}

function fakePos(character: number): any {
    return { line: 0, character };
}

describe('isInsideJsonStringValue', () => {
    it('cursor inside a string value in JSON → true', () => {
        // line: "foo"   positions: "(0) f(1) o(2) o(3) "(4)
        // cursor at 4 → prefix = "foo → still inside the string
        assert.strictEqual(isInsideJsonStringValue(fakeDoc('json', '"foo"'), fakePos(4)), true);
    });

    it('cursor just past the closing quote → false', () => {
        // cursor at 5 → prefix = "foo" → string is closed
        assert.strictEqual(isInsideJsonStringValue(fakeDoc('json', '"foo"'), fakePos(5)), false);
    });

    it('cursor on a line with no string in JSON → false', () => {
        assert.strictEqual(isInsideJsonStringValue(fakeDoc('json', '  {'), fakePos(2)), false);
    });

    it('same text in a TypeScript file → false (wrong language)', () => {
        assert.strictEqual(isInsideJsonStringValue(fakeDoc('typescript', '"foo"'), fakePos(2)), false);
    });

    it('escaped quote inside a string is not treated as the closing quote → true', () => {
        // line: "a \"b\" c"
        // char positions: "(0) a(1)  (2) \(3) "(4) b(5) \(6) "(7)  (8) c(9) "(10)
        // cursor at 10 → prefix = "a \"b\" c → insideString = true
        assert.strictEqual(isInsideJsonStringValue(fakeDoc('json', '"a \\"b\\" c"'), fakePos(10)), true);
    });

    it('jsonc language ID is also accepted → true', () => {
        assert.strictEqual(isInsideJsonStringValue(fakeDoc('jsonc', '"hello"'), fakePos(3)), true);
    });
});
