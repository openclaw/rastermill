# Rastermill

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
// => { data, format: "jpeg", mimeType: "image/jpeg", width, height, bytes, metadata: "stripped", resized, chosen }
```

Every method accepts a `Buffer`, `Uint8Array`, or `ArrayBuffer` as input.

## Features

| Page | What it covers |
| --- | --- |
| [Configuration](./configuration.md) | `createRastermill`, options, pixel budgets, custom command resolution |
| [Backends](./backends.md) | Execution modes, backend selection order, and automatic fallback |
| [`probe`](./probe.md) | Read format, width/height, alpha, and orientation without decoding |
| [`transparency`](./transparency.md) | Decode common raster formats and inspect alpha channels/pixels |
| [`encode`](./encode.md) | Exact-format encode, auto format choice, byte budgets, dimension limits, metadata policy, and HEIC/AVIF → JPEG |
| [Error handling](./error-handling.md) | `RastermillUnavailableError`, `isRastermillUnavailableError` |

## Two ways to call

Create a configured instance with `createRastermill(options)`, or use the
default-configured module functions: `probe`, `transparency`, and `encode` are
exported directly and lazily create a default `Rastermill` instance on first
use.

## Safety model

Rastermill refuses to process images it can't size up. It rejects images with
unknown dimensions, inputs larger than `limits.inputPixels`, and resize targets
larger than `limits.outputPixels`. External tools run with a timeout and a
bounded output buffer. See [Configuration](./configuration.md) for the knobs.

Encoded outputs strip metadata by default. `metadata: "preserve"` is a
passthrough-only fast path: it preserves metadata only when the original bytes
can be returned unchanged. Photon does not expose EXIF/GPS/ICC/XMP metadata
APIs, so any real transform reports `metadata: "stripped"`.
