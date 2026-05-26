# `encode`

`encode(input, options?)` is Rastermill's single write path. Options decide
whether it performs an exact-format encode, automatic opaque-vs-transparent
format selection, byte-budget search, dimension-limit fitting, or a combination
of those.

```ts
const jpeg = await rastermill.encode(input, {
  format: "jpeg",
  resize: { maxSide: 1600 },
  quality: 85,
});
// => { data, format: "jpeg", mimeType: "image/jpeg", width, height, bytes, metadata, resized, chosen }
```

Calling `encode(input)` or `encode(input, { format: "auto" })` uses the default
automatic policy: opaque output becomes JPEG, transparent output becomes PNG,
and transparency is inspected only when the input format makes that useful.

## Exact Format

Use `format: "jpeg" | "png" | "webp"` when the caller wants a specific output
format:

```ts
const png = await rastermill.encode(input, {
  format: "png",
  resize: { width: 512, height: 512, fit: "cover" },
  compressionLevel: 9,
});
```

```ts
type EncodeOptions =
  | {
      format: "jpeg";
      resize?: ResizeOptions;
      quality?: number; // 1-100, default 85
      limits?: ImageDimensionLimits;
      maxBytes?: number;
      search?: EncodeSearchOptions;
      autoOrient?: boolean; // default true
      metadata?: "strip" | "preserve"; // default "strip"
      signal?: AbortSignal;
    }
  | {
      format: "png";
      resize?: ResizeOptions;
      compressionLevel?: number; // 0-9, default 6
      limits?: ImageDimensionLimits;
      maxBytes?: number;
      search?: EncodeSearchOptions;
      autoOrient?: boolean;
      metadata?: "strip" | "preserve";
      signal?: AbortSignal;
    }
  | {
      format: "webp";
      resize?: ResizeOptions;
      quality?: number; // 1-100, requires external execution
      limits?: ImageDimensionLimits;
      maxBytes?: number;
      search?: EncodeSearchOptions;
      autoOrient?: boolean;
      metadata?: "strip" | "preserve";
      signal?: AbortSignal;
    };
```

Format-specific options are part of the discriminated union: `quality` is only
valid for JPEG/WebP, and `compressionLevel` is only valid for PNG. WebP quality
requires `execution: "auto"` with a native backend available, or
`execution: "external"`; Photon's `get_bytes_webp()` has no quality parameter.

## Auto Format

Use `format: "auto"` when Rastermill should pick between an opaque output and a
transparency-preserving output:

```ts
const out = await rastermill.encode(input, {
  format: "auto",
  resize: { maxSide: 1600 },
  opaque: { format: "jpeg", quality: 85 },
  transparent: { format: "png", compressionLevel: 9 },
  transparency: "prefer",
});
```

```ts
type FormatPreference =
  | { format: "jpeg"; quality?: number }
  | { format: "png"; compressionLevel?: number }
  | { format: "webp"; quality?: number };

type TransparentFormatPreference =
  | { format: "png"; compressionLevel?: number }
  | { format: "webp"; quality?: number };

type AutoEncodeOptions = {
  format?: "auto";
  opaque?: FormatPreference;
  transparent?: TransparentFormatPreference;
  transparency?: "auto" | "prefer" | "preserve" | "flatten";
  resize?: ResizeOptions;
  limits?: ImageDimensionLimits;
  maxBytes?: number;
  search?: EncodeSearchOptions;
  autoOrient?: boolean;
  metadata?: "strip" | "preserve";
  signal?: AbortSignal;
};
```

`transparency` controls alpha handling:

- **`auto`** (default) inspects transparent pixels only for known in-process
  alpha-capable formats (`png`, `gif`, `webp`), otherwise uses the header hint
  and chooses the opaque output.
- **`prefer`** preserves alpha first, then flattens to the opaque
  output if a transparent result cannot fit `maxBytes`.
- **`preserve`** never flattens alpha. If no transparent candidate fits, the
  result is the smallest transparent candidate with `withinBudget: false`.
- **`flatten`** always uses the opaque output.

`chosen.transparency` reports what happened:

- **`preserved`** means a transparent output format was selected.
- **`flattened`** means the input had an alpha channel or transparent pixels and
  Rastermill chose the opaque output.
- **`not-present`** means no alpha was detected from the inspected/header facts.

## Byte Budgets

Add `maxBytes` to make `encode` search output settings until the result fits, or
return the smallest candidate with `withinBudget: false`:

```ts
const out = await rastermill.encode(input, {
  format: "jpeg",
  maxBytes: 500_000,
  search: {
    maxSide: [1600, 1280, 1024],
    quality: [85, 75, 65],
  },
});
```

Search axes depend on the output format:

- JPEG/WebP search `quality` and `maxSide`.
- PNG searches `compressionLevel` and `maxSide`.
- WebP quality search requires an external backend; internal Photon WebP can
  only participate in resize-only searches.

The result always includes `bytes`, `withinBudget`, and `chosen` so callers can
see what Rastermill selected.

## Dimension Limits

Add `limits` when dimensions are the primary constraint:

```ts
const out = await rastermill.encode(input, {
  format: "auto",
  limits: { maxWidth: 4096, maxHeight: 4096, maxPixels: 20_000_000 },
  opaque: { format: "jpeg", quality: 92 },
  transparent: { format: "png", compressionLevel: 9 },
});
```

At least one of `limits.maxWidth`, `limits.maxHeight`, or `limits.maxPixels` is
required. If the image already fits and the input format is `jpeg`, `png`, or
`webp`, auto mode returns the original bytes by default with
`metadata: "preserved"` and `resized: false`. Pass `metadata: "strip"` if even
the no-resize path must re-encode.

Exact-format mode may also use `limits`; Rastermill combines explicit `resize`
with the computed non-enlarging limit resize before encoding.

## Resize

```ts
type ResizeOptions = {
  fit?: "inside" | "cover" | "fill";
  maxSide?: number;
  width?: number;
  height?: number;
  enlarge?: boolean; // default false
};
```

- **`inside`** (default) scales to fit within the given box (`maxSide`, or
  `width`/`height`), preserving aspect ratio.
- **`cover`** scales to cover the target box, then center-crops. Use `maxSide`
  for a square crop, or pass both `width` and `height`.
- **`fill`** stretches to exactly `width x height`.
- Omit `resize` entirely to re-encode at the original size. This is how you do a
  straight format conversion.

By default the image is never enlarged; set `enlarge: true` to allow upscaling.

## Metadata

Metadata is stripped by default. `metadata: "preserve"` is deliberately narrow:
it only preserves metadata when Rastermill can return the original bytes
unchanged. Photon does not expose EXIF/GPS/ICC/XMP read, write, or copy APIs, so
any actual decode, resize, orientation, conversion, or quality/compression
change returns fresh bytes with `metadata: "stripped"`.

## Format Conversion

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

## Pixel Budgets

`encode` enforces both budgets: the decoded input must be within
`limits.inputPixels`, and the projected resize target must be within
`limits.outputPixels`. Violations throw before any backend runs. See
[Configuration](./configuration.md).
