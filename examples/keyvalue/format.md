# Storage Arrays

## Schema Entity

Schema entities are referenced via a 8 character hex string. They can be thought of like components in an ECS.

- name - schema name
  - Array of properties
    - name
    - type - determines what other properties can be defined.
      - Normal types - `default` value
      - `ref` - Reference entity 
      - `enum` - List of enums
- version

In JSON this looks like:

```json
{
    "00000000": {
        "name": "image",
        "schema": {
            "x": { "type": "i8" },
            "y": { "type": "i8" },
            "width": { "type": "i8" },
            "height": { "type": "i8" }
        },
        "version": 1
    }
}
```

| Type | Storage | Notes |
|---|---|---|
| `u8` `u16` `u32` | `Uint8/16/32Array` | Integers, range-checked on write |
| `i8` `i16` `i32` | `Int8/16/32Array` | Integers, range-checked on write |
| `f32` `f64` | `Float32/64Array` | Any number |
| `bool` | `Uint8Array` | Round-trips as `true`/`false` |
| `enum` | `Uint8Array` | Values interned as index into `values` (max 255 values); reads back as the string |
| `ref` | `Uint32Array` | Entity id; target must be alive, and carry `ref` if set |
| `s32` `s64` `s128` `s256` `s512` `s1024` | `Uint8Array` | Fixed-width UTF-8 buffer, zero-padded; writes longer than the byte width are truncated |

## Entity

Since every property type now has a fixed byte width, a component's body length is fully determined by its schema (`sum` of its properties' widths, in declared order) — no length prefix is needed, only the schema id to know how to decode it.

Byte layout:

```
[entity id: u32]
[component count: u8]
  for each component:
    [schema id: u32]
    [properties, packed back-to-back in schema-declared order, each using its type's fixed width]
```

Worked example, using the `image` schema (`00000000`) from above — `x`, `y`, `width`, `height` are all `i8` (1 byte each), so the component body is 4 bytes:

| Bytes | Value | Meaning |
|---|---|---|
| `01 00 00 00` | entity id `00000001` | |
| `01` | `1` | component count |
| `00 00 00 00` | schema id `00000000` | |
| `00` | `x = 0` | |
| `00` | `y = 0` | |
| `0C` | `width = 12` | |
| `0C` | `height = 12` | |

13 bytes total, vs. the JSON equivalent below. A reader just looks up schema `00000000`, replays its property list in order, and slices the fixed widths off the buffer — no keys, no delimiters.

In JSON entities could be viewed like:

```json
{
    "00000001": {
        "00000000": {
            "x": 0,
            "y": 0,
            "width": 12,
            "height": 12
        }
    }
}
```

When getting a entity by the key the data is normalized. 

```typescript
const result = storage.get('00000001');
// { image: { x: 0, y: 0, width: 12, height: 12 } }
```
