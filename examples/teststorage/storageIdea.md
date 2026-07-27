
# Storage Ideas

On the microcontroller there is very minimal ram.

All entities are referenced via a 8 character hex. The microcontroller stores.

## Entity Objects and Schemas

All data is stored in entities.

```json
{
    "00000000": { "e67e14e5": { "name": "Character Name" }, "1b6614d2": { "tile": "87679768" } },
    "1b6614d2": { "name": "player.tile", "schema": { "tile": { "type": "ref", "ref": "2ba24965" } } },
    "2ba24965": { "name": "tile", "schema": { "north": { "type": "ref", "ref": "2ba24965" }, "east": { "type": "ref", "ref": "2ba24965" }, "south": { "type": "ref", "ref": "2ba24965" }, "west": { "type": "ref", "ref": "2ba24965" } } },
    "e67e14e5": { "name": "identity", "schema": { "name": { "type": "string", "required": true } } },
    "87679768": { "2ba24965": { "south": "3d341612" } },
    "3d341612": { "2ba24965": { "north": "87679768" } },
    "6571ae89": { "name": "tile.ground", "schema": { "resource": { "type": "string", "required": true } } },
    "9f3a1c02": { "name": "state.quest", "schema": { "value": { "type": "enum", "enumValues": ["started", "completed"] } } },
    "a4c81f06": { "name": "state.string", "schema": { "value": { "type": "string", "required": true } } },
    "564f1799": { "name": "state.number", "schema": { "value": { "type": "i8", "required": true } } },
    "eb7cb92e": { "564f1799": { "value": 100 } },
    "b2e5f719": { "9f3a1c02": { "value": 1 } }
}
```

State names mapped to entities storage.

```json
{
    "player.health": "eb7cb92e",
    "quest.city.rat": "b2e5f719"
}
```