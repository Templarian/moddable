# Atlas 1bit Image Cache

Requirements

- Only 1 bit image support.
- Images are loaded from the server in entities
- Store images using littlefs into an image

## Image Entity Format

Image entities are treated as a special type as they require special storage for the poco library to quickly reference them during draw calls.

Entity Schema (using `00000000` as an example id).

```json
{
    "00000000": {
        "name": "image",
        "schema": {
            "x": { "type": "i8", "index": 0 },
            "y": { "type": "i8", "index": 1 },
            "width": { "type": "i8", "index": 1 },
            "height": { "type": "i8" }
        },
        "version": 1
    }
}
```

Example Entity coming from the server.

```json
{
    "path": ""
}
```

After an image entity is loaded the `x`, `y`, `width`, and `height` will be set, but the rest is ignored.

```javascript
store.set('00000001', {
    "00000000": {
        x: 0,
        y: 0,
        width: 12,
        height: 12
    }
});
```
