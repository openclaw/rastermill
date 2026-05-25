# `encode` to JPEG

Resize an image so its longest side fits a limit, then encode it as JPEG.

```ts
encode(input: ImageInput, options: EncodeOptions): Promise<EncodedImage>
toJpeg(input: ImageInput, options: ResizeToJpegOptions): Promise<Buffer>
```

```ts
const jpeg = await rastermill.encode(buffer, {
  format: "jpeg",
  resize: { maxSide: 1600, enlarge: false },
  quality: 85,
});

console.log(jpeg.width, jpeg.height, jpeg.bytes);
```

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `format` | `"jpeg"` | — (required) | Output format. |
| `resize.maxSide` | `number` | source size | Target for the longest edge, in pixels. Aspect ratio is preserved. |
| `resize.width` / `resize.height` | `number` | source size | Optional bounding box. |
| `resize.fit` | `"inside"` or `"fill"` | `"inside"` | Resize mode. `"cover"` is reserved and currently rejected. |
| `resize.enlarge` | `boolean` | `false` | Allow upscaling. |
| `quality` | `number` | `85` | JPEG quality, `1`–`100`. |

`toJpeg` is kept as a compatibility wrapper. It maps `{ maxSide,
withoutEnlargement }` onto `encode({ format: "jpeg", resize })` and returns the
encoded `Buffer`.

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
