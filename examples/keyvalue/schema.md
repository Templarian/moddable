# Schema Examples

See [format](./format.md) for entity schemas and entity data is stored. Below are examples.

## Schema Components

### Name

Most entities will have a name assigned. These are restricted to 32 characters.

```json
{
    "id": "551fda63",
    "name": "name",
    "schema": [
        ["name", "s32"]
    ],
    "version": 1
}
```

### Item Properties

```json
{
    "id": "3b46e62a",
    "name": "item.cost",
    "schema": [
        ["cost", "i8"]
    ],
    "version": 1
}
```

```json
{
    "id": "6f2cb1eb",
    "name": "item.weight",
    "schema": [
        ["weight", "i8"]
    ],
    "version": 1
}
```

### Book

```json
{
    "id": "3fef10e5",
    "name": "book.short",
    "schema": [
        ["content", "s128"]
    ],
    "version": 1
}
```

### Scripts

```jsonc
{
    "id": "a6949fd4", // not returned from server
    "name": "script.enter.s128",
    "schema": [
        ["script", "s128", {
            "required": true,
            "cache": false
        }]
    ],
    "version": 1
}
```

### Images

Images requested from the server contain a `data` property. While the `data` property is never stored in the entity after inserting into the atlas the `x`, `y`, `width`, and `height` are updated.

```jsonc
{
    "id": "00000001",
    "name": "image",
    "schema": [
        ["x", "i8"],
        ["y", "i8"],
        ["width", "i8"],
        ["height", "i8"]
    ],
    "version": 1
}
```

### Tiles

```jsonc
{
    "id": "2ba24965",
    "name": "tile",
    "schema": [
        ["north", "ref", { "ref": "2ba24965" }],["east", "ref", { "ref": "2ba24965" }],
        ["south", "ref", { "ref": "2ba24965" }],
        ["west", "ref", { "ref": "2ba24965" }]
    ],
    "version": 1
}
```

```jsonc
{
    "id": "50702a62",
    "name": "tile.ground",
    "schema": [
        ["ground", "ref", { "ref": "00000001" }]
    ],
    "version": 1
}
```

### States

```jsonc
{
    "id": "9e1ea094", // not returned from server
    "name": "state.number",
    "schema": [
        ["value", "i8", { "required": true }]
    ],
    "version": 1
}
```

## Schema Data

### Items

```json
{
    "e202ea5b": {
        // name
        "551fda63": [
            "Small Health Potion"
        ],
        // item.cost
        "3b46e62a": [2],
        // item.weight
        "6f2cb1eb": [1],
        "a6949fd4": [
            "/* large script */"
        ]
    },
    "e65c0edd": {
        // name
        "551fda63": {
            "name": "Door Note"
        },
        // book.short
        "3fef10e5": [
            "Taking an order east out of town. Will be back shortly."
        ]
    }
}
```

### Tiles

```jsonc
{
    "6376726b": {
        "00000001": [0, 0, 20, 40]
    },
    "2587b3a8": {
        "2ba24965": [
            "937cca2c",
            "00000000",
            "00000000",
            "00000000"
        ]
    },
    "937cca2c": {
        "2ba24965": [
            "00000000",
            "00000000",
            "2ba24965",
            "00000000"
        ],
        "50702a62": ["6376726b"]
    }
}
```
