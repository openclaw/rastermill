# `encode`

Resize and re-encode an image to a target format.

```ts
const out = await rastermill.encode(input, {
  format: "jpeg",            // "jpeg" | "png"
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
type EncodeOptions = {
  format: "jpeg" | "png";
  resize?: ResizeOptions;
  quality?: number;          // JPEG, 1–100 (default 85)
  png?: { compressionLevel?: number }; // 0–9 (default 6)
  autoOrient?: boolean;      // default true
};
```

### Resize

```ts
type ResizeOptions = {
  fit?: "inside" | "fill";   // "cover" is not implemented yet
  maxSide?: number;          // fit the longest side into this box
  width?: number;
  height?: number;
  enlarge?: boolean;         // default false: never scale up
};
```

- **`inside`** (default) scales to fit within the given box (`maxSide`, or
  `width`/`height`), preserving aspect ratio.
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

EXIF orientation is applied by default so the output pixels are upright. Pass
`autoOrient: false` to keep the original pixel layout (and any orientation
metadata the encoder writes).

## Pixel budgets

`encode` enforces both budgets: the decoded input must be within
`limits.inputPixels`, and the projected resize target must be within
`limits.outputPixels`. Violations throw before any backend runs. See
[Configuration](./configuration.md).
