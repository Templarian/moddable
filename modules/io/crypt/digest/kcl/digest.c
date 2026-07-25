/*
 * Copyright (c) 2026  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

/*
	ECMA-419 Crypto Digest — KCL software backend
*/

#include "xsPlatform.h"
#include "xsmc.h"
#include "mc.xs.h"			// for xsID_* values

#include "fips180.h"
#include "rfc1321.h"
#include "ghash.h"

enum {
	kAlgMD5,
	kAlgSHA1,
	kAlgSHA224,
	kAlgSHA256,
	kAlgSHA384,
	kAlgSHA512,
	kAlgGHASH,
};

typedef struct {
	const char *name;
	uint8_t alg;
	uint16_t	outputSize;
	uint16_t	blockSize;
} DigestAlgEntry;

union DigestCtx {
	struct md5 md5;
	struct sha1 sha1;
	struct sha256 sha256;		// also SHA224
	struct sha512 sha512;		// also SHA384
	ghash_t ghash;
};

typedef struct {
	union DigestCtx ctx;
	uint8_t alg;
} DigestRecord, *Digest;

static const DigestAlgEntry gDigestAlgs[] = {
	{ "MD5",    kAlgMD5,    MD5_DGSTSIZE,    MD5_BLKSIZE    },
	{ "SHA1",   kAlgSHA1,   SHA1_DGSTSIZE,   SHA1_BLKSIZE   },
	{ "SHA224", kAlgSHA224, SHA224_DGSTSIZE, SHA224_BLKSIZE },
	{ "SHA256", kAlgSHA256, SHA256_DGSTSIZE, SHA256_BLKSIZE },
	{ "SHA384", kAlgSHA384, SHA384_DGSTSIZE, SHA384_BLKSIZE },
	{ "SHA512", kAlgSHA512, SHA512_DGSTSIZE, SHA512_BLKSIZE },
	{ "GHASH",  kAlgGHASH,  GHASH_DGSTSIZE,  GHASH_BLKSIZE  },
	{ NULL, 0, 0, 0 }
};

static const DigestAlgEntry *findAlg(uint8_t alg)
{
	for (const DigestAlgEntry *entry = gDigestAlgs; entry->name; entry++) {
		if (entry->alg == alg)
			return entry;
	}
	return NULL;
}

void xs_digest_destructor(void *data)
{
	// this space intentionally left black
}

void xs_digest_constructor(xsMachine *the)
{
	xsmcVars(1);
	if (!xsmcGet(xsVar(0), xsArg(0), xsID_algorithm))
		xsUnknownError("algorithm required");
	char *algorithm = xsmcToString(xsVar(0));

	const DigestAlgEntry *entry;
	for (entry = gDigestAlgs; entry->name; entry++) {
		if (0 == c_strcmp(algorithm, entry->name))
			break;
	}
	if (!entry->name)
		xsUnknownError("unsupported algorithm");

	DigestRecord init = { .alg = entry->alg };

	if (kAlgGHASH == entry->alg) {
		if (!xsmcGet(xsVar(0), xsArg(0), xsID_H))
			xsUnknownError("H required");
		void *H;
		xsUnsignedValue HLen;
		xsmcGetBufferReadable(xsVar(0), &H, &HLen);
		if (16 != HLen)
			xsRangeError("H must be 16 bytes");
		c_memcpy(&init.ctx.ghash.h, H, 16);
		_ghash_fix128(&init.ctx.ghash.h);

		if (xsmcGet(xsVar(0), xsArg(0), xsID_additionalData)) {
			void *aad;
			xsUnsignedValue aadLen;
			xsmcGetBufferReadable(xsVar(0), &aad, &aadLen);
			_ghash_update(&init.ctx.ghash, aad, aadLen);
			_ghash_flush_partial(&init.ctx.ghash);
			init.ctx.ghash.y0 = init.ctx.ghash.y;
			init.ctx.ghash.aad_len = aadLen;
		}
	}

	switch (entry->alg) {
		case kAlgMD5:    md5_create(&init.ctx.md5); break;
		case kAlgSHA1:   sha1_create(&init.ctx.sha1); break;
		case kAlgSHA224: sha224_create(&init.ctx.sha256); break;
		case kAlgSHA256: sha256_create(&init.ctx.sha256); break;
		case kAlgSHA384: sha384_create(&init.ctx.sha512); break;
		case kAlgSHA512: sha512_create(&init.ctx.sha512); break;
		case kAlgGHASH:  _ghash_create(&init.ctx.ghash); break;
	}

	xsmcSetHostChunk(xsThis, &init, sizeof(init));
}

void xs_digest_close(xsMachine *the)
{
	if (!xsGetHostChunkIf(xsThis))
		return;
	xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	xsmcSetHostData(xsThis, NULL);	// downgrade to data slot so subsequent calls throw SyntaxError
}

void xs_digest_write(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	void *data;
	xsUnsignedValue size;

	xsmcGetBufferReadable(xsArg(0), &data, &size);

	switch (digest->alg) {
		case kAlgMD5:    md5_update(&digest->ctx.md5, data, (uint32_t)size); break;
		case kAlgSHA1:   sha1_update(&digest->ctx.sha1, data, (uint32_t)size); break;
		case kAlgSHA224: sha224_update(&digest->ctx.sha256, data, (uint32_t)size); break;
		case kAlgSHA256: sha256_update(&digest->ctx.sha256, data, (uint32_t)size); break;
		case kAlgSHA384: sha384_update(&digest->ctx.sha512, data, (uint32_t)size); break;
		case kAlgSHA512: sha512_update(&digest->ctx.sha512, data, (uint32_t)size); break;
		case kAlgGHASH:  _ghash_update(&digest->ctx.ghash, data, size); break;
	}
}

void xs_digest_read(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	const DigestAlgEntry *entry = findAlg(digest->alg);
	uint8_t *out;

	if (xsmcArgc > 0) {
		xsUnsignedValue outLen;
		xsmcGetBufferWritable(xsArg(0), (void **)&out, &outLen);
		if (outLen < entry->outputSize)
			xsRangeError("buffer too small");
		xsmcSetInteger(xsResult, entry->outputSize);
	}
	else
		out = xsmcSetArrayBuffer(xsResult, NULL, entry->outputSize);

	digest = xsmcGetHostChunk(xsThis);
	union DigestCtx clone = digest->ctx;	// byte-copy for non-destructive read
	switch (digest->alg) {
		case kAlgMD5:    md5_fin(&clone.md5, out); break;
		case kAlgSHA1:   sha1_fin(&clone.sha1, out); break;
		case kAlgSHA224: sha224_fin(&clone.sha256, out); break;
		case kAlgSHA256: sha256_fin(&clone.sha256, out); break;
		case kAlgSHA384: sha384_fin(&clone.sha512, out); break;
		case kAlgSHA512: sha512_fin(&clone.sha512, out); break;
		case kAlgGHASH:  _ghash_fin(&clone.ghash, out); break;
	}
}

void xs_digest_reset(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	switch (digest->alg) {
		case kAlgMD5:    md5_create(&digest->ctx.md5); break;
		case kAlgSHA1:   sha1_create(&digest->ctx.sha1); break;
		case kAlgSHA224: sha224_create(&digest->ctx.sha256); break;
		case kAlgSHA256: sha256_create(&digest->ctx.sha256); break;
		case kAlgSHA384: sha384_create(&digest->ctx.sha512); break;
		case kAlgSHA512: sha512_create(&digest->ctx.sha512); break;
		case kAlgGHASH:  _ghash_create(&digest->ctx.ghash); break;
	}
}

void xs_digest_get_blockSize(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	xsmcSetInteger(xsResult, findAlg(digest->alg)->blockSize);
}

void xs_digest_get_outputSize(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	xsmcSetInteger(xsResult, findAlg(digest->alg)->outputSize);
}
