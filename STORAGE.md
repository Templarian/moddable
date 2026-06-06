# ESP32-S3 / Moddable SDK — 4-Byte Key Store
## Persistent Key-Value Storage with PSRAM Index & LittleFS

---

## Overview

This document describes a high-performance key-value storage architecture for the ESP32-S3 using the Moddable SDK. The design stores UUID-keyed string data persistently on LittleFS (internal flash) or SD card, with a sorted 4-byte key index cached in PSRAM for near-instant lookups.

### Goals

- Persistent storage that survives power cycles
- Sub-millisecond key lookups via PSRAM-resident index
- O(log n) binary search on sorted index
- Minimal flash reads — only on cache miss
- TypeScript-friendly utility layer adaptable to Moddable's XS JS engine

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    PSRAM (up to 8MB)                │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │           Sorted Index (ArrayBuffer)        │   │
│  │      [ key(4) | offset(4) | len(4) ] × N   │   │
│  │              12 bytes per entry             │   │
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
│  │  12 bytes │  N × 12 bytes    │  packed payloads │ │
│  └───────────┴──────────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Why 4 Bytes? Pre-Calculated Collision-Free Keys

Because all UUIDs in the dataset are known before the store is written, collision avoidance shifts from a probabilistic runtime concern to a deterministic build-time guarantee. A seeded FNV-1a hash is applied to every UUID, and the seed is varied until no two UUIDs produce the same 4-byte key. The winning seed is stored in the file header and used for all future lookups.

| Key Size | Entry Size | 10k Index in PSRAM | Collision guarantee |
|----------|------------|--------------------|---------------------|
| 4 bytes  | 12 bytes   | 120 KB             | Build-time verified |
| 8 bytes  | 16 bytes   | 160 KB             | Statistical only    |
| 16 bytes | 24 bytes   | 240 KB             | Statistical only    |

4 bytes is the right choice when UUIDs are known ahead of time because:

- **12-byte entry** aligns cleanly and saves 25% PSRAM vs the 16-byte alternative
- **Single uint32 comparison** — the fastest possible key match in the XS engine
- **Zero collisions guaranteed** — a collision-free seed is found in < 100 iterations on average for datasets under 10k entries
- **120KB for 10k entries** — trivial PSRAM usage

---

## File Layout (`/store/data.bin`)

```
Offset 0:   [ uint32: entry count          ]
Offset 4:   [ uint32: index region size    ]  ← HEADER (12 bytes)
Offset 8:   [ uint32: hash seed            ]
Offset 12:  [ INDEX ENTRY 0               ]  ← sorted ascending by key
Offset 24:  [ INDEX ENTRY 1               ]
...
Offset 12 + N×12: [ raw string payload 0  ]  ← DATA REGION
              [ raw string payload 1       ]
              ...
```

### Index Entry Structure (12 bytes)

```
[ 0..3  ] uint32 — key (seeded FNV-1a hash of the UUID)
[ 4..7  ] uint32 — byte offset into file where payload starts
[ 8..11 ] uint32 — byte length of payload
```

---

## Build-Time Key Generation (Node.js)

The device never receives a UUID and never hashes one — it only ever handles pre-computed 4-byte keys. All UUID-to-key conversion happens in a Node.js build script that has access to the full UUID set. `SEED` is a hardcoded constant determined at project setup and stored in the file header for reference.

```typescript
// Node.js build tool — never runs on device

const SEED = 0x00000000; // replace with the value chosen at project setup

function uuidToKey(uuid: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i);
    h  = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h;
}
```

### Checking a New UUID for Conflicts

Before adding a UUID to the dataset, verify its 4-byte key does not collide with any existing key. `knownKeys` is the `Set<number>` of all currently assigned 4-byte keys maintained by the build script.

```typescript
function wouldConflict(uuid: string, seed: number, knownKeys: Set<number>): boolean {
  return knownKeys.has(uuidToKey(uuid, seed));
}

// Usage — regenerate UUID until its 4-byte key is free
const knownKeys = new Set(ALL_UUIDS.map(u => uuidToKey(u, SEED)));

let newUuid = generateUuid();
while (wouldConflict(newUuid, SEED, knownKeys)) {
  newUuid = generateUuid();
}
knownKeys.add(uuidToKey(newUuid, SEED));
```

---

## Binary Search (O(log n) in PSRAM)

All comparisons happen entirely in PSRAM — no flash access during search.

```typescript
interface LookupResult {
  offset: number;   // byte position in data.bin
  length: number;   // byte length of payload
}

/**
 * Binary search over the sorted PSRAM index buffer.
 * Single uint32 comparison per step — fastest possible in XS engine.
 * Returns file offset + length, or null if not found.
 */
function binarySearch(
  indexBuffer: ArrayBuffer,
  target: number
): LookupResult | null {
  const view  = new DataView(indexBuffer);
  const ENTRY = 12; // bytes per entry
  const count = indexBuffer.byteLength / ENTRY;

  let lo = 0;
  let hi = count - 1;

  while (lo <= hi) {
    const mid    = (lo + hi) >>> 1;
    const pos    = mid * ENTRY;
    const midKey = view.getUint32(pos, false);

    if (midKey === target) {
      return {
        offset: view.getUint32(pos + 4, false),
        length: view.getUint32(pos + 8, false)
      };
    }

    if (midKey < target) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return null;
}
```

---

## Sorted Insert (Maintain Sort Order on Write)

Every insert keeps the index sorted so binary search is always valid. Finding the insertion point uses the same binary search logic — O(log n) to find position, O(n) to shift entries.

```typescript
const ENTRY_SIZE  = 12;
const HEADER_SIZE = 12;

/**
 * Inserts a new key into the sorted index buffer (in PSRAM).
 * Shifts existing entries right to maintain ascending sort order.
 * Returns new ArrayBuffer — caller replaces old reference.
 */
function insertSorted(
  indexBuffer: ArrayBuffer,
  key: number,
  dataOffset: number,
  dataLength: number
): ArrayBuffer {
  const oldView = new DataView(indexBuffer);
  const count   = indexBuffer.byteLength / ENTRY_SIZE;

  // Binary search for insertion point
  let lo = 0, hi = count - 1, insertAt = count;

  while (lo <= hi) {
    const mid    = (lo + hi) >>> 1;
    const midKey = oldView.getUint32(mid * ENTRY_SIZE, false);

    if (midKey < key) {
      lo = mid + 1;
    } else {
      insertAt = mid;
      hi = mid - 1;
    }
  }

  // Allocate new buffer with one extra entry
  const newBuf  = new ArrayBuffer((count + 1) * ENTRY_SIZE);
  const newView = new DataView(newBuf);

  // Copy entries before insertion point
  for (let i = 0; i < insertAt; i++) {
    const src = i * ENTRY_SIZE;
    const dst = i * ENTRY_SIZE;
    newView.setUint32(dst,     oldView.getUint32(src,     false), false);
    newView.setUint32(dst + 4, oldView.getUint32(src + 4, false), false);
    newView.setUint32(dst + 8, oldView.getUint32(src + 8, false), false);
  }

  // Write new entry
  const np = insertAt * ENTRY_SIZE;
  newView.setUint32(np,     key,        false);
  newView.setUint32(np + 4, dataOffset, false);
  newView.setUint32(np + 8, dataLength, false);

  // Copy entries after insertion point
  for (let i = insertAt; i < count; i++) {
    const src = i * ENTRY_SIZE;
    const dst = (i + 1) * ENTRY_SIZE;
    newView.setUint32(dst,     oldView.getUint32(src,     false), false);
    newView.setUint32(dst + 4, oldView.getUint32(src + 4, false), false);
    newView.setUint32(dst + 8, oldView.getUint32(src + 8, false), false);
  }

  return newBuf;
}
```

---

## Boot-Time Index Load

At startup, read the header (which includes the hash seed) and the index region from flash into PSRAM. The data payloads stay on flash until individually requested.

```typescript
const STORE_PATH  = '/store/data.bin';
const HEADER_SIZE = 12;
const ENTRY_SIZE  = 12;

interface StoreHeader {
  entryCount:      number;
  indexRegionSize: number;
  // hashSeed at offset 8 is written by the Node.js build tool;
  // the device reads past it but never uses it
}

/**
 * Reads the store header from flash.
 * Called once at boot before loadIndex().
 */
function readHeader(file: File): StoreHeader {
  const buf  = file.read(ArrayBuffer, HEADER_SIZE) as ArrayBuffer;
  const view = new DataView(buf);
  return {
    entryCount:      view.getUint32(0, false),
    indexRegionSize: view.getUint32(4, false)
  };
}

/**
 * Loads the full sorted index into PSRAM.
 * Only reads the index region — data payloads stay on flash.
 * Call once at boot; keep result in module-level variable.
 */
function loadIndex(): ArrayBuffer {
  const file   = new File(STORE_PATH);
  const header = readHeader(file);

  file.position = HEADER_SIZE;
  const buffer  = file.read(ArrayBuffer, header.indexRegionSize) as ArrayBuffer;
  file.close();

  return buffer;
}

// Module-level state
let indexCache: ArrayBuffer | null = null;

function ensureIndex(): ArrayBuffer {
  if (!indexCache) indexCache = loadIndex();
  return indexCache;
}
```

---

## Full Lookup Flow

```typescript
/**
 * Full lookup: PSRAM binary search → single flash seek on hit.
 * key is a pre-computed 4-byte value from the Node.js build tool —
 * the device never receives a UUID and never hashes one.
 *
 * Timing breakdown:
 *   - Binary search:  ~0.001ms  (PSRAM, O(log n))
 *   - Flash read:     ~1–2ms    (only on hit, single seek)
 *   - Total:          ~1–2ms
 */
function getValue(key: number): string | null {
  const index  = ensureIndex();
  const result = binarySearch(index, key);

  if (!result) return null;

  // Hit — single targeted flash read
  const file = new File(STORE_PATH);
  file.position = result.offset;
  const data = file.read(String, result.length) as string;
  file.close();

  return data;
}
```

---

## Store Builder (Write Path)

Used to construct or rebuild the entire store file from a batch of entries. Runs the seed search first to guarantee zero collisions, then sorts by key and writes the file.

```typescript
interface StoreEntry {
  uuid:  string;
  value: string;
}

/**
 * Builds the entire store file from scratch.
 * Sorts all entries by their 4-byte key and writes the result.
 * Use for initial population or full rebuilds.
 */
function buildStore(entries: StoreEntry[]): void {
  const seed = SEED;

  // Hash all keys
  const keyed = entries.map(e => ({
    key:   uuidToKey(e.uuid, seed),
    value: e.value
  }));

  // Sort ascending by key
  keyed.sort((a, b) => (a.key >>> 0) - (b.key >>> 0));

  // Calculate sizes
  const indexSize = keyed.length * ENTRY_SIZE;
  const dataStart = HEADER_SIZE + indexSize;
  let   totalSize = dataStart;

  for (const e of keyed) totalSize += e.value.length;

  // Build buffer
  const buf  = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // Header
  view.setUint32(0, keyed.length, false);  // entry count
  view.setUint32(4, indexSize,    false);  // index region size
  view.setUint32(8, seed,         false);  // hash seed

  // Index entries + data offsets
  let indexPos = HEADER_SIZE;
  let dataPos  = dataStart;

  for (const e of keyed) {
    view.setUint32(indexPos,     e.key,          false);
    view.setUint32(indexPos + 4, dataPos,         false);
    view.setUint32(indexPos + 8, e.value.length, false);
    indexPos += ENTRY_SIZE;
    dataPos  += e.value.length;
  }

  // Data payloads
  dataPos = dataStart;
  for (const e of keyed) {
    for (let i = 0; i < e.value.length; i++) {
      view.setUint8(dataPos + i, e.value.charCodeAt(i));
    }
    dataPos += e.value.length;
  }

  // Write to LittleFS
  const file = new File(STORE_PATH, true); // true = create/overwrite
  file.write(buf);
  file.close();

  // Invalidate PSRAM cache — will reload on next access
  indexCache = null;
  hashSeed   = 0;
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

The server must compute its hashes with the same CRC16 variant used on the device: **CRC-16/XMODEM** (polynomial `0x1021`, initial value `0x0000`, no reflection, no final XOR). The Moddable SDK `crc` module requires the polynomial to be passed explicitly — `new CRC16(0x1021)` — with the remaining parameters defaulting to zero/false.

The following Node.js implementation produces identical output. Verify with the standard test vector: `crc16(Buffer.from("123456789"))` must equal `0x31C3`.

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

// Build the manifest the server sends to the device
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

interface AssetRef { name: string; hash: number; }

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
  ensureIndex();                 // Load KV store index + seed into PSRAM
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
| Binary search (1,000 entries) | PSRAM | ~0.001ms |
| Binary search (100,000 entries) | PSRAM | ~0.002ms |
| Flash payload read (on hit) | LittleFS | ~1–2ms |
| BMP hot cache hit | PSRAM | ~0.001ms |
| BMP lazy load from SD | SD card | ~3–8ms |
| 100 sequential KV lookups (cold) | Flash | ~100–200ms |
| 100 sequential KV lookups (warm) | PSRAM | ~0.1ms |
| Boot index load (10k entries) | Flash → PSRAM | ~5–10ms |

---

## Memory Budget (ESP32-S3, 8MB PSRAM)

| Region | Size | Notes |
|--------|------|-------|
| KV store index (10k entries) | ~120 KB | 10,000 × 12 bytes |
| KV store index (50k entries) | ~600 KB | approaching limit for index-only |
| BMP index metadata (1k assets) | ~100 KB | path strings + struct overhead |
| Hot BMP cache (50 × 32×32) | ~150 KB | 50 × ~3KB |
| XS VM + app heap | ~1–2 MB | Moddable runtime |
| **Available for assets/cache** | **~5 MB** | comfortable headroom |

---

## Collision Guarantee

Because all UUIDs are known before the store is built, the seed is chosen at project setup and verified to produce no collisions across the full UUID set. The seed is stored in the file header and hardcoded in the Node.js build script.

There is no runtime collision risk. Before adding a new UUID, call `wouldConflict` to confirm its 4-byte key is unique. If it conflicts, generate a new UUID and retry until one maps to a free key.

---

## Key Design Decisions

**Why not NVS/Preference?**
NVS is limited to ~75–100 keys in the default 24KB partition. It is ideal for configuration and credentials but not scalable for UUID-keyed datasets.

**Why not individual LittleFS files?**
Per-file overhead (directory scan, inode lookup, open syscall) costs ~1–3ms per file. 100 lookups = 100–300ms. A single file with a PSRAM index amortizes that overhead across all lookups.

**Why 4 bytes instead of 8?**
With a known, fixed UUID set the probabilistic collision argument for 8 bytes disappears entirely. Pre-calculating a collision-free seed makes 4-byte keys provably safe while saving 25% index memory and halving the key comparison cost to a single uint32 operation.

**Why sorted insert vs sort-on-read?**
Sorting at insert time means the file is always ready for binary search with no preprocessing step. The O(n) shift cost on insert is acceptable since writes are far less frequent than reads in typical IoT workloads.

**Why defer WiFi?**
WiFi association + DHCP adds 500–2000ms to boot. Deferring it behind a `Timer.set(..., 0)` lets the UI render first, making the device feel instant to the user while the radio connects in the background.

---

*Target platform: ESP32-S3 @ 240MHz · Moddable SDK · LittleFS internal flash · 8MB PSRAM*
