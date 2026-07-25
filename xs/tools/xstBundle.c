/*
 * Copyright (c) 2016-2026  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Tools.
 *
 *   The Moddable SDK Tools is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Tools is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with the Moddable SDK Tools.  If not, see <http://www.gnu.org/licenses/>.
 */
 
 /*
	N.B. Machine generated 
*/

/*
 * Fuzzilli-style bundle support.
 *
 * When Fuzzilli is run with --bundle, a single payload contains one or
 * more sections delimited by comment markers. Each section is one of:
 *
 *     // JS_BUNDLE_SCRIPT              -> classic script, runs immediately
 *     // JS_BUNDLE_MODULE:<name>       -> named module, loaded on demand
 *     // JS_BUNDLE_MODULE_ENTRYPOINT   -> anonymous module, runs immediately
 *
 * Scripts and the entry-point module can (dynamically or statically) import
 * from any named module in the same bundle. Modules are held in an in-memory
 * map; XS's normal loader (fxLoadModule in xst.c) is diverted here via
 * fxBundleLoad before it hits the filesystem.
 *
 * The same code path serves two callers:
 *   - xstFuzz.c, when a REPRL payload begins with a JS_BUNDLE_* marker;
 *   - xst.c, when the user passes --bundle on the command line (used for
 *     reproducing Fuzzilli-found crashes).
 */

#include "xsAll.h"
#include "xsScript.h"
#include "xs.h"

extern void fxRunLoop(txMachine* the);

#define kBundleMapCap (64)
#define kBundleEntryName "__entry__.mjs"
#define kBundleMarkerPrefix "// JS_BUNDLE_"
#define kBundleMarkerPrefixLen (13)

typedef struct {
	const char *name;
	const char *source;
	size_t sourceLen;
} txBundleEntry;

static txBundleEntry gBundleMap[kBundleMapCap];
static int gBundleMapCount = 0;

void fxBundleMapReset(void)
{
	gBundleMapCount = 0;
}

static void fxBundleMapPut(const char *name, const char *source, size_t sourceLen)
{
	if (gBundleMapCount >= kBundleMapCap)
		return;
	gBundleMap[gBundleMapCount].name = name;
	gBundleMap[gBundleMapCount].source = source;
	gBundleMap[gBundleMapCount].sourceLen = sourceLen;
	gBundleMapCount++;
}

static const txBundleEntry *fxBundleMapGet(const char *name)
{
	int i;
	for (i = 0; i < gBundleMapCount; i++) {
		if (0 == strcmp(gBundleMap[i].name, name))
			return &gBundleMap[i];
	}
	return NULL;
}

int fxBundleIs(const char *buffer, size_t size)
{
	return (size >= kBundleMarkerPrefixLen) &&
		(0 == memcmp(buffer, kBundleMarkerPrefix, kBundleMarkerPrefixLen));
}

// Find the next start-of-line marker at or after `from`. `bufStart` is the
// origin of the buffer, used to check "start of line" at position `from`.
static char *fxBundleNextMarker(char *from, char *end, char *bufStart)
{
	while (from < end) {
		int atLineStart = (from == bufStart) || (from > bufStart && from[-1] == '\n');
		if (atLineStart &&
		    (end - from) >= kBundleMarkerPrefixLen &&
		    0 == memcmp(from, kBundleMarkerPrefix, kBundleMarkerPrefixLen))
			return from;
		char *nl = memchr(from, '\n', end - from);
		if (!nl)
			return end;
		from = nl + 1;
	}
	return end;
}

// Called from xst.c's fxLoadModule. Returns 1 if the module ID was found in
// the bundle map (and resolved), 0 to fall through to filesystem loading.
// Non-bundle usage: the map is empty, so this returns 0 immediately.
int fxBundleLoad(txMachine *the, txSlot *module, txID moduleID)
{
	if (gBundleMapCount == 0)
		return 0;
	const char *name = fxGetKeyName(the, moduleID);
	if (!name)
		return 0;
	const txBundleEntry *entry = fxBundleMapGet(name);
	if (!entry)
		return 0;
	txStringCStream stream;
	stream.buffer = (char *)entry->source;
	stream.offset = 0;
	stream.size = entry->sourceLen;
#ifdef mxDebug
	txUnsigned flags = mxDebugFlag;
#else
	txUnsigned flags = 0;
#endif
	txScript *script = fxParseScript(the, &stream, fxStringCGetter, flags);
	if (script)
		fxResolveModule(the, module, moduleID, script, C_NULL, C_NULL);
	return 1;
}

void fxBundleRun(txMachine *the, char *buffer, size_t size)
{
	char *cursor = buffer;
	char *end = buffer + size;
	char *scripts[kBundleMapCap];
	size_t scriptLens[kBundleMapCap];
	int scriptCount = 0;
	const char *entrySource = NULL;
	size_t entrySourceLen = 0;

	fxBundleMapReset();

	while (cursor < end) {
		if ((end - cursor) < kBundleMarkerPrefixLen ||
		    0 != memcmp(cursor, kBundleMarkerPrefix, kBundleMarkerPrefixLen)) {
			// stray content; skip to next marker
			cursor = fxBundleNextMarker(cursor, end, buffer);
			continue;
		}
		char *markerBody = cursor + kBundleMarkerPrefixLen;
		char *lineEnd = memchr(cursor, '\n', end - cursor);
		if (!lineEnd)
			lineEnd = end;
		char *bodyStart = (lineEnd < end) ? lineEnd + 1 : end;
		char *bodyEnd = fxBundleNextMarker(bodyStart, end, buffer);
		size_t bodyLen = bodyEnd - bodyStart;

		size_t markerLen = lineEnd - markerBody;
		// strip trailing \r if present
		if (markerLen && markerBody[markerLen - 1] == '\r')
			markerLen--;

		if (markerLen == 6 && 0 == memcmp(markerBody, "SCRIPT", 6)) {
			if (scriptCount < kBundleMapCap) {
				scripts[scriptCount] = bodyStart;
				scriptLens[scriptCount] = bodyLen;
				scriptCount++;
			}
		}
		else if (markerLen == 17 && 0 == memcmp(markerBody, "MODULE_ENTRYPOINT", 17)) {
			entrySource = bodyStart;
			entrySourceLen = bodyLen;
		}
		else if (markerLen > 7 && 0 == memcmp(markerBody, "MODULE:", 7)) {
			// null-terminate the module name in-place (overwrites the \n or \r)
			markerBody[markerLen] = '\0';
			fxBundleMapPut(markerBody + 7, bodyStart, bodyLen);
		}
		// else: unknown marker, skip its body

		cursor = bodyEnd;
	}

	if (entrySource)
		fxBundleMapPut(kBundleEntryName, entrySource, entrySourceLen);

	txSlot *realm = mxProgram.value.reference->next->value.module.realm;

	// Run classic scripts in payload order.
	int i;
	for (i = 0; i < scriptCount; i++) {
		txStringCStream stream;
		stream.buffer = scripts[i];
		stream.offset = 0;
		stream.size = scriptLens[i];
		the->script = fxParseScript(the, &stream, fxStringCGetter, mxProgramFlag | mxDebugFlag);
		if (!the->script)
			continue;
		fxRunScript(the, the->script, mxRealmGlobal(realm), C_NULL, mxRealmClosures(realm)->value.reference, C_NULL, mxProgram.value.reference);
		the->script = NULL;
		mxPullSlot(mxResult);
	}

	// Run the entry-point module via dynamic import; XS pulls dependencies
	// through fxLoadModule -> fxBundleLoad on demand.
	if (entrySource) {
		mxPushStringC((txString)kBundleEntryName);
		mxPushUndefined();
		fxRunImport(the, realm, C_NULL);
		mxPop();
	}
}
