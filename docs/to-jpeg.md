# `toJpeg`

Resize an image so its longest side fits a limit, then encode it as JPEG.

```ts
toJpeg(input: ImageInput, options: ResizeToJpegOptions): Promise<Buffer>
```

```ts
const jpeg = await rastermill.toJpeg(buffer, {
  maxSide: 1600,
  quality: 85,
});
```

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `maxSide` | `number` | — (required) | Target for the longest edge, in pixels. Aspect ratio is preserved. |
| `quality` | `number` | `85` | JPEG quality, `1`–`100`. |
| `withoutEnlargement` | `boolean` | `true` | When `true`, never upscale: a smaller image is returned at its original size. Set `false` to allow enlargement. |

## Behavior

- Aspect ratio is preserved; the longer dimension is scaled to `maxSide` and the
  shorter scales proportionally (minimum 1px).
- The Photon backend resamples with a Lanczos3 filter for quality downscaling.
- EXIF orientation is applied, so the output is upright.
- Input is checked against `maxInputPixels` and the projected output against
  `maxOutputPixels` before any decode.
- If the target size equals the source size, no resampling happens; the image is
  just re-encoded.

## Backend notes

Under `backend: "auto"` Rastermill prefers Photon, then native tools per platform
(see [Backends](./backends.md)). The `quality` value maps onto each backend's
encoder — including a translation to ffmpeg's `-q:v` scale when ffmpeg is used.
