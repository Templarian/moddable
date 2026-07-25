/*
 * Copyright (c) 2016-2026  Moddable Tech, Inc.
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


#include "xsPlatform.h"

#include "xsmc.h"
#include "mc.xs.h"			// for xsID_ values

void xs_parseBMF(xsMachine *the)
{
	unsigned char *bytes, *start, *end;
	uint32_t size;
	xsUnsignedValue byteLength;
	int charCount;

	xsmcGetBufferReadable(xsArg(0), (void **)&bytes, &byteLength);
	start = bytes;
	end = bytes + byteLength;

	if (byteLength < 9)
		xsUnknownError("invalid BMF");

	if ((0x42 != c_read8(bytes + 0)) || (0x4D != c_read8(bytes + 1)) || (0x46 != c_read8(bytes + 2)) || ((3 != c_read8(bytes + 3)) && (4 != c_read8(bytes + 3))))
		xsUnknownError("Invalid BMF header");
	bytes += 4;

	// skip block 1
	if (1 != c_read8(bytes))
		xsUnknownError("no info block");
	bytes += 1;

	size = c_read32(bytes);
	if (size > (uint32_t)((end - bytes) - 4))
		xsUnknownError("invalid BMF");
	bytes += 4 + size;

	// get lineHeight from block 2
	if (((end - bytes) < 5) || (2 != c_read8(bytes)))
		xsUnknownError("no common block");
	bytes += 1;

	size = c_read32(bytes);
	bytes += 4;
	if (((end - bytes) < 10) || (size < 8) || (size > (uint32_t)(end - bytes)))
		xsUnknownError("invalid BMF");

	xsmcSetInteger(xsResult, c_read16(bytes));
	xsmcDefine(xsArg(0), xsID_height, xsResult, xsDontDelete | xsDontSet);

	xsmcSetInteger(xsResult, c_read16(bytes + 2));
	xsmcDefine(xsArg(0), xsID_ascent, xsResult, xsDontDelete | xsDontSet);

	if (1 != c_read16(bytes + 8))	// pages
		xsUnknownError("not single page");

	bytes += size;

	// skip block 3
	if (((end - bytes) < 5) || (3 != c_read8(bytes)))
		xsUnknownError("no pages block");
	bytes += 1;

	size = c_read32(bytes);
	if (size > (uint32_t)((end - bytes) - 4))
		xsUnknownError("invalid BMF");
	bytes += 4 + size;

	// use block 4
	if (((end - bytes) < 5) || (4 != c_read8(bytes)))
		xsUnknownError("no chars block");
	bytes += 1;

	xsmcSetInteger(xsResult, bytes - start);
	xsmcDefine(xsArg(0), xsID_position, xsResult, xsDontDelete | xsDontSet);

	size = c_read32(bytes);
	if ((size % 20) || (size > (uint32_t)((end - bytes) - 4)))
		xsUnknownError("bad chars block size");
	charCount = size / 20;

	xsmcSetInteger(xsResult, charCount);
	xsmcDefine(xsArg(0), xsID_charCount, xsResult, xsDontDelete | xsDontSet);

	xsResult = xsArg(0);
}
