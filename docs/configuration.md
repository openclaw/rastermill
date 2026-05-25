# Configuration

Create a configured processor with `createPrism`, or use the exported module
functions that share a single default-configured instance.

```ts
import { createPrism } from "@openclaw/prism";

const prism = createPrism({
  backend: "auto",
  maxInputPixels: 25_000_000,
  maxOutputPixels: 25_000_000,
  timeoutMs: 20_000,
  maxProcessBufferBytes: 1024 * 1024,
});
```

`createPrism(options?)` returns a `Prism` with `metadata`, `normalize`,
`toJpeg`, `toPng`, `optimizePng`, `convertHeicToJpeg`, and `hasAlpha`.

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `backend` | `ImageBackendPreference` | `"auto"` (or env) | Force a backend or let Prism pick. See [Backends](./backends.md). |
| `maxInputPixels` | `number` | `25_000_000` | Reject decoding any image whose `width × height` exceeds this. |
| `maxOutputPixels` | `number` | falls back to `maxInputPixels`, else `25_000_000` | Reject resize targets larger than this. |
| `timeoutMs` | `number` | `20_000` | Per-invocation timeout for external tools. |
| `maxProcessBufferBytes` | `number` | `1_048_576` (1 MiB) | Max stdout/stderr captured from an external tool. |
| `envBackendVariable` | `string` | `"PRISM_IMAGE_BACKEND"` | Name of the env var read for the backend preference. |
| `commandResolver` | `ImageCommandResolver` | PATH lookup | Resolve an external command name to an absolute path (or `null` if absent). |

All numeric options must be positive safe integers; otherwise `createPrism`
throws.

## Pixel budgets

Prism never trusts an image it cannot measure. Before any decode it reads the
header dimensions and checks them against `maxInputPixels`; an image with
unknown dimensions or one over the limit is refused. For resize operations it
also projects the output dimensions and checks them against `maxOutputPixels`.

This guards against decompression bombs: a small file claiming enormous
dimensions is rejected before a decoder allocates memory for it.

```ts
const prism = createPrism({ maxInputPixels: 4_000_000 });
await prism.toJpeg(hugeImage, { maxSide: 1024 }); // throws if input > 4 MP
```

## Backend preference from the environment

When `backend` is not passed, Prism reads the preference from the environment.
It checks `envBackendVariable` (default `PRISM_IMAGE_BACKEND`) first, then
`OPENCLAW_IMAGE_BACKEND`. Values are case-insensitive and a few aliases are
accepted:

- `windows`, `powershell`, `system.drawing`, `systemdrawing` → `windows-native`
- `magick`, `convert` → `imagemagick`
- `gm` → `graphicsmagick`
- anything unrecognized → `auto`

```sh
PRISM_IMAGE_BACKEND=imagemagick node app.js
```

## Custom command resolution

`commandResolver` lets you control how external tool names map to executables —
useful for sandboxes, custom install paths, or tests. It receives a command
name (e.g. `"magick"`) and returns an absolute path, or `null` when the tool is
unavailable. The default resolver walks `PATH` (honoring `PATHEXT` on Windows).

```ts
const prism = createPrism({
  commandResolver: (cmd) => (cmd === "magick" ? "/opt/im/bin/magick" : null),
});
```

## Module functions

For one-off calls you can skip `createPrism` and import the functions directly.
They use a default `Prism` instance (`backend: "auto"`, 25 MP budgets):

```ts
import { metadata, toJpeg } from "@openclaw/prism";

const info = await metadata(buf);
const jpeg = await toJpeg(buf, { maxSide: 1600 });
```
