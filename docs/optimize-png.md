# `optimizePng`

Shrink a PNG until it fits under a byte budget, trading off dimensions and
compression level.

```ts
optimizePng(input: ImageInput, options: OptimizePngOptions): Promise<OptimizedPng>
```

```ts
const result = await prism.optimizePng(buffer, {
  maxBytes: 500_000,
});

console.log(result.optimizedSize, result.resizeSide, result.compressionLevel);
```

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `maxBytes` | `number` | — (required) | Target ceiling for the encoded PNG size. |
| `sides` | `readonly number[]` | `[2048, 1536, 1280, 1024, 800]` | Candidate `maxSide` values to try, in order. |
| `compressionLevels` | `readonly number[]` | `[6, 7, 8, 9]` | Candidate deflate levels to try, in order. |

## Result

`OptimizedPng`:

| Field | Type | Meaning |
| --- | --- | --- |
| `buffer` | `Buffer` | The encoded PNG. |
| `optimizedSize` | `number` | `buffer.length` in bytes. |
| `resizeSide` | `number` | The `maxSide` value that produced this result. |
| `compressionLevel` | `number` | The deflate level that produced this result. |

## Behavior

Prism walks every `side × compressionLevel` combination in order. Each candidate
is produced via [`toPng`](./to-png.md) with `withoutEnlargement: true`, so the
image is never upscaled.

- The **first** candidate at or under `maxBytes` is returned immediately.
- If none fits the budget, the **smallest** candidate produced is returned —
  `optimizePng` always returns its best effort rather than failing on an
  unreachable budget.
- If every attempt fails to produce an image (e.g. no usable backend), the first
  encountered error is thrown.

Because larger sides and lower compression levels come first, a budget that's
easy to hit returns quickly at higher quality, while a tight budget walks toward
smaller, more-compressed candidates.
