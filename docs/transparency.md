# `transparency`

Decode an image and inspect alpha facts.

```ts
const alpha = await rastermill.transparency(input);
// => { hasAlphaChannel, hasTransparentPixels }
```

`probe` gives a cheap header hint. `transparency` answers the pixel question. It
uses Photon for PNG, JPEG, GIF, and WebP, including PNG variants whose alpha
cannot be answered from the header alone.

## Result

```ts
type ImageTransparency = {
  hasAlphaChannel: boolean;
  hasTransparentPixels: boolean;
};
```

- `hasAlphaChannel` means the decoded image or source header has an alpha
  channel.
- `hasTransparentPixels` means at least one decoded pixel has alpha below 255.

An opaque RGBA PNG reports `{ hasAlphaChannel: true, hasTransparentPixels: false
}`. A transparent GIF reports both as `true`. JPEG reports both as `false`
without a decode.

## Errors

`transparency` enforces `limits.inputPixels` before decoding. Unlike `probe`, it
throws on oversized or undecodable input. Unsupported internal formats such as
HEIC/AVIF throw `RastermillUnavailableError` because Photon cannot decode them.

`transparency` never spawns external tools today. If you create Rastermill with
`execution: "external"` or pin an external backend, alpha-capable inputs throw
`RastermillUnavailableError` instead of loading Photon.
