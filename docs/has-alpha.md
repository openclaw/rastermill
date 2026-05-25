# `hasAlpha`

Report whether an image carries a transparent (alpha) channel.

```ts
hasAlpha(input: ImageInput): Promise<boolean>
probe(input: ImageInput): Promise<ImageProbe | null>
```

```ts
if (await rastermill.hasAlpha(buffer)) {
  // keep PNG; converting to JPEG would flatten transparency
}
```

For PNG and some WebP headers, `probe(input)` can return `hasAlpha` without
decoding. Use `hasAlpha` when you need a definitive boolean and are willing to
let Rastermill decode or ask a native backend.

## Behavior

The input is validated against `maxInputPixels` first.

For **PNG** there is a fast header-only path — Rastermill reads the color type and
`tRNS` chunk without decoding pixels:

- color type 4 (gray+alpha) or 6 (RGBA) → `true`
- a `tRNS` chunk with data → `true`
- otherwise → `false`

For other formats Rastermill uses a backend:

- `photon`: decodes and scans the alpha bytes; returns `true` as soon as any
  pixel's alpha is below 255.
- `imagemagick` / `graphicsmagick`: query the channel layout via `identify`
  (`%[channels]` / `%A`) and parse the result.

`sips`, `ffmpeg`, and `windows-native` cannot inspect alpha and are skipped for
this operation.

## Failure

If no backend can determine alpha, Rastermill throws a
[`RastermillUnavailableError`](./error-handling.md) for the `hasAlpha` operation. On
systems without Photon, install ImageMagick or GraphicsMagick to inspect alpha
for non-PNG formats.
