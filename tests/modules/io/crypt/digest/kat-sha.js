/*---
description:
flags: [module]
---*/

import {KAT, digestOf} from "./digest_FIXTURE.js";

for (const algorithm of ["SHA1", "SHA224", "SHA256", "SHA384", "SHA512"]) {
	for (const {in: input, out} of KAT[algorithm]) {
		assert.sameValue(digestOf({algorithm}, input), out, `${algorithm}(${input.byteLength}B)`);
	}
}
