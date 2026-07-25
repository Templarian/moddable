/*---
description:
flags: [module]
---*/

import {KAT, digestOf} from "./digest_FIXTURE.js";

for (const {in: input, out} of KAT.MD5) {
	assert.sameValue(digestOf({algorithm: "MD5"}, input), out, `MD5(${input.byteLength}B)`);
}
