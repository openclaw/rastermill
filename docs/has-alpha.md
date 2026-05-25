# `hasAlpha`

Report whether an image carries a transparent (alpha) channel.

```ts
hasAlpha(input: ImageInput): Promise<boolean>
```

```ts
if (await prism.hasAlpha(buffer)) {
  // keep PNG; converting to JPEG would flatten transparency
}
```

## Behavior

The input is validated against `maxInputPixels` first.

For **PNG** there is a fast header-only path — Prism reads the color type and
`tRNS` chunk without decoding pixels:

- color type 4 (gray+alpha) or 6 (RGBA) → `true`
- a `tRNS` chunk with data → `true`
- otherwise → `false`

For other formats Prism uses a backend:

- `photon`: decodes and scans the alpha bytes; returns `true` as soon as any
  pixel's alpha is below 255.
- `imagemagick` / `graphicsmagick`: query the channel layout via `identify`
  (`%[channels]` / `%A`) and parse the result.

`sips`, `ffmpeg`, and `windows-native` cannot inspect alpha and are skipped for
this operation.

## Failure

If no backend can determine alpha, Prism throws a
[`PrismUnavailableError`](./error-handling.md) for the `hasAlpha` operation. On
systems without Photon, install ImageMagick or GraphicsMagick to inspect alpha
for non-PNG formats.
