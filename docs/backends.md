# Backends

Rastermill can run an operation through several backends. With `backend: "auto"`
(the default) it tries them in a sensible order for the current platform and
operation, falling back to the next when one is unavailable. You can also pin a
single backend.

## Available backends

| Backend | Engine | Notes |
| --- | --- | --- |
| `photon` | In-process WASM ([Photon](https://github.com/silvia-odwyer/photon)) | Fast, no external process. Decodes PNG, JPEG, GIF, WebP. Encodes JPEG, PNG, WebP. Cannot decode HEIC/AVIF. |
| `sips` | macOS `/usr/bin/sips` | macOS only. JPEG output (incl. HEIC/AVIF → JPEG); not used for PNG. |
| `windows-native` | Windows PowerShell + `System.Drawing` | Windows only. JPEG and PNG; does not convert HEIC. |
| `imagemagick` | `magick` (or `convert`) | Broad format support, including HEIC/AVIF where codecs are installed. |
| `graphicsmagick` | `gm` | Similar coverage to ImageMagick. |
| `ffmpeg` | `ffmpeg` | Used for JPEG/WebP output and HEIC→JPEG; not used for PNG. |

## Automatic order

When `backend: "auto"`, the candidate list depends on the output format and the
platform. Photon is tried first whenever it can handle the format, then native
tools fill the gaps.

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

## Forcing a backend

Pass `backend` to `createRastermill` (or set the env var — see
[Configuration](./configuration.md)) to pin one:

```ts
const rastermill = createRastermill({ backend: "imagemagick" });
```

When pinned, Rastermill uses only that backend and does not fall back. If it's
unavailable for the operation, you get a `RastermillUnavailableError`.
