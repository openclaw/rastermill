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

Core methods:

- `probe(input)`
- `metadata(input)`
- `normalize(input)`
- `encode(input, options)`
- `encodeWithinBytes(input, options)`
- `toJpeg(input, options)`
- `toPng(input, options)`
- `optimizePng(input, options)`
- `convertHeicToJpeg(input)`
- `hasAlpha(input)`

Convenience functions with default options are also exported:

- `probe(input)`
- `metadata(input)`
- `encode(input, options)`
- `encodeWithinBytes(input, options)`
- `toJpeg(input, options)`
- `toPng(input, options)`
- `optimizePng(input, options)`
- `convertHeicToJpeg(input)`
- `hasAlpha(input)`

## Backends

`backend: "auto"` tries Photon first for supported formats, then native tools
when a format or operation needs external codec support. You can force a backend
with `backend: "photon"`, `"sips"`, `"imagemagick"`, `"graphicsmagick"`, or
`"ffmpeg"`.

Rastermill refuses to decode images with unknown dimensions, images larger than the
configured input pixel budget, or resize targets larger than the configured
output pixel budget.
