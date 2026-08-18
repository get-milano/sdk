/**
 * The one platform global the engine touches, declared minimally so the
 * library typechecks without pulling in DOM or Node type libraries. Node,
 * browsers, and React Native all provide it.
 */
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}
