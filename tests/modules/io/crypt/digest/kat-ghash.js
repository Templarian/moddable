/*---
description:
flags: [module]
---*/

import {digestOf, H_TC2, C_TC2, expected_TC2} from "./digest_FIXTURE.js";

// NIST SP 800-38D Test Case 2: K=0, P=0^128, IV=0^96, A=empty
//   H = 66e94bd4ef8a2c3b884cfa59ca342b2e
//   C = 0388dace60b6a392f328c2b971b2fe78
//   GHASH(H, A=empty, C) = T XOR AES_K(Y0) = f38cbb1ad69223dcc3457ae5b6b0f885
assert.sameValue(
	digestOf({algorithm: "GHASH", H: H_TC2}, C_TC2),
	expected_TC2,
	"NIST SP 800-38D Test Case 2"
);

// With no AAD and no ciphertext, the only block processed by GHASH is
// the length block (0||0), so y = 0 * H = 0. Output is all zeros.
assert.sameValue(
	digestOf({algorithm: "GHASH", H: H_TC2}),
	"00000000000000000000000000000000",
	"GHASH(H, empty, empty) = 0"
);

// Same result regardless of H, since 0 * anything in GF(2^128) = 0.
const H_OTHER = Uint8Array.fromHex("0123456789abcdef0123456789abcdef").buffer;
assert.sameValue(
	digestOf({algorithm: "GHASH", H: H_OTHER}),
	"00000000000000000000000000000000",
	"GHASH(arbitrary H, empty, empty) = 0"
);

// Bytewise streaming must equal hashing whole — write() is chunking-agnostic.
const bytes = new Uint8Array(C_TC2);
const perByte = [];
for (let i = 0; i < bytes.length; i++)
	perByte.push(bytes.subarray(i, i + 1));
assert.sameValue(
	digestOf({algorithm: "GHASH", H: H_TC2}, ...perByte),
	expected_TC2,
	"GHASH bytewise streaming matches single write"
);

// Odd chunking that straddles 16-byte boundaries.
const oddChunks = [
	bytes.subarray(0, 5),
	bytes.subarray(5, 9),
	bytes.subarray(9, 16),
];
assert.sameValue(
	digestOf({algorithm: "GHASH", H: H_TC2}, ...oddChunks),
	expected_TC2,
	"GHASH odd-chunked streaming matches single write"
);
