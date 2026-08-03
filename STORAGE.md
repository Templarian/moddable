# ESP32-S3 / Moddable SDK — Entity Store
## Persistent Entity & State Storage with PSRAM Hash Index & LittleFS

---

## Overview

This document describes the storage architecture for the ESP32-S3 using the Moddable SDK, aligned with the entity/schema model in [`examples/teststorage/storageIdea.md`](examples/teststorage/storageIdea.md). Entities are keyed by a server-issued 8 hex character (32-bit) id and stored persistently on LittleFS (internal flash) or SD card, with a hash-table index cached in PSRAM for near-constant-time lookups regardless of dataset size.

This document is the architecture reference for the `data.ts` library (`examples/teststorage/data.ts`) that implements entity and state storage for `examples/teststorage/main.js`.

### Goals

- Persistent storage that survives power cycles
- Sub-millisecond key lookups via a PSRAM-resident hash index
- O(1) average-case lookup and insert — flat regardless of entity count
- Minimal flash reads — only on cache miss
- Scales to 10k+ entities without insert cost growing with dataset size
- TypeScript-friendly utility layer adaptable to Moddable's XS JS engine

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    PSRAM (up to 8MB)                │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │            Hash Index (ArrayBuffer)         │   │
│  │   [ id(4) | offset(4) | len(2) | crc16(2) ] │   │
│  │         × tableSize, 12 bytes per slot      │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │         Hot BMP / Asset Cache (optional)    │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              LittleFS / Internal Flash              │
│                                                     │
│  /store/data.bin                                    │
│  ┌───────────┬──────────────────┬──────────────────┐ │
│  │  HEADER   │   INDEX REGION   │   DATA REGION    │ │
│  │  8 bytes  │ tableSize×12B    │  packed payloads │ │
│  └───────────┴──────────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Entity & Schema Model

Entities are JSON objects keyed by an 8 hex character (32-bit) id, generated server-side and never derived or re-hashed on device:

```typescript
function createEntity() {
  return ((Math.random() * 0x100000000) >>> 0)
    .toString(16)
    .padStart(8, '0');
}
```

An entity is either a **schema definition** (`{ name, schema: {...} }`) or an **instance** of one, keyed by the schema's own id, e.g. `{ "eb7cb92e": { "564f1799": { "value": 42 } } }`. Schema field types include `string`, `i8`, `boolean`, `enum`, and `ref` (a reference to another entity id). See `examples/teststorage/storageIdea.md` for the full worked example.

A separate, much smaller table maps human-readable state names to entity ids:

```json
{
    "player.name": "54a938dd",
    "player.tile": "44e469ae",
    "player.health": "eb7cb92e",
    "quest.city.rat": "b2e5f719"
}
```

Scripts resolve `"player.health"` → `"eb7cb92e"` → entity lookup → flash read → parsed entity. State names can also accumulate into the thousands over time — enough that loading them all into memory at once, or linear-scanning a name log on every lookup, hits the same flash-read cost problem entities do. So the name→id mapping gets the same hash-table treatment, at a smaller scale: `/store/state.bin` is `HEADER | INDEX (hash table) | DATA (append-only records)`, same shape as `/store/data.bin`.

The one real difference: a name's hash is not already a unique key the way a server-issued entity id is — two different names can land on the same hash. So a slot match isn't enough by itself; the device reads that slot's record back and confirms the name actually matches before trusting its id. Each record is `[nameLength(1 byte)][name][id (8 hex characters)]` — fixed size once the name is fixed, so updating an existing name's id just overwrites its 8 id bytes in place. Unlike entity updates, state-name updates never orphan bytes and never need compaction — only growing the table's headroom for more names does.

Resolved names are cached in an in-memory map after their first lookup, so the hash-table probe (and its flash read) is only ever paid once per name per session — repeat lookups for the same name are free.

### Server Protocol

```
GET /key/<hex>
```

Ex: `/key/1b6614d2`

```json
{
    "hash": 23551,
    "data": {}
}
```

`hash` is the CRC16 of the entity's canonical JSON (see below) and is stored directly in the local index — the device never computes it, only verifies it.

---

## Why a Hash Table Instead of Sorted Binary Search

Earlier revisions of this design (and of `storageIdea.md`) used a sorted index with binary search: O(log n) lookups, but every insert required shifting all entries after the insertion point to keep the array sorted.

At 10k+ entities that insert cost becomes the bottleneck, not the lookup cost:

- Entity ids are already randomly distributed (`Math.random()`-based), so a new id lands at a random position in the sort order — on average shifting half the table.
- At 10k entries × 12 bytes, that's ~60KB of index rewritten *per insert*.
- Entities arrive one at a time, as they're requested from the server (`examples/teststorage/storageIdea.md`, "received as required from a server request") — not as a single bulk load — so this cost is paid repeatedly during normal operation, not just once at build time.
- ESP32 flash erases in ~4KB sectors, so a mid-table insert can mean erasing and rewriting multiple sectors, not just the bytes that logically changed.

A hash table avoids this entirely:

- Since the id is already a uniformly random 32-bit value, it's used directly as the hash — no hash function needed, no build-time collision-free seed search.
- `slot = id % tableSize`, collisions resolved with linear probing.
- Insert writes to one slot (or a short probe chain) with no reordering of existing entries — O(1) average, not O(n).
- The table is sized upfront with headroom for the expected entity count (~60% load factor) so probe chains stay short. Growing beyond that capacity is a rare, explicit rebuild — not something that happens on the normal insert path.

---

## File Layout (`/store/data.bin`)

```
Offset 0:  [ uint32: entry count ]  ← HEADER (8 bytes)
Offset 4:  [ uint32: table size (slot count) ]
Offset 8:  [ SLOT 0 ]  ← position = id % tableSize, empty = 0xFF sentinel bytes
Offset 20: [ SLOT 1 ]
...
Offset 8 + tableSize×12: [ raw entity payload 0 ]  ← DATA REGION
                    [ raw entity payload 1 ]
                    ...
```

### Index Slot Structure (12 bytes)

```
[ 0..3  ] uint32 — id (8 hex character id from server, used directly as the hash)
[ 4..7  ] uint32 — byte offset into file where payload starts
[ 8..9  ] uint16 — byte length of payload
[ 10..11] uint16 — crc16 (server-provided content hash, from the "hash" property)
```

An empty slot is all `0xFF` bytes — the natural state of erased flash — used as the sentinel instead of a separate valid bit.

---

## Canonical JSON & CRC16

The server computes each entity's `hash` from its canonical (key-sorted) JSON, so the device never needs to re-derive it — only verify it on demand:

```typescript
// Node.js build tool — must match the device's canonical form exactly

function canonicalStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }

  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => JSON.stringify(key) + ':' + canonicalStringify(obj[key]));
  return '{' + pairs.join(',') + '}';
}
```

```typescript
// Node.js build tool — CRC-16/XMODEM matching Moddable SDK CRC16(0x1021)

const CRC16_TABLE: Uint16Array = (() => {
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

function crc16(data: Buffer | Uint8Array): number {
  let crc = 0x0000;
  for (const byte of data) {
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xFF]) & 0xFFFF;
  }
  return crc;
}

// Verification
console.assert(crc16(Buffer.from("123456789")) === 0x31C3, "CRC16 mismatch — check variant");
```

The device uses the identical `CRC16(0x1021)` implementation (Moddable SDK `crc` module) for BMP asset verification below — same function, two different inputs (canonical entity JSON vs. raw file bytes). Entity writes normally carry the server's hash through unchanged, but when it isn't available (e.g. locally-authored entities with no server round trip), the same native `crc` module computes it on-device instead of the plain-JS reference implementation above — the reference implementation exists to document the algorithm precisely, not to be the hot path.

---

## Hash Table Lookup (O(1) average, linear probing)

All comparisons happen entirely in PSRAM — no flash access until a match is found.

```typescript
interface LookupResult {
  offset: number;   // byte position in data.bin
  length: number;   // byte length of payload
  hash:   number;   // crc16 stored at index time
}

const SLOT_SIZE = 12; // bytes per slot: id(4) + offset(4) + length(2) + crc16(2)
const EMPTY_ID  = 0xFFFFFFFF; // erased-flash sentinel

/**
 * Probes the PSRAM hash index starting at id % tableSize.
 * Returns file offset/length/hash, or null if not found.
 */
function hashLookup(
  indexBuffer: ArrayBuffer,
  tableSize: number,
  id: number
): LookupResult | null {
  const view = new DataView(indexBuffer);
  let slot = id % tableSize;

  for (let probes = 0; probes < tableSize; probes++) {
    const pos    = slot * SLOT_SIZE;
    const slotId = view.getUint32(pos, false);

    if (slotId === EMPTY_ID) return null; // empty slot — not present

    if (slotId === id) {
      return {
        offset: view.getUint32(pos + 4, false),
        length: view.getUint16(pos + 8, false),
        hash:   view.getUint16(pos + 10, false)
      };
    }

    slot = (slot + 1) % tableSize;
  }

  return null;
}
```

---

## Hash Table Insert (no reordering)

Unlike the sorted-array approach, inserting a new entity never touches any other slot — it either lands directly at `id % tableSize` or probes forward to the next empty slot.

```typescript
function hashInsert(
  indexBuffer: ArrayBuffer,
  tableSize: number,
  id: number,
  offset: number,
  length: number,
  hash: number
): void {
  const view = new DataView(indexBuffer);
  let slot = id % tableSize;

  for (let probes = 0; probes < tableSize; probes++) {
    const pos    = slot * SLOT_SIZE;
    const slotId = view.getUint32(pos, false);

    if (slotId === EMPTY_ID || slotId === id) {
      view.setUint32(pos,      id,     false);
      view.setUint32(pos + 4,  offset, false);
      view.setUint16(pos + 8,  length, false);
      view.setUint16(pos + 10, hash,   false);
      return;
    }

    slot = (slot + 1) % tableSize;
  }

  throw new Error("hash table full — rebuild with a larger tableSize");
}
```

---

## Boot-Time Index Load

At startup, read the header and the full index region from flash into PSRAM. Data payloads stay on flash until individually requested.

```typescript
const STORE_PATH  = '/store/data.bin';
const HEADER_SIZE = 8;

interface StoreHeader {
  entryCount: number;
  tableSize:  number; // slot count, not byte size
}

function readHeader(file: File): StoreHeader {
  const buf  = file.read(ArrayBuffer, HEADER_SIZE) as ArrayBuffer;
  const view = new DataView(buf);
  return {
    entryCount: view.getUint32(0, false),
    tableSize:  view.getUint32(4, false)
  };
}

/**
 * Loads the full hash index into PSRAM.
 * Only reads the index region — data payloads stay on flash.
 * Call once at boot; keep result in module-level variables.
 */
function loadIndex(): { buffer: ArrayBuffer; tableSize: number } {
  const file   = new File(STORE_PATH);
  const header = readHeader(file);

  file.position = HEADER_SIZE;
  const buffer  = file.read(ArrayBuffer, header.tableSize * SLOT_SIZE) as ArrayBuffer;
  file.close();

  return { buffer, tableSize: header.tableSize };
}

// Module-level state
let indexCache: ArrayBuffer | null = null;
let indexTableSize = 0;

function ensureIndex(): ArrayBuffer {
  if (!indexCache) {
    const loaded = loadIndex();
    indexCache = loaded.buffer;
    indexTableSize = loaded.tableSize;
  }
  return indexCache;
}
```

---

## Full Lookup Flow

```typescript
/**
 * Full lookup: PSRAM hash probe → single flash seek on hit.
 * id is the 8 hex character id issued by the server.
 *
 * Timing breakdown:
 *   - Hash probe:     ~0.001ms  (PSRAM, O(1) average)
 *   - Flash read:     ~1–2ms    (only on hit, single seek)
 *   - Total:          ~1–2ms
 */
function getEntity(id: number): object | null {
  const index  = ensureIndex();
  const result = hashLookup(index, indexTableSize, id);

  if (!result) return null;

  const file = new File(STORE_PATH);
  file.position = result.offset;
  const data = file.read(String, result.length) as string;
  file.close();

  return JSON.parse(data);
}
```

---

## Store Builder (Write Path)

Used to construct or rebuild the entire store file from a batch of entries. Sizes the table with headroom, then places every entry via open addressing — no sorting step.

```typescript
interface StoreEntry {
  id:   number; // 32-bit id from server
  hash: number; // CRC16 of canonical entity JSON
  data: string; // canonicalStringify(entity) payload
}

/**
 * Smallest table size that keeps the load factor at or below the target.
 * ~60% keeps probe chains short without wasting excess flash/PSRAM.
 */
function nextTableSize(entryCount: number, loadFactor = 0.6): number {
  return Math.ceil(entryCount / loadFactor);
}

/**
 * Builds the entire store file from scratch.
 * Places entries into a headroom-sized hash table via open addressing.
 * Use for initial population or full rebuilds/compaction.
 */
function buildStore(entries: StoreEntry[]): void {
  const tableSize = nextTableSize(entries.length);
  const indexSize = tableSize * SLOT_SIZE;
  const dataStart = HEADER_SIZE + indexSize;
  let   totalSize = dataStart;

  for (const e of entries) totalSize += e.data.length;

  const buf  = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // Header
  view.setUint32(0, entries.length, false); // entry count
  view.setUint32(4, tableSize,      false); // slot count

  // Initialize index region to the empty sentinel
  for (let i = 0; i < indexSize; i++) view.setUint8(HEADER_SIZE + i, 0xFF);

  // Place entries via open addressing, then write payloads
  let dataPos = dataStart;

  for (const e of entries) {
    let slot = e.id % tableSize;
    while (true) {
      const pos = HEADER_SIZE + slot * SLOT_SIZE;
      if (view.getUint32(pos, false) === EMPTY_ID) {
        view.setUint32(pos,      e.id,          false);
        view.setUint32(pos + 4,  dataPos,       false);
        view.setUint16(pos + 8,  e.data.length, false);
        view.setUint16(pos + 10, e.hash,        false);
        break;
      }
      slot = (slot + 1) % tableSize;
    }

    for (let i = 0; i < e.data.length; i++)
      view.setUint8(dataPos + i, e.data.charCodeAt(i));
    dataPos += e.data.length;
  }

  // Write to LittleFS
  const file = new File(STORE_PATH, true); // true = create/overwrite
  file.write(buf);
  file.close();

  // Invalidate PSRAM cache — will reload on next access
  indexCache = null;
  indexTableSize = 0;
}
```

---

## PSRAM BMP Asset Index

Build an in-memory catalog at boot by scanning the SD card (path + size only), then use an LFU hot cache with lazy sliding-TTL expiry and periodic frequency halving to keep frequently-used buffers in PSRAM while naturally pruning forgotten ones. A CRC16 checksum (Moddable SDK built-in) is computed for each BMP on first load and stored in the catalog entry, enabling fast server-driven asset verification without re-reading files.

- **O(1) get/put/evict** via frequency bucket map (`freq → Set<key>`) + `minFreq` pointer
- **Sliding TTL** — on every `getBmp` hit the `lastAccess` timestamp resets; expired entries are evicted lazily on the next access or eviction pass
- **Dynamic aging** — a timer halves all frequency counts periodically so historically-popular but now-idle items decay toward eviction
- **Lazy CRC16** — checksum computed once on first SD load, persists in `BmpEntry` across hotCache evictions

```typescript
import CRC16 from "crc";

const MAX_HOT_ENTRIES    = 50;
const HOT_TTL_MS         = 30_000;  // 30 s without access → eviction-eligible
const HOT_AGING_INTERVAL = 60_000;  // frequency halving period (ms)

interface BmpEntry  { path: string; size: number; hash: number; }
// hash: 0 = not yet computed; populated on first SD load, survives hotCache eviction
interface HotEntry  { buffer: ArrayBuffer; freq: number; lastAccess: number; }

// Catalog — path/size only, no buffers. Buffers live in hotCache only.
const bmpIndex:    Map<string, BmpEntry>     = new Map();
const hotCache:    Map<string, HotEntry>     = new Map();
const freqBuckets: Map<number, Set<string>>  = new Map();
let   minFreq = 1;

function promote(name: string, entry: HotEntry): void {
  const oldFreq = entry.freq;
  const bucket  = freqBuckets.get(oldFreq)!;
  bucket.delete(name);
  if (bucket.size === 0) {
    freqBuckets.delete(oldFreq);
    if (minFreq === oldFreq) minFreq++;  // safe: promoted item now lives at oldFreq+1
  }
  entry.freq++;
  entry.lastAccess = Date.now();
  if (!freqBuckets.has(entry.freq)) freqBuckets.set(entry.freq, new Set());
  freqBuckets.get(entry.freq)!.add(name);
}

function evictOne(): void {
  // Guard against stale minFreq left by lazy TTL removal
  if (!freqBuckets.has(minFreq)) minFreq = Math.min(...freqBuckets.keys());

  const bucket = freqBuckets.get(minFreq)!;
  const now    = Date.now();

  // Prefer TTL-expired entries in the lowest-freq bucket
  for (const key of bucket) {
    if (now - hotCache.get(key)!.lastAccess >= HOT_TTL_MS) {
      bucket.delete(key);
      hotCache.delete(key);
      if (bucket.size === 0) freqBuckets.delete(minFreq);
      return;
    }
  }

  // No expired entries — evict true LFU item (oldest insertion at minFreq)
  const key = bucket.values().next().value!;
  bucket.delete(key);
  hotCache.delete(key);
  if (bucket.size === 0) freqBuckets.delete(minFreq);
}

function putHot(name: string, buffer: ArrayBuffer): void {
  if (hotCache.size >= MAX_HOT_ENTRIES) evictOne();
  hotCache.set(name, { buffer, freq: 1, lastAccess: Date.now() });
  if (!freqBuckets.has(1)) freqBuckets.set(1, new Set());
  freqBuckets.get(1)!.add(name);
  minFreq = 1;
}

/**
 * Scans a directory on SD and builds the PSRAM BMP catalog.
 * Runs at boot — one-time SD directory traversal cost (~50–200ms).
 */
function buildBmpIndex(directory: string): void {
  const iter = new Directory(directory);
  let entry;
  while ((entry = iter.read())) {
    if (!entry.name.endsWith('.bmp')) continue;
    bmpIndex.set(entry.name.replace('.bmp', ''), {
      path: `${directory}/${entry.name}`,
      size: entry.size,
      hash: 0
    });
  }
}

/**
 * Retrieves a BMP as an ArrayBuffer.
 *   - Hot cache hit + valid TTL:  ~0.001ms  (PSRAM, promotes freq)
 *   - Hot cache hit + expired:    evicts entry, reloads from SD (~3–8ms)
 *   - Cache miss:                 loads from SD, inserts into hot cache
 */
function getBmp(name: string): ArrayBuffer | null {
  const hot = hotCache.get(name);
  if (hot) {
    if (Date.now() - hot.lastAccess >= HOT_TTL_MS) {
      // Lazy TTL expiry — remove from LFU structure, fall through to reload
      const bucket = freqBuckets.get(hot.freq)!;
      bucket.delete(name);
      if (bucket.size === 0) freqBuckets.delete(hot.freq);
      hotCache.delete(name);
    } else {
      promote(name, hot);
      return hot.buffer;
    }
  }

  const entry = bmpIndex.get(name);
  if (!entry) return null;

  const file   = new File(entry.path);
  const buffer = file.read(ArrayBuffer, entry.size) as ArrayBuffer;
  file.close();

  entry.hash = new CRC16(0x1021).checksum(buffer);  // CRC-16/XMODEM; persists across evictions
  putHot(name, buffer);
  return buffer;
}

// Halve all frequency counts — stale-but-historically-popular items
// decay toward minFreq and become eligible for eviction. O(n) on the
// bounded cache size so effectively constant.
Timer.repeat((): void => {
  freqBuckets.clear();
  for (const [key, entry] of hotCache) {
    entry.freq = Math.max(1, entry.freq >> 1);
    if (!freqBuckets.has(entry.freq)) freqBuckets.set(entry.freq, new Set());
    freqBuckets.get(entry.freq)!.add(key);
  }
  if (hotCache.size > 0) minFreq = Math.min(...freqBuckets.keys());
}, HOT_AGING_INTERVAL);
```

### Server-Driven Asset Verification

The server sends a compact list of name/hash pairs. The device compares each against the CRC16 stored in `bmpIndex`. If a hash is not yet computed (asset hasn't been accessed since boot), `getBmp` is called to load it and populate the hash as a side effect. Names absent from `bmpIndex` are also flagged — they are assets the server has that the device does not.

```typescript
interface AssetRef { name: string; hash: number; }

/**
 * Compares server-provided CRC16 hashes against the device catalog.
 * Returns names of assets that are missing or have a mismatched checksum.
 * Triggers an SD load for any asset not yet accessed since boot.
 */
function checkForUpdates(serverAssets: AssetRef[]): string[] {
  const stale: string[] = [];

  for (const { name, hash } of serverAssets) {
    const entry = bmpIndex.get(name);
    if (!entry) {
      stale.push(name);  // asset not present on device at all
      continue;
    }
    if (entry.hash === 0) getBmp(name);  // populate hash as side effect
    if (entry.hash !== hash) stale.push(name);
  }

  return stale;
}
```

The same verification pattern applies to entities: the server's `GET /key/<hex>` response already includes `hash` (see "Entity & Schema Model" above), so the device compares it against the `crc16` stored in the entity's index slot without needing to recompute or re-parse the payload.

Node.js build-tool helper for BMP manifests:

```typescript
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

function buildAssetManifest(directory: string): AssetRef[] {
  return readdirSync(directory)
    .filter(f => f.endsWith(".bmp"))
    .map(f => ({
      name: basename(f, ".bmp"),
      hash: crc16(readFileSync(join(directory, f)))
    }));
}

// Send to device over WiFi/BLE for verification
const manifest = buildAssetManifest("./assets");
```

---

## Unified Boot Sequence

```typescript
/**
 * Full boot initialization sequence.
 * WiFi is deliberately deferred — UI renders before any network activity.
 */
function boot(): void {
  // Phase 1: Fast local init (~200–400ms total)
  buildBmpIndex('/sd/assets');   // Scan SD, build PSRAM BMP index
  ensureIndex();                 // Load entity hash index into PSRAM
  renderUI();                    // Show UI immediately — user sees content

  // Phase 2: Deferred network init (hidden behind visible UI)
  Timer.set(() => {
    initWifi();                  // ~500–2000ms, runs in background
  }, 0);
}
```

---

## Performance Summary

| Operation | Where | Time |
|-----------|-------|------|
| Hash probe (10k entries, ~60% load) | PSRAM | ~0.001–0.002ms (short probe chain, O(1) average) |
| Hash probe (50k+ entries, ~60% load) | PSRAM | ~0.001–0.002ms — flat, doesn't grow with entity count |
| Hash insert (single entity) | PSRAM | ~0.001ms probe + single flash slot write, no reordering |
| Flash payload read (on hit) | LittleFS | ~1–2ms |
| BMP hot cache hit | PSRAM | ~0.001ms |
| BMP lazy load from SD | SD card | ~3–8ms |
| 100 sequential entity lookups (cold) | Flash | ~100–200ms |
| 100 sequential entity lookups (warm) | PSRAM | ~0.1ms |
| Boot index load (10k entries, ~16.7k slots) | Flash → PSRAM | ~5–10ms |

---

## Memory Budget (ESP32-S3, 8MB PSRAM)

| Region | Size | Notes |
|--------|------|-------|
| Entity hash index (10k entities, ~16.7k slots @ 60% load) | ~195 KB | 16,667 × 12 bytes |
| Entity hash index (50k entities, ~83.3k slots @ 60% load) | ~975 KB | approaching limit for index-only |
| BMP index metadata (1k assets) | ~100 KB | path strings + struct overhead |
| Hot BMP cache (50 × 32×32) | ~150 KB | 50 × ~3KB |
| XS VM + app heap | ~1–2 MB | Moddable runtime |
| **Available for assets/cache** | **~5 MB** | comfortable headroom |

The hash table trades some flash/PSRAM overhead (headroom above entryCount, vs. a tightly packed sorted array) for O(1) average inserts at any scale — worth it once entity count is high enough that O(n) shift costs on a sorted array would dominate (see "Why a Hash Table" above).

---

## Id Collisions

Because ids are already the key (not a hash of a longer UUID), there are two distinct kinds of collision, handled differently:

- **Hash table slot collisions** (two different ids map to the same `id % tableSize`) are routine and expected — resolved by linear probing, no special handling needed as long as the load factor stays reasonable (~60%).
- **Id collisions** (two different entities are issued the *same* 32-bit id) would be actual data corruption — one entity silently overwrites the other. `createEntity()` (`examples/teststorage/storageIdea.md`) currently has no duplicate check; at 10k entities the birthday-bound probability of a collision among purely random 32-bit ids is on the order of 1%, and it climbs quickly past that as entity count grows (e.g. ~29% by 50k). This is worth flagging as a **ToDo for the server**: track issued ids in a set and regenerate on collision before handing a new id to a client, the same way the old build-time UUID scheme avoided duplicates — just without a hash/seed step, since the id itself is what's being checked.

---

## Key Design Decisions

**Why not NVS/Preference?**
NVS is limited to ~75–100 keys in the default 24KB partition. It is ideal for configuration and credentials but not scalable for entity-keyed datasets.

**Why not individual LittleFS files?**
Per-file overhead (directory scan, inode lookup, open syscall) costs ~1–3ms per file. 100 lookups = 100–300ms. A single file with a PSRAM index amortizes that overhead across all lookups.

**Why use the server id directly instead of hashing it?**
The server already issues an 8 hex character (32-bit) id per entity (`createEntity()`), so there's no UUID-to-key derivation step to perform on device — the id *is* the key. This removes the need for a build-time collision-free seed search entirely; see "Id Collisions" above for what replaces it.

**Why a hash table instead of a sorted array?**
A sorted array gives O(log n) lookups but O(n) shift cost on every insert, since entity ids arrive in random order as they're requested from the server — not as a single bulk load. At 10k+ entities that shift cost (tens of KB rewritten per insert, against ~4KB flash erase sectors) dominates. A hash table trades a bit of extra flash/PSRAM headroom for O(1) average inserts that don't reorder existing entries, which is the better tradeoff once the entity count is in this range.

**Why defer WiFi?**
WiFi association + DHCP adds 500–2000ms to boot. Deferring it behind a `Timer.set(..., 0)` lets the UI render first, making the device feel instant to the user while the radio connects in the background.

---

*Target platform: ESP32-S3 @ 240MHz · Moddable SDK · LittleFS internal flash · 8MB PSRAM*
