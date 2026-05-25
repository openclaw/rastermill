# `convertHeicToJpeg`

Convert a HEIC/HEIF/AVIF image to JPEG using a native codec.

```ts
convertHeicToJpeg(input: ImageInput): Promise<Buffer>
```

```ts
const jpeg = await prism.convertHeicToJpeg(heicBuffer);
```

## Behavior

Photon cannot decode HEIC/AVIF, so this operation always uses a native backend.
The input is validated against `maxInputPixels` first (the ISO-BMFF header
parser reads the dimensions — see [`metadata`](./metadata.md)).

Backend order under `backend: "auto"`:

- macOS: `sips → imagemagick → graphicsmagick → ffmpeg`
- everywhere else: `imagemagick → graphicsmagick → ffmpeg`

The output is JPEG. `sips` and the ImageMagick/GraphicsMagick path encode at
quality 90; ffmpeg encodes at a comparable fixed quality. EXIF orientation is
applied where the backend supports it (`sips` auto-orients via Prism;
ImageMagick/GraphicsMagick use `-auto-orient`).

> The `windows-native` backend does **not** convert HEIC — `System.Drawing`
> lacks a HEIC decoder. On Windows, install ImageMagick, GraphicsMagick, or
> ffmpeg for this operation.

## Failure

If no native backend with HEIC support is available, Prism throws a
[`PrismUnavailableError`](./error-handling.md) for the `convertHeicToJpeg`
operation. Many systems need an explicit HEIC codec/delegate installed for
ImageMagick or ffmpeg.
