import { File } from "file";
import { CRC16 } from "crc";

export const STORE_PATH = "/mod/data.bin";

const KEY_LENGTH = 8;
const META_LENGTH = 4; // crc16(2) + value length(2)
const HEADER_LENGTH = KEY_LENGTH + META_LENGTH; // on-disk record header
const DELETED_LENGTH = 0xFFFF; // sentinel marking a tombstone record (no payload)
const MAX_VALUE_LENGTH = 0xFFFE; // length field is a uint16, minus the tombstone sentinel

// Resident index: one fixed-size slot per retained key, packed into a
// single ArrayBuffer instead of a Map of per-key objects, so its RAM
// cost is exactly maxKeys * SLOT_SIZE and never grows with GC/object
// overhead. `prev`/`next` thread two different lists through the same
// fields depending on whether a slot is occupied: a doubly-linked LRU
// list for occupied slots (head = most recently used), or a singly-
// linked free list for unoccupied ones (via `next` only). A slot is
// always in exactly one of the two, never both.
const SLOT_KEY = 0;
const SLOT_OFFSET = 8;
const SLOT_LENGTH = 12;
const SLOT_CRC = 14;
const SLOT_PREV = 16;
const SLOT_NEXT = 18;
const SLOT_SIZE = 20;
const NONE = 0xFFFF; // sentinel: no slot / end of a list

function stringToBytes(text) {
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++)
		bytes[i] = text.charCodeAt(i) & 0xFF;
	return bytes;
}

function bytesToString(bytes) {
	const chars = new Array(bytes.length);
	for (let i = 0; i < bytes.length; i++)
		chars[i] = String.fromCharCode(bytes[i]);
	return chars.join("");
}

// Values are stored and returned as byte strings (one char per byte, e.g.
// JSON text) -- non-ASCII JS strings would disagree with the byte length
// written to disk and are not supported.
export class Storage {
	#path;
	#crc = new CRC16(0x1021);

	#capacity;
	#indexBuffer;
	#indexView;
	#indexBytes;
	#head = NONE; // most recently used occupied slot
	#tail = NONE; // least recently used occupied slot
	#freeHead = NONE; // first free slot

	// Bounded LRU cache of decoded values, keyed by the same strings as
	// the index. Storing the owning slot alongside the value lets a cache
	// hit refresh that slot's LRU position in O(1) instead of walking the
	// index again.
	#cache = new Map(); // key -> { value, slot }
	#cacheLength = 0;
	#maxTotalLength;

	// maxKeys bounds how many distinct keys the store retains at all --
	// once it's full, set() purges the least recently used key from disk
	// (via a tombstone) to make room, not just from memory. maxTotalLength
	// is a separate, independent budget: how many bytes of decoded values
	// to keep cached, regardless of key count.
	constructor(maxTotalLength, maxKeys = 5000, path = STORE_PATH) {
		if (maxKeys < 1 || maxKeys > 0xFFFE)
			throw new RangeError("maxKeys must be between 1 and 65534");

		this.#maxTotalLength = maxTotalLength;
		this.#path = path;
		this.#capacity = maxKeys;

		this.#indexBuffer = new ArrayBuffer(maxKeys * SLOT_SIZE);
		this.#indexView = new DataView(this.#indexBuffer);
		this.#indexBytes = new Uint8Array(this.#indexBuffer);
		this.#resetIndex();
		this.#loadIndex();

		trace(`Storage: resident index ~${maxKeys * SLOT_SIZE} bytes for up to ${maxKeys} keys (${SLOT_SIZE} bytes/key); value cache capped at ${maxTotalLength} bytes\n`);
	}

	// Chains every slot onto the free list (0 -> 1 -> ... -> maxKeys-1 ->
	// NONE) and clears the LRU list. Used by the constructor and erase().
	#resetIndex() {
		for (let i = 0; i < this.#capacity; i++)
			this.#indexView.setUint16(i * SLOT_SIZE + SLOT_NEXT, (i + 1 < this.#capacity) ? (i + 1) : NONE, false);
		this.#freeHead = (this.#capacity > 0) ? 0 : NONE;
		this.#head = NONE;
		this.#tail = NONE;
	}

	// Calls visit(key, offset, length, crc) for every record in data.bin,
	// in file order. Used by #loadIndex() at startup and by debug().
	#eachRecord(visit) {
		if (!File.exists(this.#path))
			return;

		const file = new File(this.#path);
		const fileLength = file.length;
		let offset = 0;

		while (offset < fileLength) {
			file.position = offset;
			const header = new Uint8Array(file.read(ArrayBuffer, HEADER_LENGTH));
			const key = bytesToString(header.subarray(0, KEY_LENGTH));
			const crc = (header[KEY_LENGTH] << 8) | header[KEY_LENGTH + 1];
			const length = (header[KEY_LENGTH + 2] << 8) | header[KEY_LENGTH + 3];
			const payloadLength = (length === DELETED_LENGTH) ? 0 : length;

			visit(key, offset, length, crc);
			offset += HEADER_LENGTH + payloadLength;
		}

		file.close();
	}

	// Rebuilds the resident index from data.bin, in file order. A
	// tombstone removes its key from the index; otherwise the key's slot
	// is (re)written and moved to the front of the LRU list, so by the
	// end of the scan the most-recently-written keys are the most-
	// recently-used ones -- the best approximation of real access history
	// available on a cold start. If data.bin holds more distinct live
	// keys than maxKeys allows, this evicts the oldest ones in memory but
	// deliberately does not tombstone them on disk here (that would mean
	// opening a second, writable handle to the same file while this scan
	// still has its own read handle open) -- their space is reclaimed
	// the next time compact() runs.
	#loadIndex() {
		this.#eachRecord((key, offset, length, crc) => {
			if (length === DELETED_LENGTH)
				this.#indexRemove(key);
			else
				this.#indexPut(key, offset, length, crc);
		});
	}

	// Walks the LRU list looking for `key`. O(current key count), but
	// purely in-memory -- no disk I/O -- unlike the disk scan this
	// replaces.
	#findSlot(key) {
		let slot = this.#head;
		while (slot !== NONE) {
			if (this.#slotKey(slot) === key)
				return slot;
			slot = this.#indexView.getUint16(slot * SLOT_SIZE + SLOT_NEXT, false);
		}
		return NONE;
	}

	#slotKey(slot) {
		const base = slot * SLOT_SIZE + SLOT_KEY;
		return bytesToString(this.#indexBytes.subarray(base, base + KEY_LENGTH));
	}

	#setSlotKey(slot, key) {
		const base = slot * SLOT_SIZE + SLOT_KEY;
		for (let i = 0; i < KEY_LENGTH; i++)
			this.#indexBytes[base + i] = key.charCodeAt(i) & 0xFF;
	}

	#writeSlot(slot, key, offset, length, crc) {
		const base = slot * SLOT_SIZE;
		this.#setSlotKey(slot, key);
		this.#indexView.setUint32(base + SLOT_OFFSET, offset, false);
		this.#indexView.setUint16(base + SLOT_LENGTH, length, false);
		this.#indexView.setUint16(base + SLOT_CRC, crc, false);
	}

	#unlinkLRU(slot) {
		const base = slot * SLOT_SIZE;
		const prev = this.#indexView.getUint16(base + SLOT_PREV, false);
		const next = this.#indexView.getUint16(base + SLOT_NEXT, false);

		if (prev !== NONE)
			this.#indexView.setUint16(prev * SLOT_SIZE + SLOT_NEXT, next, false);
		else
			this.#head = next;

		if (next !== NONE)
			this.#indexView.setUint16(next * SLOT_SIZE + SLOT_PREV, prev, false);
		else
			this.#tail = prev;
	}

	#linkLRUHead(slot) {
		const base = slot * SLOT_SIZE;
		this.#indexView.setUint16(base + SLOT_PREV, NONE, false);
		this.#indexView.setUint16(base + SLOT_NEXT, this.#head, false);

		if (this.#head !== NONE)
			this.#indexView.setUint16(this.#head * SLOT_SIZE + SLOT_PREV, slot, false);
		this.#head = slot;

		if (this.#tail === NONE)
			this.#tail = slot;
	}

	// Moves an already-occupied slot to the front of the LRU list.
	#touch(slot) {
		if (this.#head === slot)
			return;
		this.#unlinkLRU(slot);
		this.#linkLRUHead(slot);
	}

	#allocSlot() {
		const slot = this.#freeHead;
		this.#freeHead = this.#indexView.getUint16(slot * SLOT_SIZE + SLOT_NEXT, false);
		return slot;
	}

	#freeSlot(slot) {
		this.#indexView.setUint16(slot * SLOT_SIZE + SLOT_NEXT, this.#freeHead, false);
		this.#freeHead = slot;
	}

	// Drops the least recently used occupied slot and returns its key, so
	// the caller can tombstone it on disk (or not, during #loadIndex()).
	#evictLRU() {
		const slot = this.#tail;
		const key = this.#slotKey(slot);
		this.#unlinkLRU(slot);
		this.#freeSlot(slot);
		return key;
	}

	#indexRemove(key) {
		const slot = this.#findSlot(key);
		if (slot === NONE)
			return;
		this.#unlinkLRU(slot);
		this.#freeSlot(slot);
	}

	// Inserts or updates key's slot, evicting the least-recently-used
	// occupied slot first if the index is already at capacity. Returns
	// { slot, evicted } -- evicted is the key that was dropped to make
	// room, or undefined if none was needed. Purely an in-memory
	// operation; callers decide whether/when to tombstone `evicted` on
	// disk.
	#indexPut(key, offset, length, crc, slot = this.#findSlot(key)) {
		let evicted;
		const isNew = (slot === NONE);
		if (isNew) {
			if (this.#freeHead === NONE) {
				evicted = this.#evictLRU();
				this.#cacheDelete(evicted);
			}
			slot = this.#allocSlot();
		}
		this.#writeSlot(slot, key, offset, length, crc);
		// A freshly allocated slot was never linked into the LRU list, so
		// its prev/next bytes are stale leftovers (from a previous
		// occupant, or the free list) -- linking it fresh avoids #touch()
		// misreading them as real pointers via #unlinkLRU(). An existing
		// slot, by contrast, is already correctly linked and just needs
		// to move to the front.
		if (isNew)
			this.#linkLRUHead(slot);
		else
			this.#touch(slot);
		return { slot, evicted };
	}

	#writeTombstone(key) {
		const meta = new ArrayBuffer(META_LENGTH);
		const metaView = new DataView(meta);
		metaView.setUint16(0, 0, false); // crc unused for tombstones
		metaView.setUint16(2, DELETED_LENGTH, false);

		const file = new File(this.#path, true);
		file.position = file.length;
		file.write(key, meta);
		file.close();
	}

	has(key) {
		return this.#cache.has(key) || (this.#findSlot(key) !== NONE);
	}

	get(key) {
		const cached = this.#cache.get(key);
		if (cached !== undefined) {
			this.#cache.delete(key);
			this.#cache.set(key, cached); // move to the end = most recently used
			this.#touch(cached.slot);
			return cached.value;
		}

		const slot = this.#findSlot(key);
		if (slot === NONE)
			return undefined;

		this.#touch(slot);

		const base = slot * SLOT_SIZE;
		const offset = this.#indexView.getUint32(base + SLOT_OFFSET, false);
		const length = this.#indexView.getUint16(base + SLOT_LENGTH, false);
		const crc = this.#indexView.getUint16(base + SLOT_CRC, false);

		const file = new File(this.#path);
		file.position = offset + HEADER_LENGTH;
		const bytes = new Uint8Array(file.read(ArrayBuffer, length));
		file.close();

		this.#crc.reset();
		if (this.#crc.checksum(bytes.buffer) !== crc)
			throw new Error(`data.bin: corrupt value for key "${key}"`);

		const value = bytesToString(bytes);
		this.#cacheSet(key, value, slot);
		return value;
	}

	set(key, value) {
		if (key.length !== KEY_LENGTH)
			throw new RangeError(`key must be exactly ${KEY_LENGTH} characters`);
		if (typeof value !== "string")
			throw new TypeError("value must be a string");

		const bytes = stringToBytes(value);
		if (bytes.length > MAX_VALUE_LENGTH)
			throw new RangeError(`value exceeds maximum length of ${MAX_VALUE_LENGTH} bytes`);

		this.#crc.reset();
		const crc = this.#crc.checksum(bytes.buffer);

		const existingSlot = this.#findSlot(key);
		const file = new File(this.#path, true);

		// Same length overwrites the existing record in place. Any other
		// length (grow or shrink) appends a fresh record instead, since a
		// shrink would otherwise leave stale trailing bytes with nothing
		// recording where the record actually ends. The old record, if
		// any, is left as dead space for compact() to reclaim.
		let offset;
		if (existingSlot !== NONE) {
			const base = existingSlot * SLOT_SIZE;
			const existingLength = this.#indexView.getUint16(base + SLOT_LENGTH, false);
			const existingOffset = this.#indexView.getUint32(base + SLOT_OFFSET, false);
			offset = (existingLength === bytes.length) ? existingOffset : file.length;
		} else {
			offset = file.length;
		}

		const meta = new ArrayBuffer(META_LENGTH);
		const metaView = new DataView(meta);
		metaView.setUint16(0, crc, false);
		metaView.setUint16(2, bytes.length, false);

		file.position = offset;
		file.write(key, meta, bytes.buffer);
		file.close();

		const { slot, evicted } = this.#indexPut(key, offset, bytes.length, crc, existingSlot);
		if (evicted !== undefined)
			this.#writeTombstone(evicted);

		this.#cacheSet(key, value, slot);
	}

	// Removes `key` from the index and cache, and appends a tombstone
	// record to data.bin, so it reads back as undefined even though its
	// old record is still physically present -- compact() is what
	// actually reclaims that space.
	delete(key) {
		if (key.length !== KEY_LENGTH)
			throw new RangeError(`key must be exactly ${KEY_LENGTH} characters`);

		this.#cacheDelete(key);

		const slot = this.#findSlot(key);
		if (slot === NONE)
			return;

		this.#unlinkLRU(slot);
		this.#freeSlot(slot);

		this.#writeTombstone(key);
	}

	#cacheDelete(key) {
		const entry = this.#cache.get(key);
		if (entry !== undefined) {
			this.#cacheLength -= entry.value.length;
			this.#cache.delete(key);
		}
	}

	#cacheSet(key, value, slot) {
		this.#cacheDelete(key);
		this.#cache.set(key, { value, slot });
		this.#cacheLength += value.length;
		this.#evictIfNeeded();
	}

	#evictIfNeeded() {
		while (this.#cacheLength > this.#maxTotalLength && this.#cache.size > 0) {
			const oldestKey = this.#cache.keys().next().value; // O(1), front = least recently used
			const oldestEntry = this.#cache.get(oldestKey);
			this.#cacheLength -= oldestEntry.value.length;
			this.#cache.delete(oldestKey);
		}
	}

	// Rewrites data.bin with only what the resident index says is live
	// (in on-disk order, for sequential reads), reclaiming space left
	// behind by set()'s appends, delete()'s and set()'s tombstones, and
	// any keys #loadIndex() evicted at startup without tombstoning. The
	// index is the source of truth for what's live, so this doesn't need
	// to re-derive it from disk the way it used to -- it just fixes up
	// each surviving slot's offset to match the rewritten file.
	compact() {
		if (!File.exists(this.#path))
			return;

		const slots = [];
		let slot = this.#head;
		while (slot !== NONE) {
			const base = slot * SLOT_SIZE;
			slots.push({ slot, offset: this.#indexView.getUint32(base + SLOT_OFFSET, false) });
			slot = this.#indexView.getUint16(base + SLOT_NEXT, false);
		}
		slots.sort((a, b) => a.offset - b.offset);

		const file = new File(this.#path);
		const tempPath = `${this.#path}.compact`;
		if (File.exists(tempPath))
			File.delete(tempPath);
		const out = new File(tempPath, true);

		for (const { slot, offset } of slots) {
			const base = slot * SLOT_SIZE;
			const length = this.#indexView.getUint16(base + SLOT_LENGTH, false);
			const crc = this.#indexView.getUint16(base + SLOT_CRC, false);
			const key = this.#slotKey(slot);

			file.position = offset + HEADER_LENGTH;
			const bytes = new Uint8Array(file.read(ArrayBuffer, length));

			const meta = new ArrayBuffer(META_LENGTH);
			const metaView = new DataView(meta);
			metaView.setUint16(0, crc, false);
			metaView.setUint16(2, length, false);

			const newOffset = out.length;
			out.position = newOffset;
			out.write(key, meta, bytes.buffer);

			this.#indexView.setUint32(base + SLOT_OFFSET, newOffset, false);
		}
		file.close();
		out.close();

		File.delete(this.#path);
		File.rename(tempPath, this.#path);
	}

	// Debug helper: returns every record currently in data.bin, in file
	// order. Includes stale records left behind by set()'s appends (i.e.
	// what compact() would reclaim), not just the live ones.
	debug() {
		const file = new File(this.#path);
		this.#eachRecord((key, offset, length, crc) => {
			if (length === DELETED_LENGTH) {
				trace(key, offset, "deleted", '\n');
				return;
			}
			file.position = offset + HEADER_LENGTH;
			const bytes = new Uint8Array(file.read(ArrayBuffer, length));
			trace(key, offset, length, crc, bytesToString(bytes), '\n');
		});
		file.close();
	}

	// Deletes data.bin outright (e.g. to start over). Named apart from
	// delete(key), which removes a single key, to keep the two from
	// being confused.
	erase() {
		if (File.exists(this.#path))
			File.delete(this.#path);
		this.#cache.clear();
		this.#cacheLength = 0;
		this.#resetIndex();
	}

	clearCache() {
		this.#cache.clear();
		this.#cacheLength = 0;
	}
}
