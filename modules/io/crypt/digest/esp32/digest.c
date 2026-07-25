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
	ECMA-419 Crypto Digest — ESP32
	SHA family + MD5 via PSA Crypto. GHASH via KCL.
*/

#include "xsPlatform.h"
#include "xsmc.h"
#include "mc.xs.h"			// for xsID_* values

#include "psa/crypto.h"
#include "ghash.h"

typedef struct {
	union {
		psa_hash_operation_t psa;
		ghash_t ghash;
	} op;
	psa_algorithm_t alg;		// PSA_ALG_NONE (0) selects the GHASH path
	uint16_t outputSize;
	uint16_t blockSize;
} DigestRecord, *Digest;

typedef struct {
	const char *name;
	psa_algorithm_t alg;
	uint16_t outputSize;
	uint16_t blockSize;
} DigestAlgEntry;

static const DigestAlgEntry gDigestAlgs[] = {
	{ "MD5",    PSA_ALG_MD5,    16, 64  },
	{ "SHA1",   PSA_ALG_SHA_1,  20, 64  },
	{ "SHA224", PSA_ALG_SHA_224, 28, 64  },
	{ "SHA256", PSA_ALG_SHA_256, 32, 64  },
	{ "SHA384", PSA_ALG_SHA_384, 48, 128 },
	{ "SHA512", PSA_ALG_SHA_512, 64, 128 },
	{ "GHASH",  PSA_ALG_NONE,   16, 16  },
	{ NULL, 0, 0, 0 }
};

void xs_digest_destructor(void *data)
{
	Digest digest = data;
	if (digest && (PSA_ALG_NONE != digest->alg))
		psa_hash_abort(&digest->op.psa);
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

	DigestRecord init = {
		.alg = entry->alg,
		.outputSize = entry->outputSize,
		.blockSize = entry->blockSize,
	};

	if (PSA_ALG_NONE == entry->alg) { // GHASH
		if (!xsmcGet(xsVar(0), xsArg(0), xsID_H))
			xsUnknownError("H required");
		void *H;
		xsUnsignedValue HLen;
		xsmcGetBufferReadable(xsVar(0), &H, &HLen);
		if (16 != HLen)
			xsRangeError("H must be 16 bytes");
		c_memcpy(&init.op.ghash.h, H, 16);
		_ghash_fix128(&init.op.ghash.h);

		if (xsmcGet(xsVar(0), xsArg(0), xsID_additionalData)) {
			void *aad;
			xsUnsignedValue aadLen;
			xsmcGetBufferReadable(xsVar(0), &aad, &aadLen);
			_ghash_update(&init.op.ghash, aad, aadLen);
			_ghash_flush_partial(&init.op.ghash);
			init.op.ghash.y0 = init.op.ghash.y;
			init.op.ghash.aad_len = aadLen;
		}
		_ghash_create(&init.op.ghash);
	}
	else { // PSA
		psa_status_t status = psa_crypto_init();
		if (PSA_SUCCESS != status)
			xsUnknownError("psa_crypto_init failed %d", (int)status);

		status = psa_hash_setup(&init.op.psa, init.alg);
		if (PSA_SUCCESS != status) {
			if (PSA_ERROR_NOT_SUPPORTED == status)
				xsUnknownError("algorithm not enabled in build");
			xsUnknownError("psa_hash_setup failed %d", (int)status);
		}
	}

	xsmcSetHostChunk(xsThis, &init, sizeof(init));
}

void xs_digest_close(xsMachine *the)
{
	if (!xsGetHostChunkIf(xsThis))
		return;
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	if (PSA_ALG_NONE != digest->alg)
		psa_hash_abort(&digest->op.psa);
	xsmcSetHostData(xsThis, NULL);	// downgrade to data slot so subsequent calls throw SyntaxError
}

void xs_digest_write(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	void *data;
	xsUnsignedValue size;

	xsmcGetBufferReadable(xsArg(0), &data, &size);

	if (PSA_ALG_NONE == digest->alg)
		_ghash_update(&digest->op.ghash, data, size);
	else {
		psa_status_t status = psa_hash_update(&digest->op.psa, data, size);
		if (PSA_SUCCESS != status)
			xsUnknownError("psa_hash_update failed %d", (int)status);
	}
}

void xs_digest_read(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	uint8_t *out;

	if (xsmcArgc > 0) {
		xsUnsignedValue outLen;
		xsmcGetBufferWritable(xsArg(0), (void **)&out, &outLen);
		if (outLen < digest->outputSize)
			xsRangeError("buffer too small");
		xsmcSetInteger(xsResult, digest->outputSize);
	}
	else
		out = xsmcSetArrayBuffer(xsResult, NULL, digest->outputSize);

	digest = xsmcGetHostChunk(xsThis);

	if (PSA_ALG_NONE == digest->alg) {
		ghash_t clone = digest->op.ghash;
		_ghash_fin(&clone, out);
	}
	else {
		psa_hash_operation_t clone = PSA_HASH_OPERATION_INIT;
		psa_status_t status = psa_hash_clone(&digest->op.psa, &clone);
		if (PSA_SUCCESS != status)
			xsUnknownError("psa_hash_clone failed %d", (int)status);

		size_t actual = 0;
		status = psa_hash_finish(&clone, out, digest->outputSize, &actual);
		if (PSA_SUCCESS != status) {
			psa_hash_abort(&clone);
			xsUnknownError("psa_hash_finish failed %d", (int)status);
		}
	}
}

void xs_digest_reset(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);

	if (PSA_ALG_NONE == digest->alg)
		_ghash_create(&digest->op.ghash);	// resets y from y0, zeros len; H and AAD preserved
	else {
		psa_hash_abort(&digest->op.psa);

		psa_status_t status = psa_hash_setup(&digest->op.psa, digest->alg);
		if (PSA_SUCCESS != status)
			xsUnknownError("psa_hash_setup failed %d", (int)status);
	}
}

void xs_digest_get_blockSize(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	xsmcSetInteger(xsResult, digest->blockSize);
}

void xs_digest_get_outputSize(xsMachine *the)
{
	Digest digest = xsmcGetHostChunkValidate(xsThis, xs_digest_destructor);
	xsmcSetInteger(xsResult, digest->outputSize);
}
