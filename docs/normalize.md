# `normalize`

Bake a JPEG's EXIF orientation into its pixels so downstream consumers that
ignore EXIF still display it upright. For new encode paths, prefer
`encode(input, { format, autoOrient: true })`.

```ts
normalize(input: ImageInput): Promise<Buffer>
```

```ts
const upright = await rastermill.normalize(jpegBuffer);
```

## Behavior

Rastermill reads the JPEG EXIF orientation tag:

- If there is no orientation tag, or it's already `1` (normal), the **input
  buffer is returned unchanged** — no re-encode, no quality loss.
- Otherwise Rastermill rotates/flips the pixels to match the orientation and
  re-encodes through `encode(input, { format: "jpeg", autoOrient: true })`
  using the standard JPEG quality default.

All eight EXIF orientation values are handled, including the four that swap the
width and height axes.

The input is validated against `maxInputPixels` before any work. Orientation is
read from JPEG EXIF only; other formats without EXIF orientation pass through
unchanged.

## When to use it

Reach for `normalize` when you're storing or forwarding JPEGs to tools that
render raw pixels and don't honor EXIF — many image viewers, ML pipelines, and
thumbnailers. The encode methods ([JPEG](./to-jpeg.md), [PNG](./to-png.md))
already apply orientation by default, so you don't need to `normalize` first
when you're encoding anyway.
