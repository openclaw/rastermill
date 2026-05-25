# `encodeWithinBytes`

Encode an image under a byte budget, trading off dimensions, quality, or PNG
compression level.

```ts
encodeWithinBytes(input: ImageInput, options: EncodeWithinBytesOptions): Promise<EncodedImageWithinBytes>
optimizePng(input: ImageInput, options: OptimizePngOptions): Promise<OptimizedPng>
```

```ts
const result = await rastermill.encodeWithinBytes(buffer, {
  format: "jpeg",
  maxBytes: 500_000,
  search: {
    maxSide: [2048, 1536, 1024],
    quality: [85, 75, 65],
  },
});

console.log(result.bytes, result.width, result.height, result.chosen);
```

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `format` | `"jpeg"` or `"png"` | — (required) | Output format. |
| `maxBytes` | `number` | — (required) | Target ceiling for encoded size. |
| `search.maxSide` | `readonly number[]` | `[2048, 1536, 1280, 1024, 800]` | Candidate `maxSide` values to try, in order. |
| `search.quality` | `readonly number[]` | JPEG quality steps | JPEG quality candidates. |
| `search.compressionLevel` | `readonly number[]` | PNG compression steps | PNG deflate level candidates. |

## Result

`EncodedImageWithinBytes`:

| Field | Type | Meaning |
| --- | --- | --- |
| `data` | `Buffer` | The encoded image. |
| `bytes` | `number` | `data.length` in bytes. |
| `width` / `height` | `number` | Final output dimensions. |
| `chosen` | `object` | The search values that produced this result. |

## Behavior

Rastermill walks the requested search axes in order. Each candidate is produced
via [`encode`](./to-jpeg.md) with `resize.enlarge` defaulting to `false`, so the
image is never upscaled unless you opt into it.

- The **first** candidate at or under `maxBytes` is returned immediately.
- If none fits the budget, the **smallest** candidate produced is returned —
  `encodeWithinBytes` always returns its best effort rather than failing on an
  unreachable budget.
- If every attempt fails to produce an image (e.g. no usable backend), the first
  encountered error is thrown.

Because larger sides and lower compression levels come first, a budget that's
easy to hit returns quickly at higher quality, while a tight budget walks toward
smaller or more-compressed candidates.

`optimizePng` is kept as a compatibility wrapper over `encodeWithinBytes`.
