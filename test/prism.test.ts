import { describe, expect, it } from "vitest";
import {
  createPrism,
  encodePngRgba,
  PrismUnavailableError,
  readImageMetadataFromHeader,
} from "../src/index.js";

function rgbaImage(width: number, height: number, alpha = 255): Buffer {
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 0x20;
    pixels[offset + 1] = 0x80;
    pixels[offset + 2] = 0xe0;
    pixels[offset + 3] = alpha;
  }
  return encodePngRgba(pixels, width, height);
}

function tiffImageFileDirectories(
  pages: readonly { width: number; height: number }[],
  options?: { subIfd?: boolean },
): Buffer {
  const entryCount = options?.subIfd ? 3 : 2;
  const ifdSize = 2 + entryCount * 12 + 4;
  const buffer = Buffer.alloc(8 + ifdSize * pages.length);
  buffer.write("II", 0, "ascii");
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(8, 4);

  pages.forEach((page, pageIndex) => {
    const ifdOffset = 8 + pageIndex * ifdSize;
    buffer.writeUInt16LE(entryCount, ifdOffset);
    const writeEntry = (entryIndex: number, tag: number, value: number) => {
      const offset = ifdOffset + 2 + entryIndex * 12;
      buffer.writeUInt16LE(tag, offset);
      buffer.writeUInt16LE(4, offset + 2);
      buffer.writeUInt32LE(1, offset + 4);
      buffer.writeUInt32LE(value, offset + 8);
    };
    writeEntry(0, 256, page.width);
    writeEntry(1, 257, page.height);
    if (options?.subIfd) {
      writeEntry(2, 330, 8);
    }
    const nextOffset = pageIndex + 1 < pages.length ? 8 + (pageIndex + 1) * ifdSize : 0;
    buffer.writeUInt32LE(nextOffset, ifdOffset + 2 + entryCount * 12);
  });

  return buffer;
}

describe("Prism", () => {
  it("reads image metadata from headers without decoding", () => {
    const image = rgbaImage(16, 8);

    expect(readImageMetadataFromHeader(image)).toEqual({ width: 16, height: 8 });
  });

  it("resizes PNG input to JPEG through the elegant processor API", async () => {
    const prism = createPrism();
    const source = rgbaImage(16, 8);

    const jpeg = await prism.toJpeg(source, { maxSide: 4, quality: 82 });

    await expect(prism.metadata(jpeg)).resolves.toEqual({ width: 4, height: 2 });
  });

  it("copies caller-owned buffers before async processing", async () => {
    const prism = createPrism();
    const source = rgbaImage(16, 8);
    const replacement = rgbaImage(64, 64);

    const resize = prism.toJpeg(source, { maxSide: 4, quality: 82 });
    replacement.copy(source, 0, 0, Math.min(source.length, replacement.length));
    const jpeg = await resize;

    await expect(prism.metadata(jpeg)).resolves.toEqual({ width: 4, height: 2 });
  });

  it("resizes PNG input while preserving alpha", async () => {
    const prism = createPrism();
    const source = rgbaImage(10, 6, 120);

    const png = await prism.toPng(source, { maxSide: 5, compressionLevel: 9 });

    await expect(prism.metadata(png)).resolves.toEqual({ width: 5, height: 3 });
    await expect(prism.hasAlpha(png)).resolves.toBe(true);
  });

  it("optimizes PNG output under the requested byte cap when possible", async () => {
    const prism = createPrism();
    const source = rgbaImage(64, 64, 255);
    const { optimizePng } = prism;

    const result = await optimizePng(source, {
      maxBytes: 256,
      sides: [16, 8],
      compressionLevels: [9],
    });

    expect(result.optimizedSize).toBeLessThanOrEqual(256);
    expect(result.resizeSide).toBeGreaterThan(0);
  });

  it("rejects images over the configured pixel budget before decoding", async () => {
    const prism = createPrism({ maxInputPixels: 100 });
    const source = rgbaImage(20, 20);

    await expect(prism.toJpeg(source, { maxSide: 8 })).rejects.toThrow(
      "pixel input limit",
    );
  });

  it("rejects resize targets over the configured output pixel budget", async () => {
    const prism = createPrism({ maxOutputPixels: 100 });
    const source = rgbaImage(1, 1);

    await expect(
      prism.toJpeg(source, { maxSide: 100_000, withoutEnlargement: false }),
    ).rejects.toThrow("pixel output limit");
  });

  it("uses the largest linked TIFF page for metadata and pixel limits", async () => {
    const prism = createPrism({ maxInputPixels: 25_000_000 });
    const source = tiffImageFileDirectories([
      { width: 8, height: 8 },
      { width: 8000, height: 4000 },
    ]);

    expect(readImageMetadataFromHeader(source)).toEqual({ width: 8000, height: 4000 });
    await expect(prism.toJpeg(source, { maxSide: 8 })).rejects.toThrow("pixel input limit");
  });

  it("rejects TIFF SubIFD structures instead of guessing their pixel budget", () => {
    const source = tiffImageFileDirectories([{ width: 8, height: 8 }], { subIfd: true });

    expect(readImageMetadataFromHeader(source)).toBeNull();
  });

  it("reports unavailable forced backends with structured errors", async () => {
    const prism = createPrism({ backend: "ffmpeg" });
    const source = rgbaImage(4, 4);

    await expect(prism.toPng(source, { maxSide: 4 })).rejects.toBeInstanceOf(
      PrismUnavailableError,
    );
  });
});
