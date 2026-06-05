# Best Practices: TypeScript / C Bindings in Moddable

This guide is written for TypeScript developers who are new to C. It covers how the Moddable SDK connects TypeScript/JavaScript APIs to C implementations using the XS JavaScript engine, and how TypeScript types are written to describe those bindings accurately.

---

## Table of Contents

1. [Why TS/C Bindings Exist](#1-why-tsc-bindings-exist)
2. [The Three-File Pattern](#2-the-three-file-pattern)
3. [Declaring C Bindings in JavaScript](#3-declaring-c-bindings-in-javascript)
4. [Writing the Declaration File (.d.ts)](#4-writing-the-declaration-file-dts)
5. [Naming Conventions](#5-naming-conventions)
6. [C Function Signature](#6-c-function-signature)
7. [TypeScript Types → C Types](#7-typescript-types--c-types)
8. [Reading Arguments in C](#8-reading-arguments-in-c)
9. [Returning Values from C](#9-returning-values-from-c)
10. [The HostBuffer Type](#10-the-hostbuffer-type)
11. [The ByteBuffer Type](#11-the-bytebuffer-type)
12. [Binary Data: ArrayBuffer and TypedArrays](#12-binary-data-arraybuffer-and-typedarrays)
13. [Generic Return Types with Conditional Types](#13-generic-return-types-with-conditional-types)
14. [Throwing Errors from C](#14-throwing-errors-from-c)
15. [Stateful Objects: Storing C Data on a TS Instance](#15-stateful-objects-storing-c-data-on-a-ts-instance)
16. [Destructors: Cleaning Up C Resources](#16-destructors-cleaning-up-c-resources)
17. [Getters and Setters](#17-getters-and-setters)
18. [Static Methods](#18-static-methods)
19. [Callback Types](#19-callback-types)
20. [The `private brand` Pattern](#20-the-private-brand-pattern)
21. [The `Native()` Base Class Pattern](#21-the-native-base-class-pattern)
22. [The Manifest: Wiring JS and C Together](#22-the-manifest-wiring-js-and-c-together)
23. [tsconfig Setup](#23-tsconfig-setup)
24. [Module Directory Structure](#24-module-directory-structure)
25. [Complete Examples](#25-complete-examples)
26. [Quick Reference Card](#26-quick-reference-card)

---

## 1. Why TS/C Bindings Exist

JavaScript and TypeScript on microcontrollers have strict limits: no dynamic memory allocation, small stacks, and tight CPU budgets. Some operations — hardware I/O, file access, cryptography, math-intensive calculations — must run at native speed or require direct access to hardware registers.

The XS JavaScript engine lets you write the public-facing API in TypeScript and implement the performance-critical or hardware-dependent parts in C. The result is a module that **looks like normal TypeScript** to callers but **runs C code** internally.

TypeScript adds a third layer: **declaration files** (`.d.ts`) describe the shape of the C-backed module so the TypeScript compiler can type-check code that uses it, provide autocomplete, and catch mistakes before runtime.

---

## 2. The Three-File Pattern

Most C-backed Moddable modules consist of three files:

```
modules/files/file/
├── file.js          ← JS with @ or native() bindings (runtime)
├── win/modFile.c    ← C implementation (platform-specific)
└── manifest.json    ← build config

typings/
└── file.d.ts        ← TypeScript declaration (authoring time only)
```

The `.d.ts` file is **never compiled or run** — it only exists to give the TypeScript compiler type information about what the C-backed `.js` module exports. If there is no `.d.ts`, TypeScript treats the import as `any`.

---

## 3. Declaring C Bindings in JavaScript

The `.js` file tells the runtime which C function to call. There are two syntaxes.

### The `@` syntax (classes)

```js
export class File @ "xs_file_destructor" {
    constructor(dictionary) @ "xs_File";
    read(type, count)      @ "xs_file_read";
    close()                @ "xs_file_close";
    get length()           @ "xs_file_get_length";
    set position(v)        @ "xs_file_set_position";
    static delete(path)    @ "xs_file_delete";
}
```

The string after `@` is the exact name of the C function to call. The string after `class Name @` is the **destructor** — called automatically when the garbage collector reclaims the object.

### The `native()` syntax (static methods and standalone functions)

```js
class Timer {
    static set(callback, delay, repeat) {
        return native("xs_timer_set").call(this, callback, delay, repeat);
    }
}

function deepEqual(a, b, options) @ "fx_deepEqual";
```

---

## 4. Writing the Declaration File (.d.ts)

Every C-backed module should have a `.d.ts` file in the `typings/` directory. Use `declare module "module-name"` to describe the public API.

```typescript
// typings/file.d.ts
declare module "file" {
    export class File {
        constructor(path: string, write?: boolean);
        read<T extends typeof ArrayBuffer | typeof String>(
            type: T,
            bytes?: number
        ): T extends typeof String ? string : InstanceType<T>;
        write(value: ArrayBufferLike | string, ...more: (ArrayBuffer | string)[]): void;
        close(): void;
        readonly length: number;
        position: number;
        static delete(path: string): boolean;
        static exists(path: string): boolean;
        static rename(from: string, to: string): boolean;
    }
}
```

The module name in `declare module "file"` must exactly match the import path used in `.ts` files:

```typescript
import { File } from "file";
```

For `embedded:` modules, the module name includes the full path:

```typescript
declare module "embedded:io/digital" {
    class Digital { /* ... */ }
    export default Digital;
}
```

---

## 5. Naming Conventions

C function names must be unique across the entire build. Moddable uses a consistent prefix scheme.

### Pattern: `xs_<module>_<method>`

| TypeScript | C function name |
|---|---|
| `class File` — constructor | `xs_File` |
| `class File` — destructor | `xs_file_destructor` |
| `file.read()` | `xs_file_read` |
| `file.write()` | `xs_file_write` |
| `file.close()` | `xs_file_close` |
| `get file.length` | `xs_file_get_length` |
| `set file.position` | `xs_file_set_position` |
| `File.delete()` static | `xs_file_delete` |
| `Timer.set()` static | `xs_timer_set` |
| `Timer.clear()` static | `xs_timer_clear` |
| standalone `deepEqual()` | `fx_deepEqual` |

### Rules

- Prefix: `xs_` followed by the **lowercase** module name.
- Constructor: capitalize the class name — `xs_File`, `xs_File_Iterator`.
- Getter: append `_get_` — `xs_file_get_length`.
- Setter: append `_set_` — `xs_file_set_position`.
- Destructor: always end in `_destructor` — `xs_file_destructor`.
- IO class pattern: trailing underscore avoids reserved name clashes — `xs_analog_constructor_`, `xs_analog_read_`.
- Legacy engine functions use `fx_` instead of `xs_` — `fx_deepEqual`.

---

## 6. C Function Signature

Every C function bound to TypeScript/JavaScript has the **exact same signature**:

```c
void xs_my_function(xsMachine *the)
```

- `void` — C functions never return a value directly. Results go through `xsResult` (see section 9).
- `xsMachine *the` — a pointer to the JavaScript engine state. Nearly every XS macro requires `the` to be in scope with exactly this name. Do not rename it.

---

## 7. TypeScript Types → C Types

This is the core of the binding. Every TypeScript type the caller passes or receives maps to a specific C type and XS conversion macro.

### Integer types

TypeScript has one `number` type for both integers and floats. C distinguishes them and also distinguishes size.

| TypeScript | C type | XS macro | Notes |
|---|---|---|---|
| `number` (whole) | `int32_t` | `xsmcToInteger()` | Safe for counts, indices, ms intervals |
| `number` (whole, large) | `uint32_t` | `xsmcToInteger()` | Sizes, lengths — can't be negative |
| `number` (float) | `double` | `xsmcToNumber()` | Prefer for any fractional value |
| `number` (tiny value 0–255) | `uint8_t` | `xsmcToInteger()` | Pixel channel, byte value |
| `number` (0–65535) | `uint16_t` | `xsmcToInteger()` | Pixel coordinates, port numbers |
| `0 \| 1` (literal union) | `uint8_t` | `xsmcToInteger()` | Pin high/low, GPIO write values |

**Why not just `int` everywhere?** On some microcontroller architectures, C's `int` is only 16 bits. Using `int32_t` and `uint32_t` guarantees the exact size regardless of platform. When you type a TS parameter as `number`, you're mapping to whatever size makes sense — which the C implementer decides.

### Boolean

| TypeScript | C type | XS macro |
|---|---|---|
| `boolean` | `uint8_t` | `xsmcToBoolean()` |

C has no true boolean. The convention is `uint8_t` with `0` = false and `1` = true. TypeScript's `boolean` maps cleanly.

### String

| TypeScript | C type | XS macro |
|---|---|---|
| `string` | `char *` | `xsmcToString()` |

`char *` in C is a pointer to a sequence of bytes ending with `\0` (null terminator). The pointer returned by `xsmcToString()` is **temporary** — it points into the engine's memory and may be moved by the garbage collector. In C, copy it before doing anything else if you need to keep it.

### Binary data

| TypeScript | C type | XS macro |
|---|---|---|
| `ArrayBuffer` | `void *` + `uint32_t` length | `xsmcToArrayBuffer()` / `xsmcGetArrayBufferLength()` |
| `Uint8Array` | `uint8_t *` | `xsmcGetBufferReadable()` |
| `ByteBuffer` (see section 11) | `void *` | `xsmcGetBufferReadable()` |
| `HostBuffer` (see section 10) | `void *` | `xsmcGetBufferReadable()` |

### Objects and option bags

| TypeScript | C approach |
|---|---|
| `{ key: string; value: number }` | Read properties with `xsmcGet(slot, xsArg(0), xsID("key"))` |
| callback `(x: number) => void` | Store as `xsmcToReference()`, call with `xsCallFunction*` |
| class instance | Store/retrieve C pointer via `xsmcSetHostData` / `xsmcGetHostData` |

### void / undefined

| TypeScript | C |
|---|---|
| `void` return | Don't set `xsResult` (defaults to `undefined`) |
| `undefined` return | `xsmcSetUndefined(xsResult)` |

### Complete mapping table

```
TypeScript                C type          XS conversion
─────────────────────────────────────────────────────────────
number (integer)          int32_t         xsmcToInteger(xsArg(n))
number (unsigned)         uint32_t        xsmcToInteger(xsArg(n))
number (float)            double          xsmcToNumber(xsArg(n))
boolean                   uint8_t         xsmcToBoolean(xsArg(n))
string                    char *          xsmcToString(xsArg(n))
ArrayBuffer               void *          xsmcToArrayBuffer(xsArg(n))
Uint8Array/ByteBuffer     void *          xsmcGetBufferReadable(xsArg(n), &ptr, &len)
HostBuffer                void *          xsmcGetBufferReadable(xsArg(n), &ptr, &len)
0 | 1                     uint8_t         xsmcToInteger(xsArg(n))
any object                xsSlot          xsmcGet(slot, xsArg(n), xsID("prop"))
callback function         xsSlot *        xsmcToReference(xsArg(n))
```

---

## 8. Reading Arguments in C

Arguments passed from TypeScript are accessed by index using `xsArg(n)`, where `n` is zero-based.

```c
void xs_file_read(xsMachine *the)
{
    int argc = xsmcArgc;                     // total argument count
    int32_t count = xsmcToInteger(xsArg(1)); // second argument as integer
    // ...
}
```

### Checking argument count for optional parameters

TypeScript's `?` optional parameters map directly to a C `argc` check:

```typescript
// TypeScript declaration
static set(callback: TimerCallback, interval?: number, repeat?: number): Timer;
```

```c
// C implementation
void xs_timer_set(xsMachine *the)
{
    int argc = xsmcArgc;
    int interval = (argc > 1) ? xsmcToInteger(xsArg(1)) : 0;
    int repeat   = (argc > 2) ? xsmcToInteger(xsArg(2)) : 0;
    createTimer(the, interval, repeat);
}
```

### Reading an options object

TypeScript `{ pin: number; mode: Mode }` option bags are read property-by-property:

```c
void xs_digital_constructor(xsMachine *the)
{
    xsmcVars(1);
    xsmcGet(xsVar(0), xsArg(0), xsID_pin);
    int pin = xsmcToInteger(xsVar(0));

    xsmcGet(xsVar(0), xsArg(0), xsID_mode);
    int mode = xsmcToInteger(xsVar(0));
    // ...
}
```

`xsID_pin` and `xsID_mode` are integer constants defined in the auto-generated `mc.xs.h` — they're faster than string lookups.

### Checking argument type before converting

When TypeScript uses a union type like `string | ArrayBuffer`, the C code must check before converting:

```c
// TypeScript: encode(source: ByteBuffer | string): string
void xs_base64_encode(xsMachine *the)
{
    xsType srcType = xsmcTypeOf(xsArg(0));

    if (xsStringType == srcType) {
        char *str = xsmcToString(xsArg(0));
        uint32_t len = c_strlen(str);
        // handle string...
    }
    else {
        void *buf;
        uint32_t len;
        xsmcGetBufferReadable(xsArg(0), &buf, &len);
        // handle buffer...
    }
}
```

Common `xsType` values:

| xsType constant | TypeScript equivalent |
|---|---|
| `xsUndefinedType` | `undefined` |
| `xsNullType` | `null` |
| `xsBooleanType` | `boolean` |
| `xsIntegerType` | `number` (integer) |
| `xsNumberType` | `number` (float) |
| `xsStringType` | `string` |
| `xsReferenceType` | object / array / function |

---

## 9. Returning Values from C

Set `xsResult` to the value to return. If you don't set it, the function returns `undefined`.

```c
void xs_time_ticks(xsMachine *the)
{
    xsmcSetNumber(xsResult, (double)millis());
}
```

### Result setter macros

| TypeScript return type | C macro |
|---|---|
| `number` (integer) | `xsmcSetInteger(xsResult, value)` |
| `number` (float) | `xsmcSetNumber(xsResult, value)` |
| `boolean` | `xsmcSetBoolean(xsResult, value)` |
| `string` (from C string) | `xsmcSetString(xsResult, ptr)` |
| `string` (from buffer) | `xsResult = xsStringBuffer(ptr, length)` |
| `ArrayBuffer` | `xsmcSetArrayBuffer(xsResult, ptr, length)` |
| `{ [key]: value }` object | `xsmcSetNewObject(xsResult)` then `xsmcSet(...)` |
| `void` / `undefined` | omit or `xsmcSetUndefined(xsResult)` |

---

## 10. The HostBuffer Type

`HostBuffer` is a Moddable-specific type that has **no standard JavaScript equivalent**. It represents a buffer backed directly by C memory — not the JavaScript heap.

```typescript
// xs.d.ts (global, always available)
declare class HostBuffer {
    readonly byteLength: number;
    private brand: boolean;
}
```

**Why does it exist?** On microcontrollers, the JavaScript heap is small and fragmented. Some C code (flash memory, display framebuffers, DMA buffers) needs to expose large binary blobs that live in specific memory regions outside the JS heap. `HostBuffer` is opaque — you can't read or write it directly from TypeScript, only pass it to other C-backed APIs.

```typescript
// Flash.map() returns a HostBuffer pointing to flash memory
const map: HostBuffer = flash.map();

// Pass it to another C-backed function — that C code can read the raw bytes
neopixel.write(map);
```

From C, a `HostBuffer` is read the same way as `ArrayBuffer`:

```c
void *ptr;
uint32_t len;
xsmcGetBufferReadable(xsArg(0), &ptr, &len);
```

---

## 11. The ByteBuffer Type

`ByteBuffer` is a union type defined globally in `xs.d.ts` that represents every buffer type a C function can accept as raw bytes.

The actual expansion (after TypeScript interface merging of the built-in `ArrayBufferTypes` with the Moddable augmentation) is:

```typescript
// Resolved type — ArrayBuffer is included via interface merging
type ByteBuffer = ArrayBuffer | HostBuffer | Uint8Array | Uint8ClampedArray | Int8Array | DataView;
```

`ByteBuffer` already includes `ArrayBuffer` because `xs.d.ts` augments the built-in `ArrayBufferTypes` interface (which contains `ArrayBuffer`) and `ByteBufferTypes` extends it.

Use `ByteBuffer` in your `.d.ts` when the C implementation calls `xsmcGetBufferReadable()` — this function handles all of the above types transparently.

**Do not use** `ArrayBuffer` alone when the caller might want to pass a `Uint8Array`, `DataView`, or `HostBuffer`. `ArrayBuffer` is the raw backing store; `Uint8Array` is a typed view into it. They are not interchangeable in TypeScript, but all of them work with `xsmcGetBufferReadable` in C.

```typescript
// WRONG — excludes Uint8Array, DataView, HostBuffer
write(data: ArrayBuffer): void;

// CORRECT — ByteBuffer includes ArrayBuffer and all typed views
write(data: ByteBuffer | string): void;
```

---

## 12. Binary Data: ArrayBuffer and TypedArrays

The Moddable XS engine extends several built-in types with extra methods:

```typescript
// Additional ArrayBuffer methods
interface ArrayBuffer {
    concat(...buffers: ArrayBufferLike[]): ArrayBuffer;
}
interface ArrayBufferConstructor {
    fromString(string: string): ArrayBuffer;
    fromBigInt(value: bigint): ArrayBuffer;
}

// Additional Uint8Array methods
interface Uint8Array {
    toHex(): string;
    toBase64(): string;
}
interface Uint8ArrayConstructor {
    fromBase64(base64: string, options?: FromBase64Options): Uint8Array;
    fromHex(string: string): Uint8Array;
}

// Additional String methods
interface StringConstructor {
    fromArrayBuffer(buffer: ArrayBufferLike): string;
}
```

These extensions are backed by C implementations and are always available in the XS environment. They are declared in `xs/includes/xs.d.ts`, which is included globally — you don't need to import them.

### C side: returning an ArrayBuffer

```c
// TypeScript: decode(str: string): ArrayBuffer
void xs_base64_decode(xsMachine *the)
{
    char *src = xsmcToString(xsArg(0));
    uint32_t srcLen = c_strlen(src);
    uint32_t dstLen = (srcLen / 4) * 3;

    xsmcSetArrayBuffer(xsResult, NULL, dstLen);  // allocate empty buffer
    uint8_t *dst = xsmcToArrayBuffer(xsResult);  // get writable pointer
    // decode src into dst...
}
```

---

## 13. Generic Return Types with Conditional Types

Some C-backed APIs return either a `string` or an `ArrayBuffer` depending on a type argument. TypeScript models this with generic conditional types:

```typescript
// file.d.ts
read<T extends typeof ArrayBuffer | typeof String>(
    type: T,
    bytes?: number
): T extends typeof String ? string : InstanceType<T>;
```

This means:
- `file.read(String)` → `string`
- `file.read(ArrayBuffer)` → `ArrayBuffer`

The C implementation checks the runtime type of `xsArg(0)` (the `type` argument) to decide which kind of value to put in `xsResult`:

```c
void xs_file_read(xsMachine *the)
{
    FILE *file = getFile(the);
    int32_t dstLen = xsmcToInteger(xsArg(1));

    // Check whether caller passed String or ArrayBuffer constructor
    xsmcVars(1);
    xsmcGet(xsVar(0), xsGlobal, xsID_String);
    if (xsArg(0).data[2] == xsVar(0).data[2]) {
        xsResult = xsStringBuffer(NULL, dstLen);
        fread(xsmcToString(xsResult), 1, dstLen, file);
    }
    else {
        xsmcSetArrayBuffer(xsResult, NULL, dstLen);
        fread(xsmcToArrayBuffer(xsResult), 1, dstLen, file);
    }
}
```

Use this pattern when:
- The JS `.js` file passes the type constructor as an argument (`read(type, count)`)
- The C code switches on `xsArg(0)` to decide the return type

For simpler APIs where the format is fixed (e.g., always returns `ArrayBuffer`), use a plain return type.

---

## 14. Throwing Errors from C

C functions throw typed JavaScript errors using these macros. Execution stops at the call — equivalent to `throw` in TypeScript.

```c
xsUnknownError("file not found");    // → new Error("file not found")
xsTypeError("expected string");      // → new TypeError("expected string")
xsRangeError("index out of bounds"); // → new RangeError("index out of bounds")
xsReferenceError("already closed");  // → new ReferenceError("already closed")
```

From TypeScript's perspective, these propagate as normal exceptions — `try`/`catch` works as expected.

**Pattern: validate early, throw descriptively**

```c
void xs_File(xsMachine *the)
{
    if (xsmcArgc < 1)
        xsTypeError("path required");

    char *path = xsmcToString(xsArg(0));
    FILE *file = fopen(path, "rb");
    if (!file)
        xsUnknownError("file not found");

    xsmcSetHostData(xsThis, file);
}
```

---

## 15. Stateful Objects: Storing C Data on a TS Instance

When a TypeScript class wraps a resource (file handle, hardware peripheral, network socket), the C implementation stores its state on the JS object using **host data** — a hidden pointer slot.

```typescript
// TypeScript — constructor creates the file, methods use it
const f = new File("/data.txt");
f.read(String, 10);
f.close();
```

```c
// C — store FILE* on the object in the constructor
void xs_File(xsMachine *the)
{
    FILE *file = fopen(xsmcToString(xsArg(0)), "rb");
    if (!file) xsUnknownError("file not found");
    xsmcSetHostData(xsThis, file);  // "this" in TS = xsThis in C
}

// Retrieve it in every method
static FILE *getFile(xsMachine *the)
{
    FILE *f = xsmcGetHostData(xsThis);
    if (!f) xsUnknownError("closed");
    return f;
}

void xs_file_read(xsMachine *the)
{
    FILE *file = getFile(the);
    // ...
}
```

`xsThis` is the C equivalent of TypeScript's `this` inside a method — the object the method was called on.

---

## 16. Destructors: Cleaning Up C Resources

TypeScript (via the garbage collector) reclaims objects automatically. For objects with C-side resources, you must tell the GC how to clean up.

The destructor function is declared on the class line in `.js`:

```js
export class File @ "xs_file_destructor" { ... }
```

The C destructor receives the raw pointer stored via `xsmcSetHostData` — not `xsMachine *the`:

```c
void xs_file_destructor(void *data)
{
    if (data)
        fclose((FILE *)data);  // close the file handle
}
```

**Always null-check `data`** — the destructor is called even if the constructor threw before storing anything.

In the `.d.ts`, there's nothing special to declare for destructors — they're invisible to TypeScript callers. If the class has a `close()` method, declare that instead, since it's the caller-visible way to release resources early:

```typescript
export class File {
    close(): void;  // explicit early release; destructor is the GC safety net
}
```

---

## 17. Getters and Setters

TypeScript getters/setters map to separate C functions.

```typescript
// file.d.ts
readonly length: number;
position: number;
```

```js
// file.js
get length()   @ "xs_file_get_length";
get position() @ "xs_file_get_position";
set position() @ "xs_file_set_position";
```

Getter — reads and sets `xsResult`:

```c
void xs_file_get_length(xsMachine *the)
{
    FILE *file = getFile(the);
    struct stat buf;
    fstat(_fileno(file), &buf);
    xsmcSetInteger(xsResult, (int32_t)buf.st_size);
}
```

Setter — reads the new value from `xsArg(0)`:

```c
void xs_file_set_position(xsMachine *the)
{
    FILE *file = getFile(the);
    fseek(file, xsmcToInteger(xsArg(0)), SEEK_SET);
}
```

`readonly` in TypeScript tells the compiler not to allow assignment — there's no corresponding change in C, just don't declare a setter in `.js`.

---

## 18. Static Methods

Static methods use `native()` in `.js`. Their TypeScript types are declared as `static` properties in the `.d.ts`:

```typescript
// timer.d.ts
class Timer {
    static set(callback: TimerCallback, interval?: number, repeat?: number): Timer;
    static clear(timer: Timer | undefined | null): void;
}
```

```js
// timer.js
class Timer {
    static set(callback, delay, repeat) {
        return native("xs_timer_set").call(this, callback, delay, repeat);
    }
}
```

```c
// modTimer.c
void xs_timer_set(xsMachine *the)
{
    int argc = xsmcArgc;
    int interval = (argc > 1) ? xsmcToInteger(xsArg(1)) : 0;
    int repeat   = (argc > 2) ? xsmcToInteger(xsArg(2)) : 0;
    createTimer(the, interval, repeat);
}
```

---

## 19. Callback Types

Callbacks passed from TypeScript to C must be stored as references and invoked inside an XS host context.

### Declaring callback types in .d.ts

Always give callbacks a named type alias — it makes signatures readable:

```typescript
// timer.d.ts
export type TimerCallback = (timer: Timer) => void;

class Timer {
    static set(callback: TimerCallback, interval?: number): Timer;
}
```

For callbacks that receive `this` as a specific type (common in IO classes), use a `this` parameter:

```typescript
// serial.d.ts
constructor(options: {
    onReadable?: (this: Serial, bytes: number) => void;
    onWritable?: (this: Serial, bytes: number) => void;
    onError?: (this: Serial) => void;
    // ...
});
```

### C side: storing and invoking callbacks

```c
// Store the callback (prevent GC from collecting it)
xsSlot *cb = xsmcToReference(xsArg(0));
xsRemember(someSlot);  // keep alive

// Later, invoke it from a C event handler
xsBeginHost(the);
    xsCallFunction1(xsReference(cb), xsGlobal, someArg);
xsEndHost(the);

// When done, release it
xsForget(someSlot);
```

`xsBeginHost` / `xsEndHost` are required around any JavaScript call made from outside normal JS execution (interrupt handler, timer callback, OS callback). Always pair them.

---

## 20. The `private brand` Pattern

You'll see this in many `.d.ts` files:

```typescript
class Timer {
    private brand: boolean;
}
```

This property doesn't exist at runtime — it's a TypeScript trick called **nominal typing** (or brand checking). Without it, TypeScript uses structural typing, meaning any object with the same shape as `Timer` would be accepted where a `Timer` is expected.

`private brand` makes `Timer` structurally unique — no other class has a `private brand`, so TypeScript rejects imposters:

```typescript
Timer.clear({ brand: true });  // TS error — brand is private to Timer
```

Use this pattern in your `.d.ts` whenever the class wraps a C resource handle. It prevents callers from accidentally passing a plain object where a live handle is required, which would crash the C code.

```typescript
class File {
    private brand: boolean;  // prevents { path: "...", length: 0 } being passed as File
}
```

---

## 21. The `Native()` Base Class Pattern

For IO-style classes, the `.js` uses `Native()` instead of `class @ "destructor"`:

```js
class Analog extends Native("xs_analog_destructor_") {
    constructor(dictionary) {
        super();  // registers the destructor
        native("xs_analog_constructor_").call(this, dictionary);
    }
    read() { return native("xs_analog_read_").call(this); }
}
```

`Native("xs_analog_destructor_")` creates an anonymous base class whose destructor is the named C function. The TypeScript declaration doesn't expose this detail — just declare the class normally:

```typescript
declare module "embedded:io/analog" {
    class Analog {
        constructor(options: { pin: number });
        read(): number;
        close(): void;
        readonly resolution: number;
        readonly format: "number";
    }
    export default Analog;
}
```

TypeScript callers don't need to know about `Native()` — it's an implementation detail of the `.js` file.

---

## 22. The Manifest: Wiring JS and C Together

Each module has a `manifest.json` connecting JS and C for the build system.

```json
{
    "modules": {
        "*": "$(MODULES)/files/file/*"
    },
    "preload": "file"
}
```

- `"modules"` — glob pattern; `*` includes all `.js` and `.c` files in that directory.
- `"preload"` — evaluates the module once at build time and freezes it into the firmware image.

### Platform-specific C implementations

```json
{
    "modules": { "*": "$(MODULES)/files/file/*" },
    "preload": "file",
    "platforms": {
        "esp32": { "modules": { "*": "$(MODULES)/files/file/esp32/*" } },
        "win":   { "modules": { "*": "$(MODULES)/files/file/win/*" } },
        "lin":   { "modules": { "*": "$(MODULES)/files/file/lin/*" } },
        "...":   { "error": "File module unsupported" }
    }
}
```

The TypeScript declaration in `typings/` is shared across all platforms — the `.d.ts` describes the stable public API, not the platform implementation.

---

## 23. tsconfig Setup

Projects using Moddable TypeScript extend the base config via the `@moddable/typings` npm package. The `types` field explicitly opts in to the XS global augmentations (`xs.d.ts`) and the browser-compat globals (`mcpack.d.ts`):

```json
{
    "extends": "@moddable/typings/tsconfig.base.json",
    "compilerOptions": {
        "incremental": true,
        "rootDir": "src",
        "outDir": "dist",
        "sourceMap": true,
        "types": [
            "./node_modules/@moddable/typings/xs",
            "./node_modules/@moddable/typings/mcpack"
        ]
    },
    "include": ["src/**/*.ts"]
}
```

- `xs` — declares `trace`, `HostBuffer`, `ByteBuffer`, and the XS extensions to `ArrayBuffer`, `Uint8Array`, `Math`, etc.
- `mcpack` — declares browser-compat globals like `setTimeout`, `clearTimeout`, `console`, `localStorage`, `WebSocket`.

The base config at `typings/tsconfig.base.json` provides:

- `"target": "ES2025"` — XS supports modern JS features
- `"module": "preserve"` — preserves import/export syntax for the Moddable build system
- `"moduleResolution": "bundler"` — supports the `embedded:` path prefix
- Path mappings for all module namespaces:

```json
"paths": {
    "embedded:io/*":       ["./embedded_io/*"],
    "embedded:network/*":  ["./embedded_network/*"],
    "embedded:storage/*":  ["./embedded/storage/*"],
    "mc/*":                ["./mc/*"],
    "pins/*":              ["./pins/*"],
    "*":                   ["./*"]
}
```

These paths map `import Digital from "embedded:io/digital"` to `typings/embedded_io/digital.d.ts`.

---

## 24. Module Directory Structure

A typical module with a TypeScript declaration:

```
modules/
└── files/
    └── file/
        ├── file.js           ← JS bindings (@ and native() syntax)
        ├── manifest.json     ← build config with platform sections
        ├── esp32/
        │   └── modFile.c     ← ESP32 implementation
        └── win/
            └── modFile.c     ← Windows implementation

typings/
└── file.d.ts                 ← TypeScript declaration (authoring only)
```

The `.d.ts` lives in `typings/` (not alongside the `.js`) because it's an authoring tool, not a runtime file.

---

## 25. Complete Examples

### Example A: Standalone function

**`deepEqual.js`**
```js
function deepEqual(a, b, options) @ "fx_deepEqual";
export default deepEqual;
```

**`typings/deepEqual.d.ts`**
```typescript
declare module "deepEqual" {
    export default function deepEqual(a: any, b: any): boolean;
}
```

**Usage in TypeScript**
```typescript
import deepEqual from "deepEqual";
const same: boolean = deepEqual({ x: 1 }, { x: 1 });
```

---

### Example B: Class wrapping a C resource

**`file.js`**
```js
export class File @ "xs_file_destructor" {
    constructor(path, write) @ "xs_File";
    read(type, count) @ "xs_file_read";
    close() @ "xs_file_close";
    get length() @ "xs_file_get_length";
    set position(v) @ "xs_file_set_position";
    static delete(path) @ "xs_file_delete";
}
```

**`typings/file.d.ts`**
```typescript
declare module "file" {
    export class File {
        constructor(path: string, write?: boolean);
        read<T extends typeof ArrayBuffer | typeof String>(
            type: T,
            bytes?: number
        ): T extends typeof String ? string : InstanceType<T>;
        close(): void;
        readonly length: number;
        position: number;
        static delete(path: string): boolean;
        static exists(path: string): boolean;
        private brand: boolean;
    }
}
```

**`modFile.c`** (abbreviated)
```c
#include "xsmc.h"
#include <stdio.h>

static FILE *getFile(xsMachine *the)
{
    FILE *f = xsmcGetHostData(xsThis);
    if (!f) xsUnknownError("closed");
    return f;
}

void xs_file_destructor(void *data)
{
    if (data) fclose((FILE *)data);
}

void xs_File(xsMachine *the)
{
    uint8_t write = (xsmcArgc > 1) ? xsmcToBoolean(xsArg(1)) : 0;
    FILE *file = fopen(xsmcToString(xsArg(0)), write ? "rb+" : "rb");
    if (!file) xsUnknownError("file not found");
    xsmcSetHostData(xsThis, file);
}

void xs_file_get_length(xsMachine *the)
{
    FILE *file = getFile(the);
    long pos = ftell(file);
    fseek(file, 0, SEEK_END);
    xsmcSetInteger(xsResult, (int32_t)ftell(file));
    fseek(file, pos, SEEK_SET);
}
```

**Usage in TypeScript**
```typescript
import { File } from "file";

const f = new File("/data.txt");
const text: string = f.read(String, 64);
const buf: ArrayBuffer = f.read(ArrayBuffer, 64);
f.close();
```

---

### Example C: Static class with callbacks

**`timer.js`**
```js
class Timer {
    static set(callback, delay, repeat) {
        return native("xs_timer_set").call(this, callback, delay, repeat);
    }
    static clear(id) { return native("xs_timer_clear").call(this, id); }
}
```

**`typings/timer.d.ts`**
```typescript
declare module "timer" {
    export type TimerCallback = (timer: Timer) => void;

    class Timer {
        private constructor();
        static set(callback: TimerCallback, interval?: number, repeat?: number): Timer;
        static repeat(callback: TimerCallback, interval: number): Timer;
        static clear(timer: Timer | undefined | null): void;
        static delay(milliseconds: number): void;
        private brand: boolean;
    }
    export { Timer as default };
}
```

**Usage in TypeScript**
```typescript
import Timer from "timer";

const t: Timer = Timer.set((timer) => {
    trace("tick\n");
}, 1000);

Timer.clear(t);
```

---

### Example D: IO class with options bag and callbacks

**`_analog.js`** (uses `Native()` pattern)
```js
class Analog extends Native("xs_analog_destructor_") {
    constructor(dictionary) { super(); native("xs_analog_constructor_").call(this, dictionary); }
    read() { return native("xs_analog_read_").call(this); }
    get resolution() { return 10; }
    get format() { return "number"; }
    set format(value) { if ("number" !== value) throw new RangeError; }
}
export default Analog;
```

**`typings/embedded_io/analog.d.ts`**
```typescript
declare module "embedded:io/analog" {
    class Analog {
        constructor(options: { pin: number });
        read(): number;
        close(): void;
        readonly resolution: number;
        get format(): "number";
        set format(value: "number");
    }
    export default Analog;
}
```

**Usage in TypeScript**
```typescript
import Analog from "embedded:io/analog";

const sensor = new Analog({ pin: 34 });
const value: number = sensor.read();   // 0–1023
sensor.close();
```

---

### Example E: Binary data module with `ByteBuffer`

**`base64.js`**
```js
export default class {
    static encode(buffer) @ "xs_base64_encode";
    static decode(string) @ "xs_base64_decode";
}
```

**`typings/base64.d.ts`**
```typescript
declare module "base64" {
    var Base64: {
        encode(source: ByteBuffer | string): string;
        decode(str: string): ArrayBuffer;
    };
    export { Base64 as default };
}
```

**Usage in TypeScript**
```typescript
import Base64 from "base64";

const encoded: string = Base64.encode(new Uint8Array([72, 101, 108, 108, 111]));
const decoded: ArrayBuffer = Base64.decode(encoded);
```

---

## 26. Quick Reference Card

### TypeScript → C type mapping

```
TypeScript                C type          XS read macro
───────────────────────────────────────────────────────────
number (integer)          int32_t         xsmcToInteger(xsArg(n))
number (float)            double          xsmcToNumber(xsArg(n))
boolean                   uint8_t         xsmcToBoolean(xsArg(n))
string                    char *          xsmcToString(xsArg(n))   ← temporary pointer!
ArrayBuffer               void *          xsmcToArrayBuffer(xsArg(n))
ByteBuffer / Uint8Array   void *          xsmcGetBufferReadable(xsArg(n), &ptr, &len)
0 | 1                     uint8_t         xsmcToInteger(xsArg(n))
```

### C → TypeScript return mapping

```
C macro                           TypeScript return type
────────────────────────────────────────────────────────
xsmcSetInteger(xsResult, v)       number
xsmcSetNumber(xsResult, v)        number
xsmcSetBoolean(xsResult, v)       boolean
xsmcSetString(xsResult, ptr)      string
xsStringBuffer(ptr, len)          string
xsmcSetArrayBuffer(xsResult,…)    ArrayBuffer
xsmcSetUndefined(xsResult)        undefined
(nothing)                         undefined / void
```

### XS engine macros

```
xsmcArgc                           argument count
xsArg(n)                           nth argument (0-based)
xsThis                             the JS 'this' object
xsGlobal                           global object
xsmcTypeOf(xsArg(n))               xsType constant

xsmcSetHostData(xsThis, ptr)       store C pointer on object
xsmcGetHostData(xsThis)            retrieve C pointer from object

xsUnknownError("msg")              throw new Error(...)
xsTypeError("msg")                 throw new TypeError(...)
xsRangeError("msg")                throw new RangeError(...)

xsRemember(slot)                   protect slot from GC
xsForget(slot)                     release slot to GC
xsBeginHost(the)                   enter JS context from C callback
xsEndHost(the)                     exit JS context (always pair)
```

### .d.ts declaration checklist

```
□ declare module "module-name" { ... }
□ Named callback types (export type XxxCallback = ...)
□ private brand: boolean on classes that wrap C resources
□ readonly on C-backed getters with no setter
□ ByteBuffer for binary inputs — it already includes ArrayBuffer, Uint8Array, DataView, HostBuffer
□ Generic conditional types for read<T extends ...>() patterns
□ private constructor() for classes that can't be new'd directly
□ this-typed callbacks (onReadable?: (this: MyClass) => void)
```
