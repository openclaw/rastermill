# `encodeWithinBytes`

Encode an image to fit under a byte budget.

```ts
const out = await rastermill.encodeWithinBytes(input, {
  format: "jpeg",
  maxBytes: 500_000,
  search: { maxSide: [2048, 1536, 1024], quality: [85, 70, 55] },
});
// => EncodedImage & { withinBudget, chosen: { maxSide?, quality?, compressionLevel? } }
```

It re-encodes across a search space and returns the first result at or under
`maxBytes`. If nothing fits, it returns the smallest result it produced (so you
always get usable bytes). `withinBudget` tells you whether the cap was met, and
`chosen` reports which settings were used.

## Options

```ts
type EncodeWithinBytesOptions = EncodeOptions & {
  maxBytes: number;
  search?: {
    maxSide?: readonly number[];        // dimensions to try, largest first
    quality?: readonly number[];        // JPEG quality steps
    compressionLevel?: readonly number[]; // PNG compression steps
  };
};
```

The search iterates `maxSide` outermost, then the format-relevant axis: `quality`
for JPEG, `compressionLevel` for PNG, and dimensions only for WebP. Sensible
defaults are used for any axis you omit. All other `EncodeOptions` (e.g.
`resize.fit`, `autoOrient`, `signal`) are forwarded to each attempt.

## JPEG vs PNG vs WebP

- **JPEG**: searches `maxSide × quality`. Best for photos under a hard cap.
- **PNG**: searches `maxSide × compressionLevel`. Lossless, so shrinking
  dimensions does most of the work.
- **WebP**: searches `maxSide`. Photon's WebP encoder does not expose quality,
  so Rastermill does not expose a WebP quality option yet.

```ts
// Shrink a PNG under 256 KB, lossless.
const png = await rastermill.encodeWithinBytes(input, {
  format: "png",
  maxBytes: 256_000,
});
```

## Result

The return value is a normal [`encode`](./encode.md) result plus `chosen`:

```ts
type EncodedImageWithinBytes = EncodedImage & {
  withinBudget: boolean;
  chosen: { maxSide?: number; quality?: number; compressionLevel?: number };
};
```
