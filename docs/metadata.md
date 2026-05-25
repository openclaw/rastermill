# `probe` and `metadata`

Read cheap image information without fully decoding it.

```ts
probe(input: ImageInput): Promise<ImageProbe | null>
metadata(input: ImageInput): Promise<ImageMetadata | null>
```

`ImageProbe` is `{ format, width, height, hasAlpha, orientation }`. `hasAlpha`
and `orientation` are `null` when the answer is not cheaply known from headers.
`ImageMetadata` is `{ width: number; height: number }`. Returns `null` when the
dimensions can't be determined or the image exceeds `maxInputPixels`.

```ts
const info = await rastermill.probe(buffer);
if (info) {
  console.log(`${info.format} ${info.width}×${info.height}`);
}
```

## How it works

Rastermill first parses the file header — no decoder runs. Header parsing covers:

- PNG
- GIF (`GIF87a` / `GIF89a`)
- WebP (`VP8`, `VP8L`, `VP8X`)
- BMP
- TIFF (multi-page; returns the largest page, bails on SubIFD-only sizing)
- ISO-BMFF: HEIC / HEIF / AVIF (reads `ispe`, returns the largest)
- JPEG (reads the Start-of-Frame marker)

If the header yields dimensions, they're checked against `maxInputPixels`. Over
budget returns `null` rather than throwing.

If the header can't be parsed and the backend is `auto` or `photon`, Rastermill
decodes with Photon as a last resort and reports the decoded dimensions. With
any other pinned backend, an unparseable header returns `null`. Decode failures
also return `null`.

## Header-only parsing

`readImageProbeFromHeader` and `readImageMetadataFromHeader` are exported for
when you want pure header parsing with no pixel-budget check and no decode
fallback. They are synchronous.

```ts
import { readImageMetadataFromHeader, readImageProbeFromHeader } from "rastermill";

const probe = readImageProbeFromHeader(buffer); // ImageProbe | null
const dims = readImageMetadataFromHeader(buffer); // ImageMetadata | null
```

These are the primitives `probe` and `metadata` build on. Use them when you only
trust headers, want zero async work, or are sizing images before deciding
whether to hand them to Rastermill at all.
