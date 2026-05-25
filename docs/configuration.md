# Configuration

Create a configured processor with `createRastermill`, or use the exported module
functions that share a single default-configured instance.

```ts
import { createRastermill } from "rastermill";

const rastermill = createRastermill({
  backend: "auto",
  limits: {
    inputPixels: 25_000_000,
    outputPixels: 25_000_000,
  },
  timeoutMs: 20_000,
  maxProcessBufferBytes: 1024 * 1024,
});
```

`createRastermill(options?)` returns a `Rastermill` with `probe`, `encode`,
`encodeWithinBytes`, and compatibility wrappers such as `metadata`, `toJpeg`,
`toPng`, `optimizePng`, `convertHeicToJpeg`, and `hasAlpha`.

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `backend` | `ImageBackendPreference` | `"auto"` (or env) | Force a backend or let Rastermill pick. See [Backends](./backends.md). |
| `limits.inputPixels` | `number` | `25_000_000` | Reject decoding any image whose `width × height` exceeds this. |
| `limits.outputPixels` | `number` | falls back to `limits.inputPixels`, else `25_000_000` | Reject resize targets larger than this. |
| `maxInputPixels` | `number` | `25_000_000` | Compatibility alias for `limits.inputPixels`. |
| `maxOutputPixels` | `number` | input limit | Compatibility alias for `limits.outputPixels`. |
| `timeoutMs` | `number` | `20_000` | Per-invocation timeout for external tools. |
| `maxProcessBufferBytes` | `number` | `1_048_576` (1 MiB) | Max stdout/stderr captured from an external tool. |
| `env.backendVar` | `string` | `"RASTERMILL_IMAGE_BACKEND"` | Name of the env var read for the backend preference. |
| `envBackendVariable` | `string` | `"RASTERMILL_IMAGE_BACKEND"` | Compatibility alias for `env.backendVar`. |
| `commandResolver` | `ImageCommandResolver` | PATH lookup | Resolve an external command name to an absolute path (or `null` if absent). |

All numeric options must be positive safe integers; otherwise `createRastermill`
throws.

## Pixel budgets

Rastermill never trusts an image it cannot measure. Before any decode it reads the
header dimensions and checks them against `maxInputPixels`; an image with
unknown dimensions or one over the limit is refused. For resize operations it
also projects the output dimensions and checks them against `maxOutputPixels`.

This guards against decompression bombs: a small file claiming enormous
dimensions is rejected before a decoder allocates memory for it.

```ts
const rastermill = createRastermill({ limits: { inputPixels: 4_000_000 } });
await rastermill.toJpeg(hugeImage, { maxSide: 1024 }); // throws if input > 4 MP
```

## Backend preference from the environment

When `backend` is not passed, Rastermill reads the preference from the environment.
It checks `env.backendVar` or `envBackendVariable` (default
`RASTERMILL_IMAGE_BACKEND`). Values are case-insensitive and a few aliases are
accepted. App-specific environment names are intentionally not hard-coded; pass
`env: { backendVar: "YOUR_APP_IMAGE_BACKEND" }` if you need one.

- `windows`, `powershell`, `system.drawing`, `systemdrawing` → `windows-native`
- `magick`, `convert` → `imagemagick`
- `gm` → `graphicsmagick`
- anything unrecognized → `auto`

```sh
RASTERMILL_IMAGE_BACKEND=imagemagick node app.js
```

## Custom command resolution

`commandResolver` lets you control how external tool names map to executables —
useful for sandboxes, custom install paths, or tests. It receives a command
name (e.g. `"magick"`) and returns an absolute path, or `null` when the tool is
unavailable. The default resolver walks `PATH` (honoring `PATHEXT` on Windows).

```ts
const rastermill = createRastermill({
  commandResolver: (cmd) => (cmd === "magick" ? "/opt/im/bin/magick" : null),
});
```

## Module functions

For one-off calls you can skip `createRastermill` and import the functions directly.
They use a default `Rastermill` instance (`backend: "auto"`, 25 MP budgets):

```ts
import { metadata, toJpeg } from "rastermill";

const info = await metadata(buf);
const jpeg = await toJpeg(buf, { maxSide: 1600 });
```
