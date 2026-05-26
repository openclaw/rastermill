# Configuration

Create a configured processor with `createRastermill`, or use the exported module
functions that lazily create a default-configured instance on first use.

```ts
import { createRastermill } from "rastermill";

const rastermill = createRastermill({
  execution: "auto",
  limits: {
    inputPixels: 25_000_000,
    outputPixels: 25_000_000,
  },
  temp: {
    rootDir: "/tmp",
    prefix: "rastermill-",
  },
  timeoutMs: 20_000,
  maxProcessBufferBytes: 1024 * 1024,
});
```

`createRastermill(options?)` returns a `Rastermill` with `probe`,
`transparency`, and `encode`.

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `execution` | `"auto" \| "internal" \| "external"` | `"auto"` | Control whether Rastermill may use external processes. See [Backends](./backends.md). |
| `limits.inputPixels` | `number` | `25_000_000` | Reject decoding any image whose `width × height` exceeds this. |
| `limits.outputPixels` | `number` | falls back to `limits.inputPixels`, else `25_000_000` | Reject resize targets larger than this. |
| `temp.rootDir` | `string` | OS temp dir | Parent directory for external-backend workspaces. |
| `temp.prefix` | `string \| () => string` | `"rastermill-"` | Filename prefix passed to `mkdtemp` for external-backend workspaces. |
| `timeoutMs` | `number` | `20_000` | Per-invocation timeout for external tools. |
| `maxProcessBufferBytes` | `number` | `1_048_576` (1 MiB) | Max stdout/stderr captured from an external tool. |
| `commandResolver` | `ImageCommandResolver` | PATH lookup | Resolve an external command name to an absolute path (or `null` if absent). |

All numeric options must be positive safe integers; otherwise `createRastermill`
throws.
`temp.prefix` must be a filename prefix, not a path.

## Pixel budgets

Rastermill never trusts an image it cannot measure. Before any decode it reads the
header dimensions and checks them against `limits.inputPixels`; an image with
unknown dimensions or one over the limit is refused. For resize operations it
also projects the output dimensions and checks them against `limits.outputPixels`.

This guards against decompression bombs: a small file claiming enormous
dimensions is rejected before a decoder allocates memory for it.

```ts
const rastermill = createRastermill({ limits: { inputPixels: 4_000_000 } });
await rastermill.encode(hugeImage, { format: "jpeg", resize: { maxSide: 1024 } }); // throws if input > 4 MP
```

## External backend temp workspaces

External backends receive image bytes through a temporary workspace. Use
`temp.rootDir` when your app has a private temp root, and use a `temp.prefix`
function when each operation needs a fresh traceable prefix.

```ts
const rastermill = createRastermill({
  temp: {
    rootDir: "/run/my-app/tmp",
    prefix: () => `my-app-img-${crypto.randomUUID()}-`,
  },
});
```

## Execution mode

`execution` is the broad runtime boundary:

- `"auto"` uses Photon in-process where it can and external tools for codecs Photon does not support.
- `"internal"` forbids child processes and only uses in-process backends.
- `"external"` skips in-process backends and only uses native tools.

Use `"internal"` for strict sandboxes and serverless runtimes. Keep `"auto"` if
you need HEIC/AVIF conversion today.

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
They lazily create a default `Rastermill` instance on first use (`execution:
"auto"`, 25 MP budgets):

```ts
import { probe, encode } from "rastermill";

const info = await probe(buf);
const jpeg = await encode(buf, { format: "jpeg", resize: { maxSide: 1600 } });
```
