# `convertHeicToJpeg`

Convert a HEIC/HEIF/AVIF image to JPEG using a native codec.

```ts
encode(input: ImageInput, { format: "jpeg" }): Promise<EncodedImage>
convertHeicToJpeg(input: ImageInput): Promise<Buffer>
```

```ts
const jpeg = await rastermill.encode(heicBuffer, { format: "jpeg" });
```

## Behavior

Photon cannot decode HEIC/AVIF, so this operation always uses a native backend.
The input is validated against `maxInputPixels` first (the ISO-BMFF header
parser reads the dimensions — see [`metadata`](./metadata.md)).

Backend order under `backend: "auto"`:

- macOS: `sips → imagemagick → graphicsmagick → ffmpeg`
- everywhere else: `imagemagick → graphicsmagick → ffmpeg`

The output is JPEG. Quality defaults to `85` for the unified encode path. EXIF
orientation is applied where the backend supports it (`sips` auto-orients via
Rastermill; ImageMagick/GraphicsMagick use `-auto-orient`).

> The `windows-native` backend does **not** convert HEIC — `System.Drawing`
> lacks a HEIC decoder. On Windows, install ImageMagick, GraphicsMagick, or
> ffmpeg for this operation.

## Failure

If no native backend with HEIC support is available, Rastermill throws a
[`RastermillUnavailableError`](./error-handling.md) for the `convertHeicToJpeg`
operation. Many systems need an explicit HEIC codec/delegate installed for
ImageMagick or ffmpeg.

`convertHeicToJpeg` is kept as a compatibility wrapper over
`encode(input, { format: "jpeg" })`.
