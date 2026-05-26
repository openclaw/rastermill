# Error handling

Rastermill distinguishes "no backend could do this" from validation and decode
failures. All Rastermill-owned failures carry a stable `code`.

## `RastermillError`

```ts
class RastermillError extends Error {
  readonly code:
    | "RASTERMILL_INPUT_TOO_LARGE"
    | "RASTERMILL_OUTPUT_TOO_LARGE"
    | "RASTERMILL_BAD_OPTION"
    | "RASTERMILL_UNDECODABLE"
    | "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE";
}
```

Use `isRastermillError(error)` when you want to branch on these codes without
matching error-message text:

```ts
import { isRastermillError } from "rastermill";

if (isRastermillError(error) && error.code === "RASTERMILL_INPUT_TOO_LARGE") {
  return null;
}
```

## `RastermillUnavailableError`

Thrown when every candidate backend for an operation is unavailable — missing
executables, a missing Photon package, unsupported formats, or absent codecs.

```ts
class RastermillUnavailableError extends RastermillError {
  readonly code: "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE";
  readonly operation: "encode";
  readonly causes: unknown[]; // the per-backend errors collected
}
```

- `code` is the stable string `"RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE"`.
- `operation` is always `"encode"` (the single operation that runs backends).
- `causes` holds the error thrown by each attempted backend, in order. The
  standard `Error.cause` is set to the first `Error` among them.
- `message` lists the backends Rastermill tried.

## `isRastermillUnavailableError`

A type guard for branching on availability versus other failures:

```ts
import { isRastermillUnavailableError } from "rastermill";

try {
  return await rastermill.encode(buffer, { format: "jpeg" });
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
the backend is merely *unavailable* — for example `ENOENT`, a missing executable,
a missing Photon package, an unsupported format, or a missing codec delegate —
Rastermill records it and tries the next backend.

Any other error (a present backend rejecting a genuinely malformed image, a
timeout, an output-buffer overflow) is thrown immediately and is **not** wrapped
in a `RastermillUnavailableError`. This way a corrupt file fails loudly instead of
being mistaken for a missing tool.

## Validation errors

Pixel-budget and option violations throw `RastermillError`s before any backend
runs:

- `RASTERMILL_INPUT_TOO_LARGE`: dimensions exceed `limits.inputPixels`
- `RASTERMILL_OUTPUT_TOO_LARGE`: resize target exceeds `limits.outputPixels`
- `RASTERMILL_UNDECODABLE`: unknown dimensions or decode failure
- `RASTERMILL_BAD_OPTION`: invalid option values, e.g. a non-positive `resize.maxSide`

Note that [`probe`](./probe.md) is lenient: it returns `null` instead of
throwing when an image is over budget or undecodable.
