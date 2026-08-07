import { File } from "file";
import { CRC16 } from "crc";

export const STORE_PATH = "/mod/data.bin";

// todo: the library here should store
// key values in binary data.bin file and keep a
// cache of the last accessed keys.
// - 8 character keys
// - values are json strings
// - CRC16 hash of values
// Due to limited memory this cache should
// clear out keys based LRU (Least Recently Used).
//
// const storage = new Storage(100000); // ~100kb
// storage.set("eb7cb92e", "value")
//
// ToDo: Need a method to compact data.bin as new data updates get shifted to the end.

export class Storage {
  constructor(maxTotalLength) {
    this.map = new Map(); // key -> { value, offset, length }
    this.maxTotalLength = maxTotalLength;
    this.totalLength = 0;
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;

    // Move to the end = mark as most recently used (O(1))
    this.map.delete(key);
    this.map.set(key, entry);

    return entry.value;
  }

  set(key, value) {
    const length = value.length; // adjust if length means something else (e.g. byte size)

    if (this.map.has(key)) {
      const entry = this.map.get(key);
      this.totalLength += length - entry.length;
      entry.value = value;
      entry.length = length;
      this.map.delete(key);
      // ToDo: Insert in data.bin
      this.map.set(key, entry); // refresh position too
    } else {
      // ToDo: insert in file and record offset in data.bin
      this.map.set(key, { value, offset: undefined, length });
      this.totalLength += length;
    }

    this._evictIfNeeded();
  }

  _evictIfNeeded() {
    while (this.totalLength > this.maxTotalLength && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value; // O(1), front = least recently used
      const oldest = this.map.get(oldestKey);
      this.totalLength -= oldest.length;
      this.map.delete(oldestKey);
    }
  }
}
