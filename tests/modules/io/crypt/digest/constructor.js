/*---
description:
flags: [module]
---*/

import Digest, {algMeta, H_TC2} from "./digest_FIXTURE.js";

for (const {algorithm} of algMeta) {
	const options = ("GHASH" === algorithm) ? {algorithm, H: H_TC2} : {algorithm};
	const d = new Digest(options);
	assert.sameValue(typeof d, "object", `${algorithm}: constructor returned non-object`);
	d.close();
}
