# Backends

Rastermill can run either in-process, through native tools, or in automatic mode
that uses both. `execution: "auto"` is the default: it uses Photon for common
formats and falls through to external tools for codecs Photon does not support.

Use `execution: "internal"` to forbid child processes. Use
`execution: "external"` when you explicitly want native tool behavior.

## Available backends

| Backend | Engine | Notes |
| --- | --- | --- |
| `photon` | In-process WASM ([Photon](https://github.com/silvia-odwyer/photon)) | Fast, no external process. Decodes PNG, JPEG, GIF, WebP. Encodes JPEG, PNG, WebP. Cannot decode HEIC/AVIF, cannot set WebP quality, and exposes no EXIF/GPS/ICC/XMP metadata API. |
| `sips` | macOS `/usr/bin/sips` | macOS only. JPEG output (incl. HEIC/AVIF → JPEG); not used for PNG. |
| `windows-native` | Windows PowerShell + `System.Drawing` | Windows only. JPEG and PNG; does not convert HEIC. |
| `imagemagick` | `magick` (or `convert`) | Broad format support, including HEIC/AVIF where codecs are installed. |
| `graphicsmagick` | `gm` | Similar coverage to ImageMagick. |
| `ffmpeg` | `ffmpeg` | Used for JPEG/WebP output and HEIC→JPEG; not used for PNG. |

## Automatic order

When `execution: "auto"`, the candidate list depends on the output format and
the platform. Photon is tried first whenever it can handle the format, then
native tools fill the gaps.

`encode` to JPEG (this also covers HEIC/AVIF → JPEG, where Photon fails to decode
and falls through to native):

- macOS: `photon → sips → imagemagick → graphicsmagick → ffmpeg`
- Windows: `photon → windows-native → imagemagick → graphicsmagick → ffmpeg`
- Linux/other: `photon → imagemagick → graphicsmagick → ffmpeg`

`encode` to PNG (ffmpeg/sips can't be relied on for PNG):

- Windows: `photon → windows-native → imagemagick → graphicsmagick`
- everywhere else: `photon → imagemagick → graphicsmagick`

`encode` to WebP:

- all platforms: `photon → imagemagick → graphicsmagick → ffmpeg`

If WebP `quality` is set, Photon is skipped because its WebP encoder is
fixed-quality. In `execution: "internal"`, quality-controlled WebP therefore
fails with `RastermillUnavailableError`.

## Metadata

Rastermill strips metadata by default. Photon outputs fresh pixel-derived bytes,
and native ImageMagick/GraphicsMagick/ffmpeg paths pass explicit strip flags
where those tools support them. JPEG outputs also pass through Rastermill's own
APP/COM segment stripper so macOS `sips` output follows the same privacy
contract.

`metadata: "preserve"` is only a passthrough optimization: Rastermill may return
the original bytes unchanged when format, dimensions, orientation, and explicit
quality/compression work already match. Photon cannot copy metadata across a
real transform, so transformed outputs report `metadata: "stripped"`.

## How fallback works

For each candidate backend, Rastermill runs the operation. If it throws an error that
indicates the backend is simply *unavailable* — a missing executable, a missing
Photon package, an unsupported/undecodable format, a missing codec delegate —
Rastermill records the error and tries the next backend. Any other error (for
example, a malformed image that a present backend rejects) is thrown
immediately.

If every candidate is unavailable, Rastermill throws a
[`RastermillUnavailableError`](./error-handling.md) listing the backends it tried and
the collected causes.

## Execution modes

```ts
createRastermill({ execution: "auto" });     // Photon first, native tools as needed
createRastermill({ execution: "internal" }); // no child processes
createRastermill({ execution: "external" }); // native tools only
```

`execution: "internal"` currently supports PNG, JPEG, GIF, and WebP input through
Photon. It cannot decode HEIC/AVIF, so those operations fail with
`RastermillUnavailableError` instead of spawning `sips`, ImageMagick, or ffmpeg.
