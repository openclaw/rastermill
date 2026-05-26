# `encode`

Resize and re-encode an image to a target format.

```ts
const out = await rastermill.encode(input, {
  format: "jpeg",            // "jpeg" | "png" | "webp"
  resize: { maxSide: 1600 },
  quality: 85,
});
// => { data: Buffer, format: "jpeg", width: number, height: number, bytes: number }
```

`encode` decodes the input, optionally resizes it, bakes in EXIF orientation,
and encodes to `format`. The result carries the output bytes plus the final
dimensions, so callers never need to re-probe.

## Options

```ts
type EncodeOptions =
  | {
      format: "jpeg";
      resize?: ResizeOptions;
      quality?: number;      // 1–100 (default 85)
      autoOrient?: boolean;  // default true
      signal?: AbortSignal;
    }
  | {
      format: "png";
      resize?: ResizeOptions;
      compressionLevel?: number; // 0–9 (default 6)
      autoOrient?: boolean;      // default true
      signal?: AbortSignal;
    }
  | {
      format: "webp";
      resize?: ResizeOptions;
      autoOrient?: boolean;      // default true
      signal?: AbortSignal;
    };
```

Format-specific options are part of the discriminated union: `quality` is only
valid for JPEG, and `compressionLevel` is only valid for PNG.

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

## Format conversion (HEIC/AVIF → JPEG)

There is no separate convert method. Decode-and-encode is just `encode` with no
resize:

```ts
const jpeg = await rastermill.encode(heicBuffer, { format: "jpeg" });
```

Photon can't decode HEIC/AVIF, so with `backend: "auto"` Rastermill falls through
to a native tool (`sips`, ImageMagick, GraphicsMagick, or ffmpeg). If none is
available you get a [`RastermillUnavailableError`](./error-handling.md).

## Orientation

JPEG EXIF orientation is applied by default so the output pixels are upright.
Pass `autoOrient: false` to keep the original pixel layout. HEIC/AVIF orientation
is delegated to the native backend and may vary by tool.

## Pixel budgets

`encode` enforces both budgets: the decoded input must be within
`limits.inputPixels`, and the projected resize target must be within
`limits.outputPixels`. Violations throw before any backend runs. See
[Configuration](./configuration.md).
