# `normalize`

Bake a JPEG's EXIF orientation into its pixels so downstream consumers that
ignore EXIF still display it upright.

```ts
normalize(input: ImageInput): Promise<Buffer>
```

```ts
const upright = await prism.normalize(jpegBuffer);
```

## Behavior

Prism reads the JPEG EXIF orientation tag:

- If there is no orientation tag, or it's already `1` (normal), the **input
  buffer is returned unchanged** — no re-encode, no quality loss.
- Otherwise Prism rotates/flips the pixels to match the orientation and
  re-encodes. The Photon path emits JPEG at quality 90; native backends
  (`sips`, ImageMagick, GraphicsMagick, ffmpeg) apply their auto-orient and
  re-encode.

All eight EXIF orientation values are handled, including the four that swap the
width and height axes.

The input is validated against `maxInputPixels` before any work. Orientation is
read from JPEG EXIF only; other formats without EXIF orientation pass through
unchanged.

## When to use it

Reach for `normalize` when you're storing or forwarding JPEGs to tools that
render raw pixels and don't honor EXIF — many image viewers, ML pipelines, and
thumbnailers. The resize methods ([`toJpeg`](./to-jpeg.md),
[`toPng`](./to-png.md)) already apply orientation themselves, so you don't need
to `normalize` first when you're resizing anyway.
