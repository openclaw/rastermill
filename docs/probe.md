# `probe`

Inspect an image without a full decode.

```ts
const info = await rastermill.probe(input);
// => { format, width, height, bytes, hasAlpha, orientation } | null
```

`probe` reads the file header to report the format and dimensions, plus an alpha
hint and EXIF orientation when the format exposes them. It is cheap: for the
formats Rastermill recognizes by header (`png`, `jpeg`, `gif`, `webp`, `bmp`,
`tiff`, `heif`, `avif`) it never runs a decoder.

## Result

```ts
type ImageProbe = {
  format: ImageFormat;        // "png" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "heif" | "avif"
  width: number;
  height: number;
  bytes: number;
  hasAlpha: boolean | null;   // null when the header can't tell
  orientation: number | null; // EXIF orientation 1–8, or null
};
```

- `hasAlpha` is definitive for PNG (and WebP `VP8X`) and `false` for JPEG. For
  formats where the header doesn't carry it (`gif`, `bmp`, `tiff`, `heif`,
  `avif`), it is `null`.
- `orientation` is the JPEG EXIF orientation tag when present.

## Lenient by design

`probe` returns `null` — it does **not** throw — when the input is undecodable
or its dimensions exceed `limits.inputPixels`. Encoding the same input still
throws (see [Error handling](./error-handling.md)), so use `probe` for "can I
look at this?" and `encode` for "process this."

```ts
const info = await rastermill.probe(buffer);
if (!info) return; // unknown format or over the input budget
if (info.hasAlpha) {
  const alpha = await rastermill.transparency(buffer);
  // Use alpha.hasAlphaChannel or alpha.hasTransparentPixels for policy.
}
```

## Header-only helpers

`readImageProbeFromHeader(input)` and `readImageMetadataFromHeader(input)` are
exported as synchronous, budget-free header parsers. `probe` builds on the
former and adds the configured pixel-budget check.
