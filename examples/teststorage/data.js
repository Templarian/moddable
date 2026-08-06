// Entity/state storage library implementing the design in STORAGE.md and
// examples/teststorage/storageIdea.md: a PSRAM-cached hash-table index over
// a single LittleFS file, keyed by 8 hex character entity ids.
import { File } from "file";
import { CRC16 } from "crc";

class PreloadableMap {
	#state = {};

	constructor(...args) {
		if (Object.isFrozen(PreloadableMap))
			return new Map(...args);					// post-lockdown/preload – use Map instance directly
		this.#state.map = new Map(...args);
	}
	#getMap(mutable = false) {
		let map = this.#state.map;
		if (mutable && Object.isFrozen(map))
			map = this.#state.map = new Map(map);		// clone to RAM
		return map;
	}
	set(key, value) {
		this.#getMap(true).set(key, value);
		return this;
	}
	get(key) {
		return this.#getMap().get(key);
	}
	has(key) {
		return this.#getMap().has(key);
	}
	delete(key) {
		return this.#getMap(true).delete(key);
	}
	clear() {
		return this.#getMap(true).clear();
	}
	keys() {
		return this.#getMap().keys();
	}
	values() {
		return this.#getMap().values();
	}
	entries() {
		return this.#getMap().entries();
	}
	[Symbol.iterator]() {
		return this.#getMap()[Symbol.iterator]();
	}
	get size() {
		return this.#getMap().size;
	}
}

export const STORE_DIR = "/store";
export const STORE_PATH = "/mod/data.bin";
export const STATE_PATH = "/mod/state.bin";
export const HEADER_SIZE = 8; // uint32 entryCount + uint32 tableSize
export const SLOT_SIZE = 12; // id(4) + offset(4) + length(2) + crc16(2)
export const DEFAULT_LOAD_FACTOR = 0.6;
const EMPTY_ID = 0xFFFFFFFF; // erased-flash sentinel
// ---------- Canonical JSON + CRC16 (must match the server exactly) ----------
export function canonicalStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return "[" + value.map(canonicalStringify).join(",") + "]";
    }
    const keys = Object.keys(value).sort();
    const pairs = keys.map(key => JSON.stringify(key) + ":" + canonicalStringify(value[key]));
    return "{" + pairs.join(",") + "}";
}
const CRC16_TABLE = (() => {
    const table = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
        table[i] = crc;
    }
    return table;
})();
// CRC-16/XMODEM, matching the Moddable SDK's crc module (new CRC16(0x1021)).
export function crc16(text) {
    let crc = 0x0000;
    for (let i = 0; i < text.length; i++) {
        const byte = text.charCodeAt(i) & 0xFF;
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xFF]) & 0xFFFF;
    }
    return crc;
}
// ---------- id <-> number ----------
export function idToNumber(id) {
    return parseInt(id, 16) >>> 0;
}
export function idToHex(id) {
    return (id >>> 0).toString(16).padStart(8, "0");
}
// Smallest table size that keeps the load factor at or below the target,
// so probe chains stay short. Must be >=1 — id % 0 is invalid.
export function nextTableSize(entryCount, loadFactor = DEFAULT_LOAD_FACTOR) {
    return Math.max(1, Math.ceil(entryCount / loadFactor));
}
// ---------- module state (PSRAM-resident index) ----------
let indexBuffer = null;
let indexView = null;
let tableSize = 0;
let entryCount = 0;
export function storeExists() {
    return File.exists(STORE_PATH);
}
function requireIndex() {
    ensureIndex();
    return indexView;
}
// Loads the header + index region into PSRAM. Cheap to call repeatedly —
// only reads from flash the first time.
export function ensureIndex() {
    if (indexView)
        return;
    if (!File.exists(STORE_PATH)) {
        throw new Error(`store not initialized — call initStore() first (${STORE_PATH} does not exist)`);
    }
    const file = new File(STORE_PATH);
    const header = file.read(ArrayBuffer, HEADER_SIZE);
    const headerView = new DataView(header);
    entryCount = headerView.getUint32(0, false);
    tableSize = headerView.getUint32(4, false);
    indexBuffer = file.read(ArrayBuffer, tableSize * SLOT_SIZE);
    indexView = new DataView(indexBuffer);
    file.close();
}
export function getStats() {
    ensureIndex();
    return { entryCount, tableSize, loadFactor: entryCount / tableSize };
}
// Finds this id's slot: an existing match, or the first empty slot on its
// probe chain. Throws if the table has no room left — call compact() with
// a larger expectedEntityCount.
function findSlot(view, size, id) {
    let slot = id % size;
    for (let probes = 0; probes < size; probes++) {
        const pos = slot * SLOT_SIZE;
        const slotId = view.getUint32(pos, false);
        if (slotId === EMPTY_ID || slotId === id)
            return slot;
        slot = (slot + 1) % size;
    }
    throw new Error("hash table full — call compact() with a larger expectedEntityCount");
}
export function lookupEntity(id) {
    const view = requireIndex();
    let slot = id % tableSize;
    for (let probes = 0; probes < tableSize; probes++) {
        const pos = slot * SLOT_SIZE;
        const slotId = view.getUint32(pos, false);
        if (slotId === EMPTY_ID)
            return null;
        if (slotId === id) {
            return {
                offset: view.getUint32(pos + 4, false),
                length: view.getUint16(pos + 8, false),
                hash: view.getUint16(pos + 10, false)
            };
        }
        slot = (slot + 1) % tableSize;
    }
    return null;
}
// ---------- entity read/write ----------
export function getEntity(id) {
    const result = lookupEntity(idToNumber(id));
    if (!result)
        return null;
    const file = new File(STORE_PATH);
    file.position = result.offset;
    const text = file.read(String, result.length);
    file.close();
    return JSON.parse(text);
}
// Compares the stored payload against its stored crc16 — a corruption/
// tampering check, not something needed on the normal read path.
export function verifyEntity(id) {
    const result = lookupEntity(idToNumber(id));
    if (!result)
        return false;
    const file = new File(STORE_PATH);
    file.position = result.offset;
    const text = file.read(String, result.length);
    file.close();
    return crc16(text) === result.hash;
}
// Writes one entity: appends its payload to the end of the file, then
// overwrites its 12-byte index slot in place — no other slot or payload
// bytes are touched. `hash` should normally be the server's "hash" property
// for this entity (GET /key/<hex>) — the device shouldn't need to recompute
// what the server already sent. If omitted (e.g. locally-authored test
// data with no server round trip), it's computed on-device with the
// Moddable SDK's built-in CRC16(0x1021) — the same CRC-16/XMODEM variant
// the server uses, just the native implementation instead of the plain-JS
// crc16() above.
//
// Updating an existing id reuses its slot but leaves the old payload bytes
// behind in the data region — call compact() periodically to reclaim them.
export function putEntity(id, data, hash) {
    const view = requireIndex();
    const numId = idToNumber(id);
    const slot = findSlot(view, tableSize, numId);
    const pos = slot * SLOT_SIZE;
    const isNew = view.getUint32(pos, false) === EMPTY_ID;
    const text = canonicalStringify(data);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++)
        bytes[i] = text.charCodeAt(i);
    const resolvedHash = hash !== null && hash !== void 0 ? hash : new CRC16(0x1021).checksum(bytes);
    const file = new File(STORE_PATH, true);
    const offset = file.length;
    file.position = offset;
    file.write(bytes.buffer);
    const slotBuf = new ArrayBuffer(SLOT_SIZE);
    const slotView = new DataView(slotBuf);
    slotView.setUint32(0, numId, false);
    slotView.setUint32(4, offset, false);
    slotView.setUint16(8, bytes.length, false);
    slotView.setUint16(10, resolvedHash, false);
    file.position = HEADER_SIZE + pos;
    file.write(slotBuf);
    if (isNew) {
        entryCount++;
        const countBuf = new ArrayBuffer(4);
        new DataView(countBuf).setUint32(0, entryCount, false);
        file.position = 0;
        file.write(countBuf);
    }
    file.close();
    // mirror the same write into the PSRAM cache
    view.setUint32(pos, numId, false);
    view.setUint32(pos + 4, offset, false);
    view.setUint16(pos + 8, bytes.length, false);
    view.setUint16(pos + 10, resolvedHash, false);
}
function writeStore(records, expectedCount = records.length, loadFactor = DEFAULT_LOAD_FACTOR) {
    const newTableSize = nextTableSize(Math.max(expectedCount, records.length), loadFactor);
    const indexSize = newTableSize * SLOT_SIZE;
    const dataStart = HEADER_SIZE + indexSize;
    let totalSize = dataStart;
    for (const r of records)
        totalSize += r.text.length;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    view.setUint32(0, records.length, false);
    view.setUint32(4, newTableSize, false);
    bytes.fill(0xFF, HEADER_SIZE, dataStart);
    let dataPos = dataStart;
    for (const r of records) {
        let slot = r.id % newTableSize;
        while (view.getUint32(HEADER_SIZE + slot * SLOT_SIZE, false) !== EMPTY_ID) {
            slot = (slot + 1) % newTableSize;
        }
        const pos = HEADER_SIZE + slot * SLOT_SIZE;
        view.setUint32(pos, r.id, false);
        view.setUint32(pos + 4, dataPos, false);
        view.setUint16(pos + 8, r.text.length, false);
        view.setUint16(pos + 10, r.hash, false);
        for (let i = 0; i < r.text.length; i++)
            bytes[dataPos + i] = r.text.charCodeAt(i);
        dataPos += r.text.length;
    }
    //Directory.create(STORE_DIR);
    if (File.exists(STORE_PATH))
        File.delete(STORE_PATH);
    const file = new File(STORE_PATH, true);
    file.write(buf);
    file.close();
    tableSize = newTableSize;
    entryCount = records.length;
    indexBuffer = buf.slice(HEADER_SIZE, dataStart);
    indexView = new DataView(indexBuffer);
}
// Creates a fresh, empty store sized for expectedEntityCount with headroom.
// Overwrites any existing store at STORE_PATH.
export function initStore(expectedEntityCount, loadFactor = DEFAULT_LOAD_FACTOR) {
    writeStore([], expectedEntityCount, loadFactor);
}
// Builds the store from scratch from a full batch of entries — e.g. an
// initial bulk sync from the server. Discards whatever was there before.
export function buildStore(entries, loadFactor = DEFAULT_LOAD_FACTOR) {
    const records = entries.map(e => ({
        id: idToNumber(e.id),
        hash: e.hash,
        text: canonicalStringify(e.data)
    }));
    writeStore(records, records.length, loadFactor);
}
// Rebuilds the store from its currently live entries, reclaiming payload
// bytes orphaned by putEntity() overwrites. Pass expectedEntityCount to
// grow the table's headroom for future growth; otherwise it's resized to
// the current live entry count.
export function compact(expectedEntityCount, loadFactor = DEFAULT_LOAD_FACTOR) {
    const view = requireIndex();
    const file = new File(STORE_PATH);
    const records = [];
    for (let slot = 0; slot < tableSize; slot++) {
        const pos = slot * SLOT_SIZE;
        const id = view.getUint32(pos, false);
        if (id === EMPTY_ID)
            continue;
        const offset = view.getUint32(pos + 4, false);
        const length = view.getUint16(pos + 8, false);
        const hash = view.getUint16(pos + 10, false);
        file.position = offset;
        const text = file.read(String, length);
        records.push({ id, hash, text });
    }
    file.close();
    writeStore(records, expectedEntityCount !== null && expectedEntityCount !== void 0 ? expectedEntityCount : records.length, loadFactor);
}
// ---------- state name -> entity id ----------
//
// Same problem as the entity store, at the same scale ("thousands of state
// values over time") — can't load it all into memory, and a linear scan of
// an append-only name log costs more flash reads the more names accumulate.
// So it gets the same hash-table treatment: /store/state.bin is
// HEADER | INDEX (hash table) | DATA (append-only [len][name][id] records).
//
// Unlike entity ids, a name's hash is not already a unique key — two
// different names can hash to the same value — so a slot hit has to read
// its record back and confirm the name actually matches before trusting
// the id. Resolved names are cached in memory so that check only happens
// once per name per session.
export const STATE_HEADER_SIZE = 8; // uint32 entryCount + uint32 tableSize
export const STATE_SLOT_SIZE = 10; // hash(4) + offset(4) + length(2)
const EMPTY_HASH = 0xFFFFFFFF; // erased-flash sentinel
// FNV-1a 32-bit — simple, fast, good enough distribution for this table size.
function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i) & 0xFF;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}
// [nameLength(1 byte)][name][id (8 hex characters)] — a fixed length once a
// name is known, so updating an existing name's id never changes the
// record's size (see setStateId).
function encodeStateRecord(name, id) {
    if (name.length > 255)
        throw new Error("state name must be 255 characters or fewer");
    return String.fromCharCode(name.length) + name + id;
}
function decodeStateRecordName(record) {
    return record.slice(1, 1 + record.charCodeAt(0));
}
function decodeStateRecordId(record) {
    const len = record.charCodeAt(0);
    return record.slice(1 + len, 1 + len + 8);
}
let stateIndexBuffer = null;
let stateIndexView = null;
let stateTableSize = 0;
let stateEntryCount = 0;
const stateCache = new PreloadableMap();
export function stateStoreExists() {
    return File.exists(STATE_PATH);
}
// Loads the header + index region into PSRAM. Cheap to call repeatedly —
// only reads from flash the first time.
export function ensureStateIndex() {
    if (stateIndexView)
        return;
    if (!File.exists(STATE_PATH)) {
        throw new Error(`state store not initialized — call initStateStore() first (${STATE_PATH} does not exist)`);
    }
    const file = new File(STATE_PATH);
    const header = file.read(ArrayBuffer, STATE_HEADER_SIZE);
    const headerView = new DataView(header);
    stateEntryCount = headerView.getUint32(0, false);
    stateTableSize = headerView.getUint32(4, false);
    stateIndexBuffer = file.read(ArrayBuffer, stateTableSize * STATE_SLOT_SIZE);
    stateIndexView = new DataView(stateIndexBuffer);
    file.close();
}
export function getStateStats() {
    ensureStateIndex();
    return { entryCount: stateEntryCount, tableSize: stateTableSize, loadFactor: stateEntryCount / stateTableSize };
}
export function getStateId(name) {
    const cached = stateCache.get(name);
    if (cached !== undefined)
        return cached;
    ensureStateIndex();
    const view = stateIndexView;
    const hash = fnv1a(name);
    const file = new File(STATE_PATH);
    let slot = hash % stateTableSize;
    for (let probes = 0; probes < stateTableSize; probes++) {
        const pos = slot * STATE_SLOT_SIZE;
        const slotHash = view.getUint32(pos, false);
        if (slotHash === EMPTY_HASH) {
            file.close();
            return null;
        }
        if (slotHash === hash) {
            const offset = view.getUint32(pos + 4, false);
            const length = view.getUint16(pos + 8, false);
            file.position = offset;
            const record = file.read(String, length);
            if (decodeStateRecordName(record) === name) {
                file.close();
                const id = decodeStateRecordId(record);
                stateCache.set(name, id);
                return id;
            }
            // hash collision between two different names — keep probing
        }
        slot = (slot + 1) % stateTableSize;
    }
    file.close();
    return null;
}
// Finds the slot for `name`: an existing record with a matching name, or
// the first empty slot on its probe chain for a new one. Reads flash to
// verify hash matches on the way, same as getStateId.
function findStateSlot(file, view, size, hash, name) {
    let slot = hash % size;
    for (let probes = 0; probes < size; probes++) {
        const pos = slot * STATE_SLOT_SIZE;
        const slotHash = view.getUint32(pos, false);
        if (slotHash === EMPTY_HASH)
            return { slot, isNew: true };
        if (slotHash === hash) {
            const offset = view.getUint32(pos + 4, false);
            const length = view.getUint16(pos + 8, false);
            file.position = offset;
            const record = file.read(String, length);
            if (decodeStateRecordName(record) === name)
                return { slot, isNew: false };
        }
        slot = (slot + 1) % size;
    }
    throw new Error("state hash table full — call compactStateStore() with a larger expectedNameCount");
}
// Points a state name at an entity id. Updating an existing name overwrites
// just its 8 id bytes in place (the record's length can't change once the
// name is fixed) — no orphaned bytes, no compaction needed for updates.
export function setStateId(name, id) {
    ensureStateIndex();
    const view = stateIndexView;
    const hash = fnv1a(name);
    const file = new File(STATE_PATH, true);
    const match = findStateSlot(file, view, stateTableSize, hash, name);
    const slotPos = match.slot * STATE_SLOT_SIZE;
    if (!match.isNew) {
        const offset = view.getUint32(slotPos + 4, false);
        file.position = offset + 1 + name.length;
        file.write(id);
    }
    else {
        const record = encodeStateRecord(name, id);
        const offset = file.length;
        file.position = offset;
        file.write(record);
        const slotBuf = new ArrayBuffer(STATE_SLOT_SIZE);
        const slotView = new DataView(slotBuf);
        slotView.setUint32(0, hash, false);
        slotView.setUint32(4, offset, false);
        slotView.setUint16(8, record.length, false);
        file.position = STATE_HEADER_SIZE + slotPos;
        file.write(slotBuf);
        stateEntryCount++;
        const countBuf = new ArrayBuffer(4);
        new DataView(countBuf).setUint32(0, stateEntryCount, false);
        file.position = 0;
        file.write(countBuf);
        view.setUint32(slotPos, hash, false);
        view.setUint32(slotPos + 4, offset, false);
        view.setUint16(slotPos + 8, record.length, false);
    }
    file.close();
    stateCache.set(name, id);
}
// Resolves a state name (e.g. "player.health") straight to its entity.
export function getState(name) {
    const id = getStateId(name);
    return id ? getEntity(id) : null;
}
function writeStateStore(entries, expectedCount = entries.length, loadFactor = DEFAULT_LOAD_FACTOR) {
    const newTableSize = nextTableSize(Math.max(expectedCount, entries.length), loadFactor);
    const indexSize = newTableSize * STATE_SLOT_SIZE;
    const dataStart = STATE_HEADER_SIZE + indexSize;
    const records = entries.map(e => ({ hash: fnv1a(e.name), text: encodeStateRecord(e.name, e.id) }));
    let totalSize = dataStart;
    for (const r of records)
        totalSize += r.text.length;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    view.setUint32(0, records.length, false);
    view.setUint32(4, newTableSize, false);
    bytes.fill(0xFF, STATE_HEADER_SIZE, dataStart);
    let dataPos = dataStart;
    for (const r of records) {
        let slot = r.hash % newTableSize;
        while (view.getUint32(STATE_HEADER_SIZE + slot * STATE_SLOT_SIZE, false) !== EMPTY_HASH) {
            slot = (slot + 1) % newTableSize;
        }
        const pos = STATE_HEADER_SIZE + slot * STATE_SLOT_SIZE;
        view.setUint32(pos, r.hash, false);
        view.setUint32(pos + 4, dataPos, false);
        view.setUint16(pos + 8, r.text.length, false);
        for (let i = 0; i < r.text.length; i++)
            bytes[dataPos + i] = r.text.charCodeAt(i);
        dataPos += r.text.length;
    }
    //Directory.create(STORE_DIR);
    if (File.exists(STATE_PATH))
        File.delete(STATE_PATH);
    const file = new File(STATE_PATH, true);
    file.write(buf);
    file.close();
    stateTableSize = newTableSize;
    stateEntryCount = records.length;
    stateIndexBuffer = buf.slice(STATE_HEADER_SIZE, dataStart);
    stateIndexView = new DataView(stateIndexBuffer);
    stateCache.clear();
}
// Creates a fresh, empty state store sized for expectedNameCount with
// headroom. Overwrites any existing state store at STATE_PATH.
export function initStateStore(expectedNameCount, loadFactor = DEFAULT_LOAD_FACTOR) {
    writeStateStore([], expectedNameCount, loadFactor);
}
// Rebuilds the state store from its currently live entries. Updates never
// orphan bytes (see setStateId), so the only reason to call this is to grow
// the table's headroom via expectedNameCount once it's gotten too full.
export function compactStateStore(expectedNameCount, loadFactor = DEFAULT_LOAD_FACTOR) {
    const view = requireStateIndex();
    const file = new File(STATE_PATH);
    const records = [];
    for (let slot = 0; slot < stateTableSize; slot++) {
        const pos = slot * STATE_SLOT_SIZE;
        const hash = view.getUint32(pos, false);
        if (hash === EMPTY_HASH)
            continue;
        const offset = view.getUint32(pos + 4, false);
        const length = view.getUint16(pos + 8, false);
        file.position = offset;
        const record = file.read(String, length);
        records.push({ name: decodeStateRecordName(record), id: decodeStateRecordId(record) });
    }
    file.close();
    writeStateStore(records, expectedNameCount !== null && expectedNameCount !== void 0 ? expectedNameCount : records.length, loadFactor);
}
function requireStateIndex() {
    ensureStateIndex();
    return stateIndexView;
}
