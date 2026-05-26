# Rastermill

Fast, portable image processing for Node agents.

Rastermill provides a small image-processing API for server-side Node code. It uses
Photon for fast in-process image work and can fall back to native tools such as
`sips`, ImageMagick, GraphicsMagick, or ffmpeg for formats that need external
codec support.

Docs: <https://rastermill.com/>

```ts
import { createRastermill } from "rastermill";

const rastermill = createRastermill({
  execution: "auto",
  limits: {
    inputPixels: 25_000_000,
    outputPixels: 25_000_000,
  },
});

const info = await rastermill.probe(imageBuffer);
const jpeg = await rastermill.encode(imageBuffer, {
  format: "jpeg",
  resize: { maxSide: 1600 },
  quality: 85,
});
// => { data, format: "jpeg", mimeType: "image/jpeg", width, height, bytes, metadata: "stripped", resized, chosen }
```

## API

```ts
const rastermill = createRastermill(options);
```

The API is three methods:

- `probe(input)` — read `format`, `width`, `height`, `bytes`, `hasAlpha`, and `orientation` from the header, without a full decode.
- `transparency(input)` — decode common raster formats and report `hasAlphaChannel` separately from `hasTransparentPixels`.
- `encode(input, options?)` — resize, re-encode to an exact format, auto-select opaque vs transparent output, fit dimension limits, and/or search a byte budget.

The same methods are also exported as standalone functions backed by a lazy
default-configured instance:

```ts
import { probe, transparency, encode } from "rastermill";
```

A straight format conversion (e.g. HEIC/AVIF → JPEG) is just `encode(input, { format: "jpeg" })` with no `resize`. JPEG EXIF orientation is baked in by default; HEIC orientation handling depends on the native backend. Pass `autoOrient: false` to skip explicit orientation work.

Encoded outputs strip metadata by default. `metadata: "preserve"` only preserves
metadata when Rastermill can return the original bytes unchanged; Photon does not
expose EXIF/GPS/ICC/XMP read, write, or copy APIs, so any real transform strips
metadata and reports `metadata: "stripped"`.

## Backends

`execution: "auto"` uses Photon in-process for supported formats, then native
tools when a format needs external codec support. Use `execution: "internal"`
to forbid child processes, or `execution: "external"` to use only native tools.
WebP quality control requires an external backend because Photon's WebP encoder
does not accept a quality setting.

Rastermill refuses to decode images with unknown dimensions, images larger than the
configured input pixel budget, or resize targets larger than the configured
output pixel budget.
