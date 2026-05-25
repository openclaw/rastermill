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
| [`probe`](./probe.md) | Read format, width/height, alpha, and orientation without decoding |
| [`encode`](./encode.md) | Resize and re-encode to JPEG or PNG, including HEIC/AVIF → JPEG |
| [`encodeWithinBytes`](./encode-within-bytes.md) | Search size/quality/compression under a byte budget |
| [Error handling](./error-handling.md) | `RastermillUnavailableError`, `isRastermillUnavailableError` |

## Two ways to call

Create a configured instance with `createRastermill(options)`, or use the
default-configured module functions: `probe`, `encode`, and `encodeWithinBytes`
are exported directly and share a single default `Rastermill` instance.

## Safety model

Rastermill refuses to process images it can't size up. It rejects images with
unknown dimensions, inputs larger than `limits.inputPixels`, and resize targets
larger than `limits.outputPixels`. External tools run with a timeout and a
bounded output buffer. See [Configuration](./configuration.md) for the knobs.
