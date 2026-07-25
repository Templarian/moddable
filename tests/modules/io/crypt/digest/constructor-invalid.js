/*---
description:
flags: [module]
---*/

import Digest from "./digest_FIXTURE.js";

// missing algorithm property
assert.throws(Error, () => new Digest({}), "empty options should throw");

// unknown algorithm string
assert.throws(Error, () => new Digest({algorithm: "NOPE"}), "unknown algorithm should throw");

// coerced non-string algorithm: still goes through string-compare lookup → unsupported
assert.throws(Error, () => new Digest({algorithm: 42}), "numeric algorithm should throw");
assert.throws(Error, () => new Digest({algorithm: null}), "null algorithm should throw");

// case-sensitive: algorithm names are upper-case in the spec
assert.throws(Error, () => new Digest({algorithm: "sha256"}), "lower-case algorithm should throw");
assert.throws(Error, () => new Digest({algorithm: "Sha256"}), "mixed-case algorithm should throw");
