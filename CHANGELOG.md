# Changelog

## Unreleased

- Free Photon images when resize or crop fails, including intermediate images allocated before a failed crop.
- Fix Windows-native JPEG conversions without resize, use the documented default quality of 85, and keep WebP input on compatible codec fallbacks.
- Stop shipping the declaration map for unpublished TypeScript sources; preserve declarations and the runtime source map.
- Reject duplicate grayscale-alpha PNG headers before fallback decoding and report corrupt or oversized compressed scanlines as undecodable input.
- Allow WebP byte-budget searches to resize through Photon when no quality control is requested.
- Honor aborted encode signals in internal processing and metadata passthrough, and stop byte-budget searches without returning an earlier candidate after cancellation.

## 0.3.4 - 2026-09-08

- Decode supported BMP input through the existing bounded Photon encode path.
  Validate embedded JPEG/PNG payloads through Photon before native fallback,
  and report native decoder rejections as undecodable input.

## 0.3.3 - 2026-09-05

**Highlights:** Windows resizing preserves image proportions for cover crops and reaches compatible codecs for HEIC/AVIF input.

- Preserve image proportions with centered Windows-native `fit: "cover"` crops instead of stretching to the target box (thanks @SebTardif, #8).
- Let Windows HEIC/AVIF resizing fall through to compatible native codecs instead of failing in GDI+ (thanks @SebTardif, #7).
- Prevent FFmpeg fallback encodes from hanging on an unused stdin pipe (thanks @SebTardif, #3).
- Free Photon images when decoded dimensions exceed the input pixel budget (thanks @SebTardif, #3).
- Fix documentation table-of-contents labels and links for formatted headings (thanks @vincentkoc, #4).
- Refresh TypeScript, Node 22 types, pnpm, formatting/linting tools, CI actions, and Vitest 5 validation.
- Synchronize the checked-in package build with source fixes, check build drift in CI, and verify real image processing from an installed tarball.

## 0.3.2 - 2026-08-09

**Highlight:** HEIF and AVIF images now keep their orientation. Rotated or
mirrored photos from Apple devices previously came out untransformed.

- Auto-orient primary-image HEIF/AVIF `irot` and `imir` transforms. Container transforms were read for dimensions but never applied to pixels, so all eight orientation classes produced identical, unrotated output. Probe and output geometry now stay bound to the same image item, so a file carrying a larger auxiliary image no longer reports that image's dimensions (thanks @lockhartheavyindustries)
- Update the TypeScript, Node types, formatter, linter, and Vitest 3 validation toolchain.

## 0.3.1 - 2026-05-30

- Add `maxBase64Bytes` encode budgets and `base64Bytes` output metadata for model and messaging payload limits.
- Expand coverage for malformed image headers, EXIF orientation handling, native fallback selection, and external encoder error paths.
- Require Node 22 or newer and add a tarball install/import smoke gate to CI.

## 0.3.0 - 2026-05-26

- Add `transparency(input)` for alpha-channel and transparent-pixel inspection across common raster formats.
- Add `execution: "auto" | "internal" | "external"` so callers can keep work in-process, force native tools, or use automatic fallback.
- Collapse writing into `encode(input, options?)` for exact formats, auto format choice, dimension limits, and byte-budget search.
- Remove the documented `encodeWithinBytes` export; migrate `encodeWithinBytes(input, { maxBytes, ...options })` to `encode(input, { maxBytes, ...options })`.
- Add metadata policy controls: transformed outputs strip metadata by default; no-op within-limit auto encodes preserve original bytes unless callers pass `metadata: "strip"`.
- Improve default byte-budget searches so small dimension limits can keep downscaling without explicit `search.maxSide`.
- Add `tsgo`, `oxlint`, `oxfmt`, and an 80% Vitest coverage gate to package validation.
- Keep Photon loading lazy, including default-instance and external-execution paths.
- Expand docs for transparency, execution modes, metadata behavior, and unified `encode`.

## 0.2.0 - 2026-05-26

- Introduce Rastermill as the unscoped Node image-processing package, renamed from the original Prism prototype.
- Add the unified encode API for probing, resizing, re-encoding, and byte-budget searches.
- Add native fallback support through macOS `sips`, ImageMagick, GraphicsMagick, ffmpeg, and Windows native tooling.
- Add configurable temp workspace roots, command resolution, timeouts, process-buffer limits, and pixel-budget safety checks.
- Preserve native fallback parity, byte-search caps, normalized error handling, and the default package export.
- Include built package output and publish the documentation site at `rastermill.com`.
