
# Storage Ideas

On the microcontroller there is very minimal ram.

All entities are referenced via a 8 character hex.

## Entity Objects and Schemas

The entities are stored in a key value pair and recieved as required from a server request. 

Keys pulled from the server will always include a "hash" property with a CRC16 number.

**Note:** Entities are stored in flash or the SD card.

```json
{
    "00000000": { "e67e14e5": { "name": "Character Name" }, "1b6614d2": { "tile": "87679768" } },
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

State names mapped to entities storage.

```json
{
    "player.name": "54a938dd",
    "player.tile": "44e469ae",
    "player.health": "eb7cb92e",
    "quest.city.rat": "b2e5f719"
}
```

## ESP32 Storage

To make data access faster across entities the lookup table uses a sequential id locally on the device linked to the server's 8 character hex id.

- 16bit Sequential Index (Local)
- 16bit, 8 hex character, Id from JSON (Server)
- 16bit CRC16 hash of entity data

ToDo: decide if storing offset and length here would make storage of entity data fast.

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
