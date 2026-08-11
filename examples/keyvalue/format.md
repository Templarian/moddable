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
| `string` | plain array | The only non-packed field type |

## Entity

ToDo: Write a array byte format that uses schemas.

In JSON entities could be viewed like:

```json
{
    "00000003": {
        "x": 0,
        "y": 0,
        "width": 12,
        "height": 12
    }
}
```