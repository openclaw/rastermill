import assert from "node:assert/strict";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { createRastermill, encodePngRgba } from "../dist/index.js";

assert.equal(process.platform, "win32", "This smoke check requires native Windows");
const rastermill = createRastermill({
  execution: "external",
  commandResolver: (command) => (command === "powershell" ? command : null),
});

function bandedImage(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  const landscape = width > height;
  const length = landscape ? width : height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const coordinate = landscape ? x : y;
      const channel = coordinate < length / 4 ? 0 : coordinate < (length * 3) / 4 ? 1 : 2;
      const offset = (y * width + x) * 4;
      pixels[offset + channel] = 255;
      pixels[offset + 3] = 255;
    }
  }
  return encodePngRgba(pixels, width, height);
}

const converted = await rastermill.encode(bandedImage(200, 100), {
  format: "jpeg",
  quality: 95,
});
assert.equal(converted.width, 200);
assert.equal(converted.height, 100);
assert.equal(converted.resized, false);
assert.equal(converted.metadata, "stripped");
const convertedPixels = PhotonImage.new_from_byteslice(converted.data);
try {
  assert.equal(convertedPixels.get_width(), 200);
  assert.equal(convertedPixels.get_height(), 100);
  const pixels = convertedPixels.get_raw_pixels();
  for (const [x, channel] of [
    [10, 0],
    [100, 1],
    [190, 2],
  ]) {
    const rgb = Array.from(pixels.slice((50 * 200 + x) * 4, (50 * 200 + x) * 4 + 3));
    assert.ok(rgb[channel] > 180, `no-resize JPEG: expected channel ${channel}, got ${rgb}`);
    assert.ok(rgb.filter((_, c) => c !== channel).every((value) => value < 80));
  }
  console.log("jpeg no-resize conversion: 200x100, red/green/blue bands preserved");
} finally {
  convertedPixels.free();
}

for (const format of ["jpeg", "png"]) {
  for (const sample of [
    { name: "landscape", width: 200, height: 100, target: 100, output: 100 },
    { name: "portrait", width: 100, height: 200, target: 100, output: 100 },
    { name: "downscale", width: 400, height: 200, target: 100, output: 100 },
    { name: "enlarge", width: 80, height: 40, target: 100, output: 100, enlarge: true },
    { name: "no-enlarge", width: 80, height: 40, target: 100, output: 40 },
  ]) {
    const source = bandedImage(sample.width, sample.height);
    for (const fit of ["cover", "fill", "inside"]) {
      const result = await rastermill.encode(source, {
        format,
        resize: {
          fit,
          width: sample.target,
          height: sample.target,
          enlarge: sample.enlarge === true,
        },
      });
      let expectedWidth;
      let expectedHeight;
      if (fit === "cover") {
        expectedWidth = sample.output;
        expectedHeight = sample.output;
      } else if (fit === "fill" && sample.name !== "no-enlarge") {
        expectedWidth = sample.target;
        expectedHeight = sample.target;
      } else {
        const scale = Math.min(1, sample.target / Math.max(sample.width, sample.height));
        // The enlarged sample already fits inside the box; inside may upscale it.
        const insideScale = sample.enlarge
          ? sample.target / Math.max(sample.width, sample.height)
          : scale;
        expectedWidth = sample.width * insideScale;
        expectedHeight = sample.height * insideScale;
      }
      assert.equal(result.width, expectedWidth, `${sample.name} ${fit} width`);
      assert.equal(result.height, expectedHeight, `${sample.name} ${fit} height`);
      const decoded = PhotonImage.new_from_byteslice(result.data);
      try {
        assert.equal(decoded.get_width(), result.width);
        assert.equal(decoded.get_height(), result.height);
        const pixels = decoded.get_raw_pixels();
        const landscape = sample.width > sample.height;
        const points = landscape
          ? [
              [3, Math.floor(result.height / 2)],
              [result.width - 4, Math.floor(result.height / 2)],
            ]
          : [
              [Math.floor(result.width / 2), 3],
              [Math.floor(result.width / 2), result.height - 4],
            ];
        const colors = points.map(([x, y]) =>
          Array.from(pixels.slice((y * result.width + x) * 4, (y * result.width + x) * 4 + 3)),
        );
        for (const [index, rgb] of colors.entries()) {
          const channel = fit === "cover" ? 1 : index === 0 ? 0 : 2;
          assert.ok(
            rgb[channel] > 180,
            `${sample.name} ${fit}: expected color channel ${channel}, got ${rgb}`,
          );
          assert.ok(rgb.filter((_, c) => c !== channel).every((value) => value < 80));
        }
        console.log(
          `${format} ${sample.name} ${fit}: ${result.width}x${result.height}, edge RGB ${JSON.stringify(colors)}`,
        );
      } finally {
        decoded.free();
      }
    }
  }
}
