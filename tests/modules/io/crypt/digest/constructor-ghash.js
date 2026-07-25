/*---
description:
flags: [module]
---*/

import Digest, {H_TC2, C_TC2, expected_TC2} from "./digest_FIXTURE.js";

// H is required
assert.throws(Error, () => new Digest({algorithm: "GHASH"}), "missing H should throw");

// H must be exactly 16 bytes
assert.throws(RangeError, () => new Digest({algorithm: "GHASH", H: new ArrayBuffer(0)}),  "0-byte H should throw RangeError");
assert.throws(RangeError, () => new Digest({algorithm: "GHASH", H: new ArrayBuffer(15)}), "15-byte H should throw RangeError");
assert.throws(RangeError, () => new Digest({algorithm: "GHASH", H: new ArrayBuffer(17)}), "17-byte H should throw RangeError");
assert.throws(RangeError, () => new Digest({algorithm: "GHASH", H: new ArrayBuffer(32)}), "32-byte H should throw RangeError");

// H must be a buffer (xsmcGetBufferReadable throws TypeError on non-buffer)
assert.throws(TypeError, () => new Digest({algorithm: "GHASH", H: "0123456789012345"}),  "string H should throw TypeError");
assert.throws(TypeError, () => new Digest({algorithm: "GHASH", H: 42}),                   "number H should throw TypeError");
assert.throws(TypeError, () => new Digest({algorithm: "GHASH", H: null}),                 "null H should throw TypeError");
assert.throws(TypeError, () => new Digest({algorithm: "GHASH", H: {}}),                   "plain object H should throw TypeError");

// additionalData must be a buffer if present
assert.throws(TypeError, () => new Digest({algorithm: "GHASH", H: H_TC2, additionalData: "abc"}), "string additionalData should throw TypeError");
assert.throws(TypeError, () => new Digest({algorithm: "GHASH", H: H_TC2, additionalData: 42}),    "number additionalData should throw TypeError");
assert.throws(TypeError, () => new Digest({algorithm: "GHASH", H: H_TC2, additionalData: null}),  "null additionalData should throw TypeError");

// empty additionalData is valid and equivalent to omitting it
const noAAD = new Digest({algorithm: "GHASH", H: H_TC2});
noAAD.write(C_TC2);
const tagNoAAD = new Uint8Array(noAAD.read()).toHex();
noAAD.close();

const emptyAAD = new Digest({algorithm: "GHASH", H: H_TC2, additionalData: new ArrayBuffer(0)});
emptyAAD.write(C_TC2);
const tagEmptyAAD = new Uint8Array(emptyAAD.read()).toHex();
emptyAAD.close();

assert.sameValue(tagNoAAD, expected_TC2, "GHASH NIST TC2 expected");
assert.sameValue(tagEmptyAAD, expected_TC2, "empty additionalData equals omitting it");

// H accepts other buffer types
const HBytes = new Uint8Array(H_TC2);
const dArr = new Digest({algorithm: "GHASH", H: HBytes});
dArr.close();
const dView = new Digest({algorithm: "GHASH", H: new DataView(H_TC2)});
dView.close();
