# `metadata`

Read an image's pixel dimensions, cheaply and without fully decoding it.

```ts
metadata(input: ImageInput): Promise<ImageMetadata | null>
```

`ImageMetadata` is `{ width: number; height: number }`. Returns `null` when the
dimensions can't be determined or the image exceeds `maxInputPixels`.

```ts
const info = await prism.metadata(buffer);
if (info) {
  console.log(`${info.width}×${info.height}`);
}
```

## How it works

Prism first parses the file header — no decoder runs. Header parsing covers:

- PNG
- GIF (`GIF87a` / `GIF89a`)
- WebP (`VP8`, `VP8L`, `VP8X`)
- BMP
- TIFF (multi-page; returns the largest page, bails on SubIFD-only sizing)
- ISO-BMFF: HEIC / HEIF / AVIF (reads `ispe`, returns the largest)
- JPEG (reads the Start-of-Frame marker)

If the header yields dimensions, they're checked against `maxInputPixels`. Over
budget returns `null` rather than throwing.

If the header can't be parsed and the backend is `auto` or `photon`, Prism
decodes with Photon as a last resort and reports the decoded dimensions. With
any other pinned backend, an unparseable header returns `null`. Decode failures
also return `null`.

## Header-only parsing

`readImageMetadataFromHeader` is exported for when you want pure header parsing
with no pixel-budget check and no decode fallback. It's synchronous.

```ts
import { readImageMetadataFromHeader } from "@openclaw/prism";

const dims = readImageMetadataFromHeader(buffer); // ImageMetadata | null
```

This is the primitive `metadata` builds on. Use it when you only trust headers,
want zero async work, or are sizing images before deciding whether to hand them
to Prism at all.
