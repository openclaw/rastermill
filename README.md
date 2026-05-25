# Rastermill

Fast, portable image processing for Node agents.

Rastermill provides a small image-processing API for server-side Node code. It uses
Photon for fast in-process image work and can fall back to native tools such as
`sips`, ImageMagick, GraphicsMagick, or ffmpeg for formats that need external
codec support.

```ts
import { createRastermill } from "rastermill";

const rastermill = createRastermill({
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
```

## API

```ts
const rastermill = createRastermill(options);
```

The API is three methods:

- `probe(input)` — read `format`, `width`, `height`, `hasAlpha`, and `orientation` from the header, without a full decode.
- `encode(input, options)` — resize and re-encode to a `format` (`"jpeg"` or `"png"`); returns the bytes plus the final dimensions.
- `encodeWithinBytes(input, options)` — encode under a byte budget, searching across dimensions, quality, and compression.

The same three are also exported as standalone functions backed by a default-configured instance:

```ts
import { probe, encode, encodeWithinBytes } from "rastermill";
```

A straight format conversion (e.g. HEIC/AVIF → JPEG) is just `encode(input, { format: "jpeg" })` with no `resize`. EXIF orientation is baked in by default; pass `autoOrient: false` to skip it.

## Backends

`backend: "auto"` tries Photon first for supported formats, then native tools
when a format or operation needs external codec support. You can force a backend
with `backend: "photon"`, `"sips"`, `"imagemagick"`, `"graphicsmagick"`, or
`"ffmpeg"`.

Rastermill refuses to decode images with unknown dimensions, images larger than the
configured input pixel budget, or resize targets larger than the configured
output pixel budget.
