
# Storage Ideas

On the microcontroller there is very minimal ram.

All entities are referenced via a 8 character hex.

## Entity Objects and Schemas

The entities are stored in a key value pair and recieved as required from a server request. 

Keys pulled from the server will always include a "hash" property with a CRC16 number.

**Note:** Entities are stored in flash or the SD card.

## Schema Types

Entities can be grouped into two types:
- Schema entities, these define a name and properties with data types.
  - Type data is used by storage to allocate space for the values.
- Data entities, these store references to schema entities and define types.

| Type | Storage | Notes |
|---|---|---|
| `u8` `u16` `u32` | `Uint8/16/32Array` | Integers, range-checked on write |
| `i8` `i16` `i32` | `Int8/16/32Array` | Integers, range-checked on write |
| `f32` `f64` | `Float32/64Array` | Any number |
| `bool` | `Uint8Array` | Round-trips as `true`/`false` |
| `enum` | `Uint8Array` | Values interned as index into `enumValues` (max 255 values); reads back as the string |
| `ref` | `Uint32Array` | Entity id; target must be alive, and carry `refComponent` if set |
| `string` | plain array | The only non-packed field type |

## Example Entities

```json
{
    "1b6614d2": { "name": "state.tile", "schema": { "value": { "type": "ref", "ref": "2ba24965" } } },
    "2ba24965": { "name": "tile", "schema": { "north": { "type": "ref", "ref": "2ba24965" }, "east": { "type": "ref", "ref": "2ba24965" }, "south": { "type": "ref", "ref": "2ba24965" }, "west": { "type": "ref", "ref": "2ba24965" } } },
    "e67e14e5": { "name": "identity", "schema": { "name": { "type": "string", "required": true } } },
    "87679768": { "2ba24965": { "south": "3d341612" } },
    "3d341612": { "2ba24965": { "north": "87679768" } },
    "6571ae89": { "name": "tile.ground", "schema": { "resource": { "type": "string", "required": true } } },
    "9f3a1c02": { "name": "state.quest", "schema": { "value": { "type": "enum", "enumValues": ["started", "completed"] } } },
    "a4c81f06": { "name": "state.string", "schema": { "value": { "type": "string", "required": true } } },
    "564f1799": { "name": "state.number", "schema": { "value": { "type": "i8", "required": true } } },
    "17624d1f": { "name": "state.boolean", "schema": { "value": { "type": "boolean", "required": true } } },
    "eb7cb92e": { "564f1799": { "value": 42 } },
    "b2e5f719": { "9f3a1c02": { "value": 1 } },
    "54a938dd": { "a4c81f06": { "value": "Character Name" } },
    "44e469ae": { "1b6614d2": { "value": 87679768 }
}
```

State names mapped to entities storage. Scripts will reference state values by the string and get the normalized object.

```json
{
    "player.name": "54a938dd",
    "player.tile": "44e469ae",
    "player.health": "eb7cb92e",
    "quest.city.rat": "b2e5f719"
}
```

ToDo: Figure out how to quickly store and reference state in flash.

## ESP32 Storage

Lookup table stored as a hash table in flash, sized upfront with headroom for the expected entity count (e.g. 16k-32k slots for 10k+ entities, ~50-65% load factor).

- `serverId` is already uniformly random, so it's used directly as the hash: slot = `serverId mod tableSize`
- Collisions resolved with linear probing
- Empty slots use flash's erased `0xFF` state as the sentinel, no separate valid bit
- Growing the table is a rare, explicit rebuild/compaction step, not part of normal inserts

Record (12 bytes, packed, no alignment padding):

- 32bit, 8 hex character, Id from JSON (Server)
- 32 bit offset
- 16 bit length
- 16bit CRC16 hash of entity data

ToDo: small RAM LRU cache for actively-referenced entities (state.* bindings) to avoid repeated flash probes on hot lookups.

ToDo: entity data blob is append-only; handle updates that change an entity's size via compaction, separate from the index structure.

## Server

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

## JSON Stringify

The server must always calculate the entity CRC16 using:

```typescript
function canonicalStringify(obj) {
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

CRC16 Hash formula that is consistent on device and NodeJS server.

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
```

To generate the 8 character hex key.

```typescript
function createEntity() {
  return ((Math.random() * 0x100000000) >>> 0)
    .toString(16)
    .padStart(8, '0');
}
```
