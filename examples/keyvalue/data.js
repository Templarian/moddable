import { File } from "file";
import { CRC16 } from "crc";

export const STORE_PATH = "/mod/data.bin";

const KEY_LENGTH = 8;
const META_LENGTH = 4; // crc16(2) + value length(2)
const HEADER_LENGTH = KEY_LENGTH + META_LENGTH;
const MAX_VALUE_LENGTH = 0xFFFF; // length field is a uint16

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

	// Bounded LRU cache of decoded values. There is no in-memory index of
	// every key -- a cache miss costs a linear scan of data.bin (see
	// #find) rather than keeping an offset entry resident for every key
	// ever written, which is the point on a memory-constrained device.
	#cache = new Map(); // key -> value
	#cacheLength = 0;
	#maxTotalLength;

	constructor(maxTotalLength, path = STORE_PATH) {
		this.#maxTotalLength = maxTotalLength;
		this.#path = path;
	}

	// Calls visit(key, offset, length, crc) for every record in data.bin,
	// in file order. Shared scan used by #find() and compact().
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

			visit(key, offset, length, crc);
			offset += HEADER_LENGTH + length;
		}

		file.close();
	}

	// Scans data.bin for `key`, returning its most recent record (a later
	// write always overrides an earlier one for the same key) or
	// undefined if it has never been written.
	#find(key) {
		let found;
		this.#eachRecord((recordKey, offset, length, crc) => {
			if (recordKey === key)
				found = { offset, length, crc };
		});
		return found;
	}

	has(key) {
		return this.#cache.has(key) || (this.#find(key) !== undefined);
	}

	get(key) {
		if (this.#cache.has(key)) {
			const value = this.#cache.get(key);
			this.#cache.delete(key);
			this.#cache.set(key, value); // move to the end = most recently used
			return value;
		}

		const entry = this.#find(key);
		if (entry === undefined)
			return undefined;

		const file = new File(this.#path);
		file.position = entry.offset + HEADER_LENGTH;
		const bytes = new Uint8Array(file.read(ArrayBuffer, entry.length));
		file.close();

		this.#crc.reset();
		if (this.#crc.checksum(bytes.buffer) !== entry.crc)
			throw new Error(`data.bin: corrupt value for key "${key}"`);

		const value = bytesToString(bytes);
		this.#cacheSet(key, value);
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

		const existing = this.#find(key);
		const file = new File(this.#path, true);

		// Same length overwrites the existing record in place. Any other
		// length (grow or shrink) appends a fresh record instead, since a
		// shrink would otherwise leave stale trailing bytes with nothing
		// recording where the record actually ends. The old record, if
		// any, is left as dead space for compact() to reclaim.
		const offset = (existing && existing.length === bytes.length) ? existing.offset : file.length;

		const meta = new ArrayBuffer(META_LENGTH);
		const metaView = new DataView(meta);
		metaView.setUint16(0, crc, false);
		metaView.setUint16(2, bytes.length, false);

		file.position = offset;
		file.write(key, meta, bytes.buffer);
		file.close();

		this.#cacheSet(key, value);
	}

	#cacheSet(key, value) {
		if (this.#cache.has(key)) {
			this.#cacheLength -= this.#cache.get(key).length;
			this.#cache.delete(key);
		}
		this.#cache.set(key, value);
		this.#cacheLength += value.length;
		this.#evictIfNeeded();
	}

	#evictIfNeeded() {
		while (this.#cacheLength > this.#maxTotalLength && this.#cache.size > 0) {
			const oldestKey = this.#cache.keys().next().value; // O(1), front = least recently used
			const oldestValue = this.#cache.get(oldestKey);
			this.#cacheLength -= oldestValue.length;
			this.#cache.delete(oldestKey);
		}
	}

	// Rewrites data.bin with only the live records (in on-disk order),
	// reclaiming space left behind by set()'s appends. The in-memory
	// cache is untouched -- it holds decoded values, not offsets.
	compact() {
		if (!File.exists(this.#path))
			return;

		// Same idea as #find, but for every key at once: keep the last
		// record seen per key, so the rewrite below only copies live data.
		const live = new Map();
		this.#eachRecord((key, offset, length, crc) => live.set(key, { offset, length, crc }));
		const records = [...live].sort((a, b) => a[1].offset - b[1].offset);

		const file = new File(this.#path);
		const tempPath = `${this.#path}.compact`;
		if (File.exists(tempPath))
			File.delete(tempPath);
		const out = new File(tempPath, true);

		for (const [key, entry] of records) {
			file.position = entry.offset + HEADER_LENGTH;
			const bytes = new Uint8Array(file.read(ArrayBuffer, entry.length));

			const meta = new ArrayBuffer(META_LENGTH);
			const metaView = new DataView(meta);
			metaView.setUint16(0, entry.crc, false);
			metaView.setUint16(2, entry.length, false);

			out.position = out.length;
			out.write(key, meta, bytes.buffer);
		}
		file.close();
		out.close();

		File.delete(this.#path);
		File.rename(tempPath, this.#path);
	}
}
