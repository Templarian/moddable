/*---
description:
flags: [module]
---*/

import Digest, {algMeta, H_TC2, C_TC2, expected_TC2} from "./digest_FIXTURE.js";
import TextEncoder from "text/encoder";

const enc = new TextEncoder();

// for each non-GHASH algorithm: reset rewinds to fresh-construct state
for (const {algorithm, blockSize, outputSize} of algMeta) {
	if ("GHASH" === algorithm) continue;

	const d = new Digest({algorithm});
	d.write(enc.encode("polluting state with garbage data"));
	d.read();	// take a snapshot too; should not matter
	d.reset();

	d.write(enc.encode("abc"));
	const afterReset = new Uint8Array(d.read()).toHex();

	const fresh = new Digest({algorithm});
	fresh.write(enc.encode("abc"));
	const freshHash = new Uint8Array(fresh.read()).toHex();
	fresh.close();

	assert.sameValue(afterReset, freshHash, `${algorithm}: reset matches fresh`);
	assert.sameValue(d.blockSize, blockSize, `${algorithm}: blockSize unchanged after reset`);
	assert.sameValue(d.outputSize, outputSize, `${algorithm}: outputSize unchanged after reset`);
	d.close();
}

// GHASH: reset preserves H — same data after reset → same tag
{
	const g = new Digest({algorithm: "GHASH", H: H_TC2});
	g.write(enc.encode("pollution"));
	g.reset();
	g.write(C_TC2);
	const tag = new Uint8Array(g.read()).toHex();
	assert.sameValue(tag, expected_TC2, "GHASH reset preserves H");
	g.close();
}

// GHASH: reset preserves additionalData effects
{
	// build a tag with AAD pre-set; record it
	const a = new Digest({algorithm: "GHASH", H: H_TC2, additionalData: enc.encode("hello aad")});
	a.write(C_TC2);
	const tagWithAAD = new Uint8Array(a.read()).toHex();
	a.close();

	// reset then re-hash the same data: must match (AAD survived)
	const b = new Digest({algorithm: "GHASH", H: H_TC2, additionalData: enc.encode("hello aad")});
	b.write(enc.encode("noise"));
	b.reset();
	b.write(C_TC2);
	const tagAfterReset = new Uint8Array(b.read()).toHex();
	b.close();

	assert.sameValue(tagAfterReset, tagWithAAD, "GHASH reset preserves additionalData");
}
