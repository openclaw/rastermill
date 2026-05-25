# Rastermill documentation

Fast, portable image processing for Node agents. Rastermill runs in-process with
[Photon](https://github.com/silvia-odwyer/photon) for the common formats and
falls back to native tools (`sips`, ImageMagick, GraphicsMagick, ffmpeg, or the
Windows `System.Drawing` stack) when a format or operation needs an external
codec.

```ts
import { createRastermill } from "rastermill";

const rastermill = createRastermill({ limits: { inputPixels: 25_000_000 } });

const info = await rastermill.probe(imageBuffer);
const jpeg = await rastermill.encode(imageBuffer, {
  format: "jpeg",
  resize: { maxSide: 1600 },
  quality: 85,
});
```

Every method accepts a `Buffer`, `Uint8Array`, or `ArrayBuffer` as input.

## Features

| Page | What it covers |
| --- | --- |
| [Configuration](./configuration.md) | `createRastermill`, options, pixel budgets, env vars, custom command resolution |
| [Backends](./backends.md) | Backend selection order and automatic fallback |
| [`probe`](./metadata.md) | Read format, width/height, alpha hints, and orientation without decoding |
| [`normalize`](./normalize.md) | Bake in EXIF orientation |
| [`encode`](./to-jpeg.md) | Resize and encode to JPEG or PNG |
| [`encodeWithinBytes`](./optimize-png.md) | Search size/quality/compression axes under a byte budget |
| Compatibility wrappers | `metadata`, `toJpeg`, `toPng`, `optimizePng`, `convertHeicToJpeg`, `hasAlpha` |
| [`convertHeicToJpeg`](./convert-heic-to-jpeg.md) | Convert HEIC/AVIF to JPEG |
| [`hasAlpha`](./has-alpha.md) | Detect a transparent channel |
| [Error handling](./error-handling.md) | `RastermillUnavailableError`, `isRastermillUnavailableError` |

## Two ways to call

Create a configured instance with `createRastermill(options)`, or use the
default-configured module functions: `metadata`, `normalize`, `toJpeg`,
`probe`, `encode`, `encodeWithinBytes`, `toPng`, `optimizePng`,
`convertHeicToJpeg`, and `hasAlpha` are all exported directly and share a
single default `Rastermill` instance.

## Safety model

Rastermill refuses to process images it can't size up. It rejects images with
unknown dimensions, inputs larger than `maxInputPixels`, and resize targets
larger than `maxOutputPixels`. External tools run with a timeout and a bounded
output buffer. See [Configuration](./configuration.md) for the knobs.
