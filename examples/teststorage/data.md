# data.ts — How to Use

`data.ts` is a TypeScript library implementing the entity/state storage design from [`STORAGE.md`](../../STORAGE.md) and [`storageIdea.md`](storageIdea.md): entities keyed by an 8 hex character server id, indexed by a PSRAM-cached hash table over a single LittleFS file.

**Status:** implemented but not yet wired into [`main.js`](main.js) — that's waiting on the server endpoints (`GET /key/<hex>`) being available to test against.

---

## Setup

```sh
cd examples/teststorage
npm install
npm run build
```

`npm run build` runs `tsc` per [`tsconfig.json`](tsconfig.json) and emits `dist/data.js` (plus a `.d.ts` and sourcemap). Nothing in `manifest.json` references it yet — when it's time to wire this in, add `file` and `crc` module includes (`$(MODULES)/files/file/manifest.json` and `$(MODULES)/data/crc/manifest.json`) so the on-device `"file"` and `"crc"` imports resolve, and point `main.js` at `dist/data.js`.

---

## Mental Model

- **Entities** are JSON objects keyed by an 8 hex character id (`createEntity()` in `storageIdea.md`). They live in one file, `/store/data.bin`, as `HEADER | INDEX (hash table) | DATA (payloads)`.
- **State names** (`"player.health"` → `"eb7cb92e"`) can also number in the thousands over time, so they get the same treatment: `/store/state.bin` is `HEADER | INDEX (hash table) | DATA (append-only [len][name][id] records)`. The index is keyed by a hash of the name (not the name itself, which is variable-length), so a lookup hit reads its record back to confirm the name actually matches before trusting the id — see "State names" below.
- Both indexes are small enough to keep fully in PSRAM (12 bytes/entity, 10 bytes/name); only payloads and name records are read from flash on demand. Resolved state names are also cached in memory, so a given name only ever costs one flash read per session.
- The device never computes an entity's `hash` — the server sends it in every `GET /key/<hex>` response, and the device only ever stores or verifies it.

See `STORAGE.md` for the full rationale (why a hash table instead of sorted binary search, id-collision considerations, etc.) — this document is just the API surface.

---

## Typical Flow

```typescript
import * as store from "./data.js";

// 1. First boot: create empty stores sized for what you expect to hold.
if (!store.storeExists()) {
	store.initStore(10_000);
}
if (!store.stateStoreExists()) {
	store.initStateStore(500);
}
store.ensureIndex();      // cheap no-op on later calls
store.ensureStateIndex(); // same

// 2. Resolve a state name to its entity.
const health = store.getState("player.health");

// 3. Or fetch by id directly once you have one (e.g. from a "ref" field).
const tile = store.getEntity("44e469ae");

// 4. Write an entity as it comes back from the server.
//    GET /key/<hex> -> { hash, data }
const response = await fetchEntity("eb7cb92e"); // your own server call
store.putEntity("eb7cb92e", response.data, response.hash);

// 5. Point a state name at an entity id.
store.setStateId("player.health", "eb7cb92e");

// 6. Periodically reclaim space from overwritten entities. State updates
//    never orphan bytes, so its store only needs compacting to grow headroom.
const stats = store.getStats();
if (stats.loadFactor > 0.6) store.compact();
```

---

## API Reference

### Store lifecycle

| Function | Description |
|---|---|
| `storeExists(): boolean` | Whether `/store/data.bin` exists yet. |
| `initStore(expectedEntityCount, loadFactor?)` | Creates a fresh, empty store sized with headroom for `expectedEntityCount`. **Overwrites** any existing store. |
| `ensureIndex(): void` | Loads the header + hash table into PSRAM. Throws if the store hasn't been initialized. Cheap to call repeatedly — only reads flash once. |
| `getStats(): { entryCount, tableSize, loadFactor }` | Introspection — use `loadFactor` to decide when to `compact()`. |

### Entities

| Function | Description |
|---|---|
| `getEntity(id: string): Entity \| null` | Hash-table lookup + single flash read + `JSON.parse`. `null` if not present. |
| `putEntity(id: string, data: Entity, hash?: number): void` | Appends the payload and updates that entity's index slot in place. `hash` should normally come from the server's `GET /key/<hex>` response. If omitted, it's computed on-device with the Moddable SDK's native `crc` module (`CRC16(0x1021)`) — useful for locally-authored entities with no server round trip. Updating an existing id leaves its old payload bytes behind; see `compact()`. |
| `verifyEntity(id: string): boolean` | Re-reads the payload and checks its `crc16` against the stored hash. A corruption check, not part of the normal read path. |
| `lookupEntity(id: number): LookupResult \| null` | Lower-level: hash-table lookup only (offset/length/hash), no flash read. Takes a numeric id — use `idToNumber()` if you have a hex string. |

### Bulk build / maintenance

| Function | Description |
|---|---|
| `buildStore(entries: StoreEntry[], loadFactor?)` | Rebuilds the store from scratch from a full batch (e.g. an initial bulk sync). **Discards** whatever was there before. |
| `compact(expectedEntityCount?, loadFactor?)` | Rebuilds the store from its currently-live entries, reclaiming bytes orphaned by `putEntity()` overwrites. Pass `expectedEntityCount` to grow headroom for future entities; otherwise it's sized to the current live count. |

Call `compact()` periodically (e.g. when `getStats().loadFactor` climbs, or on a maintenance timer) — `putEntity()` alone never reclaims space from updated entities.

### State names

| Function | Description |
|---|---|
| `stateStoreExists(): boolean` | Whether `/store/state.bin` exists yet. |
| `initStateStore(expectedNameCount, loadFactor?)` | Creates a fresh, empty state store sized with headroom for `expectedNameCount`. **Overwrites** any existing state store. |
| `ensureStateIndex(): void` | Loads the header + hash table into PSRAM. Throws if the state store hasn't been initialized. |
| `getStateStats(): { entryCount, tableSize, loadFactor }` | Introspection — use `loadFactor` to decide when to `compactStateStore()`. |
| `getStateId(name: string): string \| null` | Looks up a state name's entity id: in-memory cache first, then a hash-table probe (average one flash read) on a miss. |
| `setStateId(name: string, id: string): void` | Points a state name at an entity id. Updating an existing name overwrites its 8 id bytes in place — record length can't change once the name is fixed, so this never orphans bytes. |
| `getState(name: string): Entity \| null` | `getStateId` + `getEntity` in one call. |
| `compactStateStore(expectedNameCount?, loadFactor?)` | Rebuilds the state store from its live entries. Only needed to grow the table's headroom — `setStateId` updates never waste space, unlike `putEntity`. |

Name lookups are cached in memory the first time they resolve (`getStateId`/`getState`), so repeat access for the same name never touches flash again in that session — the cache isn't bounded, since it only grows with names actually looked up, not the full name set.

### Utilities

| Function | Description |
|---|---|
| `idToNumber(id: string): number` | Hex string → uint32, for the lower-level `lookupEntity`. |
| `idToHex(id: number): string` | uint32 → zero-padded 8 hex character string. |
| `canonicalStringify(value: unknown): string` | Key-sorted JSON stringify — must match the server's canonical form exactly. |
| `crc16(text: string): number` | CRC-16/XMODEM, matching the Moddable SDK `crc` module and the server's build tooling. |
| `nextTableSize(entryCount, loadFactor?): number` | The sizing formula `initStore`/`buildStore`/`compact` use internally, exposed in case you want to pre-check table size for a given entity count. |

---

## Notes

- **Ids are hex strings at the API boundary** (`"eb7cb92e"`), matching how they appear everywhere else in the schema/state JSON — conversion to the internal `uint32` happens inside the library.
- **Pass `hash` to `putEntity` whenever you have it** — it exists so the device doesn't have to re-derive what the server already computed. Leaving it out falls back to an on-device CRC16 computation (see the API table), which is fine for local/test data but means an extra native call on every write.
- **No delete API.** Removing an entity isn't part of the current design (`storageIdea.md` doesn't define tombstones or reference-cleanup semantics) — revisit this once that's needed.
- **State names are capped at 255 characters** — the on-disk record format uses a single length-prefix byte. `setStateId` throws if you exceed it.
