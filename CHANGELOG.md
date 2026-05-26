# Changelog

## 0.3.0 - 2026-05-26

- Add `transparency(input)` for alpha-channel and transparent-pixel inspection across common raster formats.
- Add `execution: "auto" | "internal" | "external"` so callers can keep work in-process, force native tools, or use automatic fallback.
- Collapse writing into `encode(input, options?)` for exact formats, auto format choice, dimension limits, and byte-budget search.
- Remove the documented `encodeWithinBytes` export; migrate `encodeWithinBytes(input, { maxBytes, ...options })` to `encode(input, { maxBytes, ...options })`.
- Add metadata policy controls: transformed outputs strip metadata by default; no-op within-limit auto encodes preserve original bytes unless callers pass `metadata: "strip"`.
- Improve default byte-budget searches so small dimension limits can keep downscaling without explicit `search.maxSide`.
- Keep Photon loading lazy, including default-instance and external-execution paths.
- Expand docs for transparency, execution modes, metadata behavior, and unified `encode`.

## 0.2.0 - 2026-05-26

- Introduce Rastermill as the unscoped Node image-processing package, renamed from the original Prism prototype.
- Add the unified encode API for probing, resizing, re-encoding, and byte-budget searches.
- Add native fallback support through macOS `sips`, ImageMagick, GraphicsMagick, ffmpeg, and Windows native tooling.
- Add configurable temp workspace roots, command resolution, timeouts, process-buffer limits, and pixel-budget safety checks.
- Preserve native fallback parity, byte-search caps, normalized error handling, and the default package export.
- Include built package output and publish the documentation site at `rastermill.com`.
