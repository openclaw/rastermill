# Error handling

Rastermill distinguishes "no backend could do this" from "this specific image is
broken," and surfaces the former through a dedicated error type.

## `RastermillUnavailableError`

Thrown when every candidate backend for an operation is unavailable — missing
executables, a missing Photon package, unsupported formats, or absent codecs.

```ts
class RastermillUnavailableError extends Error {
  readonly code: "PRISM_IMAGE_PROCESSOR_UNAVAILABLE";
  readonly operation: ImageOperation; // e.g. "toJpeg", "convertHeicToJpeg"
  readonly causes: unknown[];         // the per-backend errors collected
}
```

- `code` is the stable string `"PRISM_IMAGE_PROCESSOR_UNAVAILABLE"`.
- `operation` names the failing operation.
- `causes` holds the error thrown by each attempted backend, in order. The
  standard `Error.cause` is set to the first `Error` among them.
- `message` lists the backends Rastermill tried.

## `isRastermillUnavailableError`

A type guard for branching on availability versus other failures:

```ts
import { isRastermillUnavailableError } from "@openclaw/rastermill";

try {
  return await rastermill.convertHeicToJpeg(buffer);
} catch (error) {
  if (isRastermillUnavailableError(error)) {
    // No HEIC-capable backend installed — degrade gracefully.
    return null;
  }
  throw error; // A real decode/processing failure: let it propagate.
}
```

## Unavailable vs. real errors

During automatic fallback Rastermill inspects each backend's error. If it looks like
the backend is merely *unavailable* — for example `ENOENT`, "command not
found", "cannot decode", "decode delegate", "unsupported image format", or a
missing Photon package — Rastermill records it and tries the next backend.

Any other error (a present backend rejecting a genuinely malformed image, a
timeout, an output-buffer overflow) is thrown immediately and is **not** wrapped
in a `RastermillUnavailableError`. This way a corrupt file fails loudly instead of
being mistaken for a missing tool.

## Validation errors

Pixel-budget and option violations throw plain `Error`s before any backend
runs, with descriptive messages:

- dimensions exceed `maxInputPixels`
- resize target exceeds `maxOutputPixels`
- unknown dimensions ("refusing to process")
- invalid option values (e.g. a non-positive `maxSide`)

Note that [`metadata`](./metadata.md) is lenient: it returns `null` instead of
throwing when an image is over budget or undecodable.
