# data.js — How to Use

`data.js` implements `Storage`, a key/value store over a single flat file (`/mod/data.bin` by default). It's an append-mostly log on disk, backed by a fixed-size, memory-resident LRU index — so RAM usage is bounded and predictable no matter how many keys you write over the store's lifetime.

---

## Mental Model

- **Keys are exactly 8 characters** (e.g. `"eb7cb92e"`) and **values are strings** (e.g. JSON text). Values must be ASCII/byte-safe — non-ASCII JS strings will disagree with the byte length actually written to disk.
- **On disk**, `data.bin` is a sequence of records: `[key(8 bytes)][crc16(2 bytes)][length(2 bytes)][value(length bytes)]`. `set()` overwrites a record in place only when the new value is exactly the same length as the old one; any other length change appends a fresh record instead and leaves the old one behind as dead space.
- **`delete()`** (and eviction, see below) don't erase bytes from the file — they append a small tombstone record (a header with no payload) that marks the key as gone. Physical space isn't reclaimed until you call `compact()`.
- **In memory**, a fixed-capacity resident index (one 20-byte slot per key, capped at `maxKeys`) tracks every retained key's offset/length/crc, ordered by recency via an intrusive LRU list threaded through the slots themselves — not a `Map` of objects, so its RAM cost is exactly `maxKeys × 20` bytes, known up front (the constructor `trace()`s this estimate).
- **When the index is full**, `set()`-ing a new key evicts the least-recently-used key — from memory *and* from disk (via a tombstone) — to make room. This is a real, bounded store: old, cold keys get purged automatically, not just uncached.
- **A separate, smaller cache** holds decoded values for recently-used keys, bounded by total bytes (`maxTotalLength`) rather than key count. This is what makes repeat `get()`s on hot keys avoid touching disk at all. It's independent of the `maxKeys` index cap.

---

## Setup

`manifest.json` already includes the `file` and `crc` modules and `./data` in its module list, so `import { Storage } from "./data";` (or `"./data.js"`) resolves as-is — nothing extra to wire up.

---

## Typical Flow

```javascript
import { Storage } from "./data";

// maxTotalLength: bytes of decoded values to keep cached in RAM.
// maxKeys (optional, default 5000): how many distinct keys the store
// retains before purging the least recently used one.
const storage = new Storage(64_000, 5000);

// Write a value.
storage.set("eb7cb92e", JSON.stringify({ value: 42 }));

// Read it back.
if (storage.has("eb7cb92e")) {
	const data = JSON.parse(storage.get("eb7cb92e"));
	trace(`health: ${data.value}\n`);
}

// A miss returns undefined, not null or an exception.
storage.get("00000000"); // -> undefined

// Remove a key outright (writes a tombstone).
storage.delete("eb7cb92e");

// Periodically reclaim space left behind by overwrites, deletes, and
// LRU purges -- e.g. on a maintenance timer, or when convenient.
storage.compact();
```

---

## API Reference

### Constructor

| | |
|---|---|
| `new Storage(maxTotalLength, maxKeys = 5000, path = STORE_PATH)` | `maxTotalLength` — byte budget for the decoded-value cache (required). `maxKeys` — how many distinct keys the store retains before purging the least recently used one; must be between 1 and 65534. `path` — the backing file, defaults to `STORE_PATH` (`/mod/data.bin`). Rebuilds the resident index from `path` if it already exists. |

### Reading and writing

| Method | Description |
|---|---|
| `has(key): boolean` | Whether `key` currently has a value — checks the cache, then the resident index. No disk I/O. |
| `get(key): string \| undefined` | Returns the value for `key`, or `undefined` if it's never been set, was deleted, or was purged by LRU eviction. A cache hit costs nothing; a cache miss costs one disk read plus a CRC check, and the result is cached for next time. Throws if the stored CRC doesn't match (corruption). |
| `set(key, value): void` | Writes `value` for `key`. `key` must be exactly 8 characters; `value` must be a string of at most 65534 bytes. If the index is full, this first evicts and tombstones the least recently used key to make room. |
| `delete(key): void` | Removes `key` from the cache and index, and appends a tombstone record to disk. A no-op if `key` isn't currently set. |

### Maintenance

| Method | Description |
|---|---|
| `compact(): void` | Rewrites the backing file to contain only what the resident index says is live, reclaiming space from overwrites, deletes, and LRU purges. Doesn't touch the value cache. Safe to call on an empty/missing store (no-op). |
| `erase(): void` | Deletes the backing file entirely and resets the store to empty (clears the cache and the resident index). Use this to start over. |
| `clearCache(): void` | Drops all cached decoded values without touching the index or disk. Frees RAM immediately; the next `get()` for any key just costs one extra disk read. |
| `debug(): void` | Traces every record currently in the backing file, in file order — including stale/orphaned records and tombstones (i.e. what `compact()` would reclaim). For inspecting raw on-disk state, not for programmatic use. |

---

## Notes

- **Keys must be exactly 8 characters.** `set()` and `delete()` throw a `RangeError` otherwise.
- **Values are capped at 65534 bytes** (`RangeError` if exceeded) — one value short of the on-disk length field's full `uint16` range, since the top value (`0xFFFF`) is reserved to mark a tombstone.
- **`get()` on a purged or never-set key returns `undefined`**, not an error — check with `has()` first if you need to distinguish "never set" from "set to an empty string" in your own logic.
- **LRU eviction is real deletion, not just a cache drop.** If you rely on a key surviving indefinitely, keep `maxKeys` comfortably above your expected working set — once the store is at capacity, every new key purges the coldest existing one from disk.
- **`compact()` is not automatic.** `set()`/`delete()` never reclaim space on their own; call `compact()` on whatever cadence makes sense for your app (a maintenance timer, a low-activity moment, etc.).
- **A cold start doesn't need `compact()` to behave correctly** — the constructor rebuilds the index from whatever's on disk, including honoring existing tombstones. If disk already holds more live keys than `maxKeys` allows, the excess (oldest by write order) is dropped from the index at startup, though their disk space isn't reclaimed until the next `compact()`.
