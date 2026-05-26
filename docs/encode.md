# `encode`

Resize and re-encode an image to a target format.

```ts
const out = await rastermill.encode(input, {
  format: "jpeg",            // "jpeg" | "png" | "webp"
  resize: { maxSide: 1600 },
  quality: 85,
});
// => { data: Buffer, format: "jpeg", mimeType: "image/jpeg", width, height, bytes, metadata: "stripped" }
```

`encode` decodes the input, optionally resizes it, bakes in EXIF orientation,
and encodes to `format`. The result carries the output bytes plus the final
dimensions, MIME type, and metadata status, so callers never need to re-probe.

Metadata is stripped by default. `metadata: "preserve"` is deliberately narrow:
it only preserves metadata when Rastermill can return the original bytes
unchanged. Photon does not expose EXIF/GPS/ICC/XMP read, write, or copy APIs, so
any actual decode, resize, orientation, conversion, or quality/compression
change returns fresh bytes with `metadata: "stripped"`.

## Options

```ts
type EncodeOptions =
  | {
      format: "jpeg";
      resize?: ResizeOptions;
      quality?: number;      // 1–100 (default 85)
      autoOrient?: boolean;  // default true
      metadata?: "strip" | "preserve"; // default "strip"
      signal?: AbortSignal;
    }
  | {
      format: "png";
      resize?: ResizeOptions;
      compressionLevel?: number; // 0–9 (default 6)
      autoOrient?: boolean;      // default true
      metadata?: "strip" | "preserve"; // default "strip"
      signal?: AbortSignal;
    }
  | {
      format: "webp";
      resize?: ResizeOptions;
      quality?: number;          // 1–100; requires an external backend
      autoOrient?: boolean;      // default true
      metadata?: "strip" | "preserve"; // default "strip"
      signal?: AbortSignal;
    };
```

Format-specific options are part of the discriminated union: `quality` is only
valid for JPEG/WebP, and `compressionLevel` is only valid for PNG. WebP quality
requires `execution: "auto"` with a native backend available, or
`execution: "external"`; Photon's `get_bytes_webp()` has no quality parameter.

### Resize

```ts
type ResizeOptions = {
  fit?: "inside" | "cover" | "fill";
  maxSide?: number;          // fit the longest side into this box
  width?: number;
  height?: number;
  enlarge?: boolean;         // default false: never scale up
};
```

- **`inside`** (default) scales to fit within the given box (`maxSide`, or
  `width`/`height`), preserving aspect ratio.
- **`cover`** scales to cover the target box, then center-crops. Use `maxSide`
  for a square crop, or pass both `width` and `height`.
- **`fill`** stretches to exactly `width × height`.
- Omit `resize` entirely to re-encode at the original size — this is how you do a
  straight format conversion.

By default the image is never enlarged; set `enlarge: true` to allow upscaling.

## `encodeBest`

Use `encodeBest` when the caller wants Rastermill to choose the output path
based on transparency:

```ts
const out = await rastermill.encodeBest(input, {
  resize: { maxSide: 1600 },
  opaque: { format: "jpeg", quality: 85 },
  transparent: { format: "png", compressionLevel: 9 },
  maxBytes: 500_000,
  search: {
    maxSide: [1600, 1280, 1024],
    quality: [85, 75, 65],
    compressionLevel: [9, 8, 7],
  },
  transparency: "auto",
});
// => { data, format, width, height, bytes, withinBudget?, chosen }
```

`transparency` controls alpha handling:

- **`auto`** inspects transparent pixels only for known in-process
  alpha-capable formats (`png`, `gif`, `webp`), otherwise uses the header hint
  and chooses the opaque output.
- **`prefer`** (default) preserves alpha first, then flattens to the opaque
  output if a transparent result cannot fit `maxBytes`.
- **`preserve`** never flattens alpha. If no transparent candidate fits, the
  result is the smallest transparent candidate with `withinBudget: false`.
- **`flatten`** always uses the opaque output.

If `maxBytes` is omitted, `encodeBest` does a single encode. If `maxBytes` is
present, it uses the same search semantics as
[`encodeWithinBytes`](./encode-within-bytes.md).

`encodeBest` forwards `metadata`, `resize`, `autoOrient`, and `signal` to the
chosen encode path. The same metadata limitation applies: preservation only
happens when the final operation can return original bytes unchanged.

`chosen.transparency` reports what happened to transparent pixels:

- **`preserved`** means a transparent output format was selected.
- **`flattened`** means the input had an alpha channel or transparent pixels and
  Rastermill chose the opaque output.
- **`not-present`** means no alpha was detected from the inspected/header facts.

## `encodeToLimits`

Use `encodeToLimits` when dimensions are the primary constraint:

```ts
const out = await rastermill.encodeToLimits(input, {
  limits: { maxWidth: 4096, maxHeight: 4096, maxPixels: 20_000_000 },
  opaque: { format: "jpeg", quality: 92 },
  transparent: { format: "png", compressionLevel: 9 },
  transparency: "auto",
});
// => EncodedImageBest & { resized: boolean }
```

If the image already fits and the input format is `jpeg`, `png`, or `webp`,
Rastermill returns the original bytes by default with `metadata: "preserved"` and
`resized: false`. Pass `metadata: "strip"` if even the no-resize path must
re-encode. If dimensions exceed the limits, Rastermill computes a non-enlarging
inside resize target and delegates to `encodeBest`.

At least one of `limits.maxWidth`, `limits.maxHeight`, or `limits.maxPixels` is
required. `maxBytes` and `search` can also be supplied; they use the same budget
search semantics as `encodeBest`.

## Format conversion (HEIC/AVIF → JPEG)

There is no separate convert method. Decode-and-encode is just `encode` with no
resize:

```ts
const jpeg = await rastermill.encode(heicBuffer, { format: "jpeg" });
```

Photon can't decode HEIC/AVIF, so `execution: "auto"` falls through to a native
tool (`sips`, ImageMagick, GraphicsMagick, or ffmpeg). If none is available you
get a [`RastermillUnavailableError`](./error-handling.md).

## Orientation

JPEG EXIF orientation is applied by default so the output pixels are upright.
Pass `autoOrient: false` to keep the original pixel layout. HEIC/AVIF orientation
is delegated to the native backend and may vary by tool.

Orientation is pixel work, not metadata preservation. If Rastermill applies
orientation, the output is re-encoded and reports `metadata: "stripped"`.

## Pixel budgets

`encode` enforces both budgets: the decoded input must be within
`limits.inputPixels`, and the projected resize target must be within
`limits.outputPixels`. Violations throw before any backend runs. See
[Configuration](./configuration.md).
