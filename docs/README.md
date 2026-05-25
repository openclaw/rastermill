# Rastermill documentation

Fast, portable image processing for Node agents. Rastermill runs in-process with
[Photon](https://github.com/silvia-odwyer/photon) for the common formats and
falls back to native tools (`sips`, ImageMagick, GraphicsMagick, ffmpeg, or the
Windows `System.Drawing` stack) when a format or operation needs an external
codec.

```ts
import { createRastermill } from "@openclaw/rastermill";

const rastermill = createRastermill({ maxInputPixels: 25_000_000 });

const info = await rastermill.metadata(imageBuffer);
const jpeg = await rastermill.toJpeg(imageBuffer, { maxSide: 1600, quality: 85 });
```

Every method accepts a `Buffer`, `Uint8Array`, or `ArrayBuffer` as input.

## Features

| Page | What it covers |
| --- | --- |
| [Configuration](./configuration.md) | `createRastermill`, options, pixel budgets, env vars, custom command resolution |
| [Backends](./backends.md) | Backend selection order and automatic fallback |
| [`metadata`](./metadata.md) | Read width/height without decoding; `readImageMetadataFromHeader` |
| [`normalize`](./normalize.md) | Bake in EXIF orientation |
| [`toJpeg`](./to-jpeg.md) | Resize and encode to JPEG |
| [`toPng`](./to-png.md) | Resize and encode to PNG; `encodePngRgba` |
| [`optimizePng`](./optimize-png.md) | Shrink a PNG under a byte budget |
| [`convertHeicToJpeg`](./convert-heic-to-jpeg.md) | Convert HEIC/AVIF to JPEG |
| [`hasAlpha`](./has-alpha.md) | Detect a transparent channel |
| [Error handling](./error-handling.md) | `RastermillUnavailableError`, `isRastermillUnavailableError` |

## Two ways to call

Create a configured instance with `createRastermill(options)`, or use the
default-configured module functions: `metadata`, `normalize`, `toJpeg`,
`toPng`, `optimizePng`, `convertHeicToJpeg`, and `hasAlpha` are all exported
directly and share a single default `Rastermill` instance.

## Safety model

Rastermill refuses to process images it can't size up. It rejects images with
unknown dimensions, inputs larger than `maxInputPixels`, and resize targets
larger than `maxOutputPixels`. External tools run with a timeout and a bounded
output buffer. See [Configuration](./configuration.md) for the knobs.
