import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { createRastermill, encodePngRgba, isRastermillUnavailableError } from "../dist/index.js";

assert.equal(process.platform, "win32", "This smoke check requires native Windows");
const greenPixels = new Uint8Array(64 * 64 * 4);
for (let offset = 0; offset < greenPixels.length; offset += 4) {
  greenPixels[offset + 1] = 255;
  greenPixels[offset + 3] = 255;
}
const webp = await createRastermill({ execution: "internal" }).encode(
  encodePngRgba(greenPixels, 64, 64),
  { format: "webp" },
);
for (const format of ["heic", "avif", "webp"]) {
  const input =
    format === "webp"
      ? webp.data
      : Buffer.from(
          await readFile(
            new URL(`../test/fixtures/green.${format}.base64`, import.meta.url),
            "utf8",
          ),
          "base64",
        );
  const native = createRastermill({
    execution: "external",
    commandResolver: (command) => (command === "powershell" ? command : null),
  });
  await assert.rejects(
    native.encode(input, { format: "jpeg", resize: { maxSide: 32 } }),
    (error) =>
      isRastermillUnavailableError(error) &&
      error.causes.some((cause) => /does not convert HEIC|cannot decode WebP/.test(String(cause))),
  );
  const attempted = [];
  const rastermill = createRastermill({
    execution: "external",
    commandResolver: (command) => {
      attempted.push(command);
      return command === "powershell" || command === "ffmpeg" ? command : null;
    },
  });
  const result = await rastermill.encode(input, {
    format: "jpeg",
    resize: { maxSide: 32 },
  });
  assert.equal(result.width, 32);
  assert.equal(result.height, 32);
  assert.equal(result.format, "jpeg");
  assert.deepEqual(attempted, ["powershell", "magick", "gm", "ffmpeg"]);
  const decoded = PhotonImage.new_from_byteslice(result.data);
  try {
    assert.equal(decoded.get_width(), 32);
    assert.equal(decoded.get_height(), 32);
    const pixels = decoded.get_raw_pixels();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      assert.ok(pixels[offset] < 40 && pixels[offset + 1] > 210 && pixels[offset + 2] < 40);
    }
  } finally {
    decoded.free();
  }
  console.log(`${format} -> jpeg: Windows native skipped; FFmpeg encoded 32x32 green pixels`);
  if (format === "webp") {
    const unresized = await rastermill.encode(input, { format: "jpeg" });
    assert.equal(unresized.width, 64);
    assert.equal(unresized.height, 64);
    assert.equal(unresized.resized, false);
    const fullSize = PhotonImage.new_from_byteslice(unresized.data);
    try {
      const pixels = fullSize.get_raw_pixels();
      for (let offset = 0; offset < pixels.length; offset += 4) {
        assert.ok(pixels[offset] < 40 && pixels[offset + 1] > 210 && pixels[offset + 2] < 40);
      }
    } finally {
      fullSize.free();
    }
    console.log("webp -> jpeg without resize: FFmpeg encoded 64x64 green pixels");
  }
}
