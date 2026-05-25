# `encode` to PNG

Resize an image so its longest side fits a limit, then encode it as PNG —
preserving transparency.

```ts
encode(input: ImageInput, options: EncodeOptions): Promise<EncodedImage>
toPng(input: ImageInput, options: ResizeToPngOptions): Promise<Buffer>
```

```ts
const png = await rastermill.encode(buffer, {
  format: "png",
  resize: { maxSide: 1024 },
  png: { compressionLevel: 8 },
});
```

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `format` | `"png"` | — (required) | Output format. |
| `resize.maxSide` | `number` | source size | Target for the longest edge, in pixels. Aspect ratio is preserved. |
| `resize.enlarge` | `boolean` | `false` | Allow upscaling. |
| `png.compressionLevel` | `number` | `6` | Deflate level, `0`–`9`. Higher is smaller but slower. |

`toPng` is kept as a compatibility wrapper over `encode`.

## Behavior

- Aspect ratio is preserved (longest edge → `maxSide`, minimum 1px).
- The Photon path resamples with Lanczos3, then encodes lossless RGBA PNG so the
  alpha channel survives.
- EXIF orientation is applied.
- Input and projected output are checked against `maxInputPixels` /
  `maxOutputPixels` before decoding.

## Backend notes

PNG resize uses `photon`, `windows-native`, `imagemagick`, or `graphicsmagick`.
`sips` and `ffmpeg` are **not** used for PNG resizing. See
[Backends](./backends.md) for the per-platform order.

## Encoding raw pixels: `encodePngRgba`

The low-level encoder Rastermill uses internally is exported. Given a tightly packed
RGBA buffer it produces a valid PNG (`Buffer`):

```ts
import { encodePngRgba } from "rastermill";

const png = encodePngRgba(rgbaPixels, width, height, /* compressionLevel */ 6);
```

`rgbaPixels` must be exactly `width * height * 4` bytes (4 channels: R, G, B, A);
otherwise it throws. `compressionLevel` defaults to `6` and is clamped to
`0`–`9`. Useful when you already have raw pixels — e.g. from a canvas or a
decoder — and just need a PNG without a resize step.
