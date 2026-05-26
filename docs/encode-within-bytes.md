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
for JPEG/WebP, and `compressionLevel` for PNG. Sensible defaults are used for
any axis you omit. All other `EncodeOptions` (e.g. `resize.fit`, `autoOrient`,
`metadata`, `signal`) are forwarded to each attempt.

## JPEG vs PNG vs WebP

- **JPEG**: searches `maxSide × quality`. Best for photos under a hard cap.
- **PNG**: searches `maxSide × compressionLevel`. Lossless, so shrinking
  dimensions does most of the work.
- **WebP**: searches `maxSide × quality`, but quality-controlled WebP requires
  an external backend. Photon's WebP encoder is fixed-quality.

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

The embedded `EncodedImage` includes `metadata: "stripped" | "preserved"`.
Because byte-budget encoding always performs encode attempts, metadata is
normally `"stripped"` unless a caller explicitly requested `metadata:
"preserve"` and the selected candidate could reuse the original bytes unchanged.
