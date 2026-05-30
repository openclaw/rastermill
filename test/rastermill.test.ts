import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRastermill,
  encode as defaultEncode,
  encodePngRgba,
  isRastermillError,
  isRastermillUnavailableError,
  probe as defaultProbe,
  RastermillError,
  RastermillUnavailableError,
  readImageMetadataFromHeader,
  readImageProbeFromHeader,
  transparency as defaultTransparency,
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

function gradientRgbaImage(width: number, height: number): Buffer {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (x * 17 + y * 3) & 0xff;
      pixels[offset + 1] = (x * 5 + y * 11) & 0xff;
      pixels[offset + 2] = (x * 13 + y * 7) & 0xff;
      pixels[offset + 3] = 255;
    }
  }
  return encodePngRgba(pixels, width, height);
}

function losslessWebpHeader(width: number, height: number, hasAlpha: boolean): Buffer {
  const bits = (width - 1) | ((height - 1) << 14) | (hasAlpha ? 1 << 28 : 0);
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE(bits >>> 0, 1);
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8L", 12, "ascii");
  buffer.writeUInt32LE(payload.length, 16);
  payload.copy(buffer, 20);
  return buffer;
}

function extendedWebpHeader(width: number, height: number, hasAlpha: boolean): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer[20] = hasAlpha ? 0x10 : 0;
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function lossyWebpHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pngSignature(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function pngWithTextChunk(source: Buffer): Buffer {
  return Buffer.concat([
    source.subarray(0, -12),
    pngChunk("tEXt", Buffer.from("Comment\0metadata", "latin1")),
    source.subarray(-12),
  ]);
}

function pngHeaderWithColorType(width: number, height: number, colorType: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([pngSignature(), pngChunk("IHDR", ihdr), pngChunk("IEND", Buffer.alloc(0))]);
}

function truecolorPngHeader(width: number, height: number): Buffer {
  return pngHeaderWithColorType(width, height, 2);
}

function truncatedPngAncillaryChunk(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const badTextLength = Buffer.alloc(4);
  badTextLength.writeUInt32BE(10, 0);
  return Buffer.concat([
    pngSignature(),
    pngChunk("IHDR", ihdr),
    badTextLength,
    Buffer.from("tEXt!"),
  ]);
}

function indexedTransparentPngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  return Buffer.concat([
    pngSignature(),
    pngChunk("IHDR", ihdr),
    pngChunk("tRNS", Buffer.from([0])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegFrame(width: number, height: number): Buffer {
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff,
    0xd9,
  ]);
  return Buffer.concat([sof, sos]);
}

function jpegWithAppMetadata(width: number, height: number): Buffer {
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, 0x00, 0x08]),
    Buffer.from("Exif\0\0", "binary"),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, jpegFrame(width, height)]);
}

function jpegWithExifOrientation(width: number, height: number, orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const app1Payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.alloc(4);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(app1Payload.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, app1Payload, jpegFrame(width, height)]);
}

async function writeImageToolScript(
  script: string,
  log: string,
  outputs: { jpeg?: Buffer; png?: Buffer; webp?: Buffer },
): Promise<void> {
  await writeFile(
    script,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');`,
      "const output = args.at(-1);",
      `const jpeg = ${JSON.stringify(outputs.jpeg?.toString("base64") ?? "")};`,
      `const png = ${JSON.stringify(outputs.png?.toString("base64") ?? "")};`,
      `const webp = ${JSON.stringify(outputs.webp?.toString("base64") ?? "")};`,
      "const payload = output.endsWith('.webp') ? webp : output.endsWith('.png') ? png : jpeg;",
      "fs.writeFileSync(output, Buffer.from(payload, 'base64'));",
    ].join("\n"),
    "utf8",
  );
  await chmod(script, 0o755);
}

function isoBox(type: string, payload: Buffer): Buffer {
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, "ascii");
  payload.copy(box, 8);
  return box;
}

function heifLikeImage(...sizes: Array<{ width: number; height: number }>): Buffer {
  const ftypPayload = Buffer.alloc(8);
  ftypPayload.write("heic", 0, "ascii");
  const ispeBoxes = sizes.map(({ width, height }) => {
    const ispePayload = Buffer.alloc(12);
    ispePayload.writeUInt32BE(width, 4);
    ispePayload.writeUInt32BE(height, 8);
    return isoBox("ispe", ispePayload);
  });
  const ipco = isoBox("ipco", Buffer.concat(ispeBoxes));
  const iprp = isoBox("iprp", ipco);
  const meta = isoBox("meta", Buffer.concat([Buffer.alloc(4), iprp]));
  return Buffer.concat([isoBox("ftyp", ftypPayload), meta]);
}

function bmpHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(26);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  return buffer;
}

function bmpHeaderWithDibSize(size: number): Buffer {
  const buffer = Buffer.alloc(26);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(size, 14);
  return buffer;
}

function bmpCoreHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(26);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(12, 14);
  buffer.writeUInt16LE(width, 18);
  buffer.writeUInt16LE(height, 20);
  return buffer;
}

function grayscaleAlphaPng(width: number, height: number, alpha = 128): Buffer {
  const raw = Buffer.alloc((width * 2 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 2 + 1)] = 0;
    for (let col = 0; col < width; col += 1) {
      const offset = row * (width * 2 + 1) + 1 + col * 2;
      raw[offset] = 0x80;
      raw[offset + 1] = alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 4;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
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

describe("Rastermill", () => {
  afterEach(() => {
    vi.doUnmock("@silvia-odwyer/photon-node");
    vi.resetModules();
  });

  it("reads image metadata and a full probe from headers without decoding", () => {
    const image = rgbaImage(16, 8);

    expect(readImageMetadataFromHeader(image)).toEqual({ width: 16, height: 8 });
    expect(readImageProbeFromHeader(image)).toEqual({
      format: "png",
      width: 16,
      height: 8,
      hasAlpha: true,
      orientation: null,
      bytes: image.length,
    });
  });

  it("reads lossless WebP alpha flags from headers", () => {
    expect(readImageProbeFromHeader(losslessWebpHeader(3, 2, true))).toMatchObject({
      format: "webp",
      width: 3,
      height: 2,
      hasAlpha: true,
    });
    expect(readImageProbeFromHeader(losslessWebpHeader(3, 2, false))).toMatchObject({
      hasAlpha: false,
    });
  });

  it("reads extra header variants without pixel decoding", () => {
    const avif = Buffer.from(heifLikeImage({ width: 11, height: 7 }));
    avif.write("avif", 8, "ascii");

    expect(readImageProbeFromHeader(extendedWebpHeader(9, 5, true))).toMatchObject({
      format: "webp",
      width: 9,
      height: 5,
      hasAlpha: true,
    });
    expect(readImageProbeFromHeader(lossyWebpHeader(13, 3))).toMatchObject({
      format: "webp",
      width: 13,
      height: 3,
      hasAlpha: null,
    });
    expect(readImageProbeFromHeader(indexedTransparentPngHeader(2, 2))).toMatchObject({
      format: "png",
      hasAlpha: true,
    });
    expect(readImageProbeFromHeader(truecolorPngHeader(2, 2))).toMatchObject({
      format: "png",
      hasAlpha: false,
    });
    expect(readImageProbeFromHeader(bmpCoreHeader(12, 6))).toMatchObject({
      format: "bmp",
      width: 12,
      height: 6,
    });
    expect(readImageProbeFromHeader(avif)).toMatchObject({
      format: "avif",
      width: 11,
      height: 7,
    });
  });

  it("returns conservative probes for malformed but recognizable headers", () => {
    const badLosslessWebp = Buffer.from(losslessWebpHeader(3, 2, false));
    badLosslessWebp[20] = 0x00;
    const nonImageFtyp = Buffer.from(isoBox("ftyp", Buffer.from("mp42\0\0\0\0", "binary")));
    const truncatedExtendedFtyp = Buffer.alloc(12);
    truncatedExtendedFtyp.writeUInt32BE(1, 0);
    truncatedExtendedFtyp.write("ftyp", 4, "ascii");

    expect(readImageProbeFromHeader(pngHeaderWithColorType(2, 2, 1))).toMatchObject({
      format: "png",
      hasAlpha: null,
    });
    expect(readImageProbeFromHeader(truncatedPngAncillaryChunk(2, 2))).toMatchObject({
      format: "png",
      hasAlpha: null,
    });
    expect(readImageProbeFromHeader(badLosslessWebp)).toBeNull();
    expect(readImageProbeFromHeader(bmpHeaderWithDibSize(16))).toBeNull();
    expect(readImageProbeFromHeader(Buffer.from("MM\0\0\0\0\0\0", "binary"))).toBeNull();
    expect(readImageProbeFromHeader(nonImageFtyp)).toBeNull();
    expect(readImageProbeFromHeader(truncatedExtendedFtyp)).toBeNull();
  });

  it("reads JPEG EXIF orientation hints without decoding", () => {
    expect(readImageProbeFromHeader(jpegWithExifOrientation(6, 4, 6))).toMatchObject({
      format: "jpeg",
      width: 6,
      height: 4,
      orientation: 6,
      hasAlpha: false,
    });
    expect(readImageProbeFromHeader(jpegWithExifOrientation(6, 4, 9))).toMatchObject({
      orientation: null,
    });
  });

  it("supports default-instance helpers and ArrayBuffer inputs", async () => {
    const source = rgbaImage(4, 2);
    const arrayBuffer = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer;

    expect(readImageMetadataFromHeader(arrayBuffer)).toEqual({ width: 4, height: 2 });
    await expect(defaultProbe(arrayBuffer)).resolves.toMatchObject({ width: 4, height: 2 });
    await expect(defaultTransparency(arrayBuffer)).resolves.toEqual({
      hasAlphaChannel: true,
      hasTransparentPixels: false,
    });
    await expect(
      defaultEncode(arrayBuffer, { format: "png", metadata: "preserve" }),
    ).resolves.toMatchObject({
      format: "png",
      width: 4,
      height: 2,
      metadata: "preserved",
    });
    await expect(defaultEncode(source)).resolves.toMatchObject({
      format: "jpeg",
      chosen: { transparency: "flattened" },
    });
  });

  it("handles undecodable probes and opaque transparency probes", async () => {
    const rastermill = createRastermill();

    expect(readImageProbeFromHeader(Buffer.from("nope"))).toBeNull();
    await expect(rastermill.probe(Buffer.from("nope"))).resolves.toBeNull();
    await expect(rastermill.transparency(truecolorPngHeader(2, 2))).resolves.toEqual({
      hasAlphaChannel: false,
      hasTransparentPixels: false,
    });
    await expect(rastermill.transparency(Buffer.from("nope"))).rejects.toMatchObject({
      code: "RASTERMILL_UNDECODABLE",
    });
  });

  it("reads BMP and HEIF dimensions from headers without decoding", () => {
    expect(readImageProbeFromHeader(bmpHeader(640, 480))).toMatchObject({
      format: "bmp",
      width: 640,
      height: 480,
    });
    expect(readImageProbeFromHeader(heifLikeImage({ width: 640, height: 480 }))).toMatchObject({
      format: "heif",
      width: 640,
      height: 480,
    });
  });

  it("probes within the pixel budget and returns null when over budget", async () => {
    const rastermill = createRastermill({ limits: { inputPixels: 100 } });

    await expect(rastermill.probe(rgbaImage(8, 8))).resolves.toMatchObject({
      format: "png",
      width: 8,
      height: 8,
      hasAlpha: true,
    });
    await expect(rastermill.probe(rgbaImage(20, 20))).resolves.toBeNull();
  });

  it("encodes PNG input to JPEG and reports the output dimensions", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 8);

    const jpeg = await rastermill.encode(source, {
      format: "jpeg",
      resize: { maxSide: 4 },
      quality: 82,
    });

    expect(jpeg).toMatchObject({
      format: "jpeg",
      width: 4,
      height: 2,
      bytes: jpeg.data.length,
      base64Bytes: Buffer.byteLength(jpeg.data.toString("base64"), "utf8"),
    });
    expect(readImageMetadataFromHeader(jpeg.data)).toEqual({ width: 4, height: 2 });
  });

  it("copies caller-owned buffers before async processing", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 8);
    const replacement = rgbaImage(64, 64);

    const pending = rastermill.encode(source, {
      format: "jpeg",
      resize: { maxSide: 4 },
      quality: 82,
    });
    replacement.copy(source, 0, 0, Math.min(source.length, replacement.length));
    const jpeg = await pending;

    expect(jpeg).toMatchObject({ width: 4, height: 2 });
  });

  it("resizes PNG input while preserving alpha", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(10, 6, 120);

    const png = await rastermill.encode(source, {
      format: "png",
      resize: { maxSide: 5 },
      compressionLevel: 9,
    });

    expect(png).toMatchObject({ format: "png", width: 5, height: 3 });
    await expect(rastermill.probe(png.data)).resolves.toMatchObject({ hasAlpha: true });
  });

  it("reports alpha channels separately from transparent pixels", async () => {
    const rastermill = createRastermill();

    await expect(rastermill.transparency(rgbaImage(1, 1, 255))).resolves.toEqual({
      hasAlphaChannel: true,
      hasTransparentPixels: false,
    });
    await expect(rastermill.transparency(rgbaImage(1, 1, 64))).resolves.toEqual({
      hasAlphaChannel: true,
      hasTransparentPixels: true,
    });
  });

  it("detects grayscale alpha PNG channels through Photon fallback", async () => {
    const rastermill = createRastermill();

    await expect(rastermill.transparency(grayscaleAlphaPng(2, 2))).resolves.toEqual({
      hasAlphaChannel: true,
      hasTransparentPixels: true,
    });
  });

  it("detects transparent GIF pixels through Photon", async () => {
    const rastermill = createRastermill();
    const transparentGif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );

    await expect(rastermill.transparency(transparentGif)).resolves.toEqual({
      hasAlphaChannel: true,
      hasTransparentPixels: true,
    });
  });

  it("does not cross into internal processing for external transparency checks", async () => {
    const rastermill = createRastermill({ execution: "external" });

    await expect(rastermill.transparency(rgbaImage(1, 1, 64))).rejects.toMatchObject({
      code: "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE",
      operation: "transparency",
    });
  });

  it("wraps Photon availability failures for transparency checks", async () => {
    vi.resetModules();
    vi.doMock("@silvia-odwyer/photon-node", () => {
      throw new Error("Photon did not expose the required image processor API");
    });
    const { createRastermill: createFreshRastermill, encodePngRgba: encodeFreshPngRgba } =
      await import("../src/index.js");

    await expect(
      createFreshRastermill().transparency(encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4)),
    ).rejects.toMatchObject({
      code: "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE",
      operation: "transparency",
    });
  });

  it("encodes under a byte budget by searching dimensions and compression", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 255);

    const result = await rastermill.encode(source, {
      format: "png",
      maxBytes: 256,
      search: { maxSide: [16, 8], compressionLevel: [9] },
    });

    expect(result.bytes).toBeLessThanOrEqual(256);
    expect(result.chosen.maxSide).toBeGreaterThan(0);
  });

  it("searches quality when encoding JPEG within a byte budget", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 255);

    const result = await rastermill.encode(source, {
      format: "jpeg",
      maxBytes: 700,
      search: { maxSide: [32, 16], quality: [80, 50] },
    });

    expect(result.bytes).toBeLessThanOrEqual(700);
    expect(result.withinBudget).toBe(true);
    expect(result.chosen.maxSide).toBeGreaterThan(0);
    expect(result.chosen.quality).toBeGreaterThan(0);
  });

  it("searches output settings against a base64 byte budget", async () => {
    const rastermill = createRastermill();
    const source = gradientRgbaImage(96, 96);

    const result = await rastermill.encode(source, {
      format: "jpeg",
      maxBase64Bytes: 2_000,
      search: { maxSide: [64, 32, 16], quality: [80, 50] },
    });

    expect(result.withinBudget).toBe(true);
    expect(result.base64Bytes).toBeLessThanOrEqual(2_000);
    expect(result.base64Bytes).toBe(Buffer.byteLength(result.data.toString("base64"), "utf8"));
    expect(result.chosen.maxSide).toBeGreaterThan(0);
  });

  it("reports when byte-budget search returns the smallest oversized candidate", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 255);

    const result = await rastermill.encode(source, {
      format: "png",
      maxBytes: 1,
      search: { maxSide: [16, 8], compressionLevel: [9] },
    });

    expect(result.bytes).toBeGreaterThan(1);
    expect(result.withinBudget).toBe(false);
    expect(result.chosen.maxSide).toBe(8);
  });

  it("chooses transparent output first and flattens when needed for a byte budget", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 120);

    const result = await rastermill.encode(source, {
      format: "auto",
      maxBytes: 1,
      search: {
        maxSide: [32, 16],
        quality: [80, 50],
        compressionLevel: [9],
      },
    });

    expect(result.format).toBe("jpeg");
    expect(result.chosen.transparency).toBe("flattened");
    expect(result.chosen.quality).toBeGreaterThan(0);
  });

  it("labels explicit flattening of transparent input", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 16, 120);

    const result = await rastermill.encode(source, {
      format: "auto",
      transparency: "flatten",
      opaque: { format: "jpeg", quality: 80 },
    });

    expect(result.format).toBe("jpeg");
    expect(result.chosen.transparency).toBe("flattened");
  });

  it("preserves transparent output when flattening is disabled", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 120);

    const result = await rastermill.encode(source, {
      format: "auto",
      maxBytes: 1,
      search: { maxSide: [16], compressionLevel: [9] },
      transparency: "preserve",
    });

    expect(result.format).toBe("png");
    expect(result.withinBudget).toBe(false);
    expect(result.chosen.transparency).toBe("preserved");
  });

  it("strips metadata by default by re-encoding matching input bytes", async () => {
    vi.resetModules();
    let photonImported = false;
    vi.doMock("@silvia-odwyer/photon-node", () => {
      photonImported = true;
      class MockPhotonImage {
        static new_from_byteslice = vi.fn<() => MockPhotonImage>(() => new MockPhotonImage());
        free(): void {}
        get_height(): number {
          return 4;
        }
        get_raw_pixels(): Uint8Array {
          return new Uint8Array(4 * 4 * 4);
        }
        get_width(): number {
          return 4;
        }
      }
      return {
        PhotonImage: MockPhotonImage,
        SamplingFilter: {
          Lanczos3: 1,
        },
        crop: vi.fn<(image: MockPhotonImage) => MockPhotonImage>((image) => image),
        resize: vi.fn<(image: MockPhotonImage) => MockPhotonImage>((image) => image),
      };
    });
    const { createRastermill: createFreshRastermill, encodePngRgba: encodeFreshPngRgba } =
      await import("../src/index.js");
    const source = pngWithTextChunk(encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4));

    const result = await createFreshRastermill().encode(source, { format: "png" });

    expect(result).toMatchObject({ format: "png", width: 4, height: 4, metadata: "stripped" });
    expect(result.data.equals(source)).toBe(false);
    expect(photonImported).toBe(true);
  });

  it("reuses matching input bytes only when metadata preservation is requested", async () => {
    vi.resetModules();
    vi.doMock("@silvia-odwyer/photon-node", () => {
      throw new Error("Photon should not be imported for no-op encodes");
    });
    const { createRastermill: createFreshRastermill, encodePngRgba: encodeFreshPngRgba } =
      await import("../src/index.js");
    const source = encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4);

    const result = await createFreshRastermill().encode(source, {
      format: "png",
      metadata: "preserve",
    });

    expect(result).toMatchObject({
      format: "png",
      width: 4,
      height: 4,
      bytes: source.length,
      metadata: "preserved",
    });
    expect(result.data.equals(source)).toBe(true);
  });

  it("flattens opaque RGBA images in auto encode prefer mode", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(32, 32, 255);

    const result = await rastermill.encode(source, {
      format: "auto",
      opaque: { format: "jpeg", quality: 80 },
      transparent: { format: "png", compressionLevel: 9 },
    });

    expect(result.format).toBe("jpeg");
    expect(result.chosen.transparency).toBe("flattened");
  });

  it("auto transparency inspects known alpha-capable formats", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 16, 120);

    const result = await rastermill.encode(source, {
      format: "auto",
      transparency: "auto",
      opaque: { format: "jpeg", quality: 80 },
      transparent: { format: "png", compressionLevel: 9 },
    });

    expect(result).toMatchObject({
      format: "png",
      mimeType: "image/png",
      chosen: { transparency: "preserved" },
    });
  });

  it("encodes to dimension limits and reports MIME type", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(16, 8), {
      format: "auto",
      limits: { maxWidth: 4, maxHeight: 4, maxPixels: 16 },
      opaque: { format: "jpeg", quality: 80 },
      transparency: "flatten",
    });

    expect(result).toMatchObject({
      format: "jpeg",
      mimeType: "image/jpeg",
      width: 4,
      height: 2,
      resized: true,
      chosen: { transparency: "flattened" },
    });
  });

  it("lets byte-budget search shrink below dimension limits", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(gradientRgbaImage(128, 128), {
      format: "auto",
      limits: { maxWidth: 64, maxHeight: 64 },
      opaque: { format: "jpeg", quality: 90 },
      transparency: "flatten",
      maxBytes: 800,
      search: { maxSide: [64, 32, 16], quality: [90, 60] },
    });

    expect(result.withinBudget).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(800);
    expect(result.chosen.maxSide).toBeLessThan(64);
    expect(result.width).toBeLessThanOrEqual(32);
    expect(result.resized).toBe(true);
  });

  it("derives byte-budget search sides from small dimension limits", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(gradientRgbaImage(200, 100), {
      format: "auto",
      limits: { maxWidth: 160 },
      opaque: { format: "jpeg" },
      transparency: "flatten",
      maxBytes: 800,
    });

    expect(result.withinBudget).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(800);
    expect(result.width).toBeLessThan(160);
    expect(result.chosen.maxSide).toBeLessThan(160);
  });

  it("does not treat a width-only resize as the byte-search max side", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(20, 200), {
      format: "jpeg",
      resize: { width: 10 },
      maxBytes: 10_000,
    });

    expect(result.width).toBe(10);
    expect(result.height).toBe(100);
    expect(result.chosen.maxSide).toBe(100);
  });

  it("keeps the resolved resize target as the first budget candidate", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(20, 200), {
      format: "jpeg",
      resize: { width: 1000, height: 100 },
      maxBytes: 10_000,
    });

    expect(result.width).toBe(10);
    expect(result.height).toBe(100);
    expect(result.chosen.maxSide).toBe(100);
  });

  it("preserves explicit upscaling while searching byte-budget candidates", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(10, 10), {
      format: "jpeg",
      resize: { width: 100, height: 100, enlarge: true },
      maxBytes: 700,
      search: { maxSide: [100, 50], quality: [85] },
    });

    expect(result.withinBudget).toBe(true);
    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
  });

  it("tries derived byte-budget search sides from largest to smallest", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(gradientRgbaImage(1500, 100), {
      format: "jpeg",
      resize: { maxSide: 1200 },
      maxBytes: 65_000,
      search: { quality: [85] },
    });

    expect(result.withinBudget).toBe(true);
    expect(result.chosen.maxSide).toBe(900);
  });

  it("keeps maxPixels limits after dimension-limited resizing", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(100, 99), {
      format: "auto",
      limits: { maxPixels: 2475 },
      opaque: { format: "jpeg", quality: 80 },
      transparency: "flatten",
    });

    expect(result.width * result.height).toBeLessThanOrEqual(2475);
    expect(result.resized).toBe(true);
  });

  it("keeps explicit resize smaller than dimension limits", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(200, 100), {
      format: "jpeg",
      resize: { width: 20, height: 20, fit: "cover" },
      limits: { maxWidth: 150 },
    });

    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
    expect(result.resized).toBe(true);
  });

  it("honors flatten policy when no dimension resize is needed", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(8, 8, 120), {
      format: "auto",
      limits: { maxWidth: 16, maxHeight: 16 },
      transparency: "flatten",
    });

    expect(result.format).toBe("jpeg");
    expect(result.chosen.transparency).toBe("flattened");
  });

  it("reports resized false for no-op explicit resize with limits", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(10, 10), {
      format: "auto",
      resize: { maxSide: 100 },
      limits: { maxWidth: 100, maxHeight: 100 },
    });

    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.resized).toBe(false);
  });

  it("keeps explicit upscaling when limits clamp the target", async () => {
    const rastermill = createRastermill();

    const result = await rastermill.encode(rgbaImage(10, 10), {
      format: "jpeg",
      resize: { width: 100, height: 100, enlarge: true },
      limits: { maxWidth: 50, maxHeight: 50 },
    });

    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
    expect(result.resized).toBe(true);
  });

  it("preserves original bytes in auto encode limits when no resize is needed", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(4, 4, 255);

    const result = await rastermill.encode(source, {
      format: "auto",
      limits: { maxWidth: 8, maxHeight: 8 },
    });

    expect(result).toMatchObject({
      format: "png",
      mimeType: "image/png",
      width: 4,
      height: 4,
      resized: false,
      metadata: "preserved",
    });
    expect(result.data.equals(source)).toBe(true);
  });

  it("does not require Photon transparency inspection before auto encoding external-only formats", async () => {
    const rastermill = createRastermill({
      commandResolver: () => null,
    });

    await expect(
      rastermill.encode(tiffImageFileDirectories([{ width: 4, height: 4 }])),
    ).rejects.toMatchObject({
      code: "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE",
      operation: "encode",
    });
  });

  it("uses external quality-capable backends for WebP quality", async () => {
    vi.resetModules();
    let photonImported = false;
    vi.doMock("@silvia-odwyer/photon-node", () => {
      photonImported = true;
      throw new Error("Photon should not be imported for quality-controlled WebP");
    });
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-webp-quality-"));
    try {
      const log = path.join(tmp, "args.json");
      const script = path.join(tmp, "magick.js");
      await writeFile(
        script,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));`,
          `fs.writeFileSync(process.argv.at(-1), Buffer.from(${JSON.stringify(losslessWebpHeader(4, 4, false).toString("base64"))}, 'base64'));`,
        ].join("\n"),
        "utf8",
      );
      await chmod(script, 0o755);
      const { createRastermill: createFreshRastermill, encodePngRgba: encodeFreshPngRgba } =
        await import("../src/index.js");
      const rastermill = createFreshRastermill({
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      const result = await rastermill.encode(encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4), {
        format: "webp",
        quality: 72,
      });

      expect(result).toMatchObject({ format: "webp", width: 4, height: 4 });
      expect(photonImported).toBe(false);
      const args = JSON.parse(await readFile(log, "utf8")) as string[];
      expect(args).toContain("-quality");
      expect(args).toContain("72");
      expect(args).toContain("-strip");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("routes resized JPEG and WebP work through ffmpeg when earlier native tools are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-ffmpeg-"));
    try {
      const log = path.join(tmp, "args.jsonl");
      const script = path.join(tmp, "ffmpeg.js");
      await writeImageToolScript(script, log, {
        jpeg: jpegWithAppMetadata(4, 2),
        webp: losslessWebpHeader(4, 2, false),
      });
      const rastermill = createRastermill({
        execution: "external",
        commandResolver: (command) => (command === "ffmpeg" ? script : null),
      });

      const jpeg = await rastermill.encode(rgbaImage(8, 4), {
        format: "jpeg",
        resize: { maxSide: 4 },
        quality: 70,
      });
      const webp = await rastermill.encode(rgbaImage(8, 4), {
        format: "webp",
        resize: { maxSide: 4 },
        quality: 60,
      });

      expect(jpeg).toMatchObject({ format: "jpeg", width: 4, height: 2 });
      expect(webp).toMatchObject({ format: "webp", width: 4, height: 2 });
      const invocations = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(invocations[0]).toContain("-q:v");
      expect(invocations[0]).toContain("-map_metadata");
      expect(invocations[1]).toContain("-quality");
      expect(invocations[1]).toContain("60");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("converts external-only formats to JPEG without a resize request", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-convert-jpeg-"));
    try {
      const log = path.join(tmp, "args.jsonl");
      const script = path.join(tmp, "magick.js");
      await writeImageToolScript(script, log, {
        jpeg: jpegWithAppMetadata(9, 7),
      });
      const rastermill = createRastermill({
        execution: "external",
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      const result = await rastermill.encode(heifLikeImage({ width: 9, height: 7 }), {
        format: "jpeg",
        quality: 91,
      });

      expect(result).toMatchObject({ format: "jpeg", width: 9, height: 7 });
      const args = JSON.parse((await readFile(log, "utf8")).trim()) as string[];
      expect(args).toContain("-auto-orient");
      expect(args).toContain("-quality");
      expect(args).toContain("91");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "falls back to legacy ImageMagick convert when magick is unavailable",
    async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-legacy-convert-"));
      try {
        const log = path.join(tmp, "args.jsonl");
        const script = path.join(tmp, "convert.js");
        await writeImageToolScript(script, log, {
          jpeg: jpegWithAppMetadata(7, 5),
        });
        const rastermill = createRastermill({
          execution: "external",
          commandResolver: (command) => (command === "convert" ? script : null),
        });

        const result = await rastermill.encode(heifLikeImage({ width: 7, height: 5 }), {
          format: "jpeg",
          quality: 77,
        });

        expect(result).toMatchObject({ format: "jpeg", width: 7, height: 5 });
        const args = JSON.parse((await readFile(log, "utf8")).trim()) as string[];
        expect(args[0]).toContain("in.img[0]");
        expect(args).toContain("-quality");
        expect(args).toContain("77");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  );

  it("surfaces undecodable bytes emitted by external encoders", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-bad-output-"));
    try {
      const script = path.join(tmp, "magick.js");
      await writeImageToolScript(script, path.join(tmp, "args.jsonl"), {
        jpeg: Buffer.from("not-a-jpeg"),
      });
      const rastermill = createRastermill({
        execution: "external",
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      await expect(
        rastermill.encode(heifLikeImage({ width: 4, height: 4 }), { format: "jpeg" }),
      ).rejects.toMatchObject({
        code: "RASTERMILL_UNDECODABLE",
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("passes PNG compression to ImageMagick external encoding", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-png-magick-"));
    try {
      const log = path.join(tmp, "args.jsonl");
      const script = path.join(tmp, "magick.js");
      await writeImageToolScript(script, log, {
        png: rgbaImage(3, 3),
      });
      const rastermill = createRastermill({
        execution: "external",
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      const result = await rastermill.encode(rgbaImage(6, 6), {
        format: "png",
        resize: { maxSide: 3 },
        compressionLevel: 2,
        autoOrient: false,
      });

      expect(result).toMatchObject({ format: "png", width: 3, height: 3 });
      const args = JSON.parse((await readFile(log, "utf8")).trim()) as string[];
      expect(args).toContain("png:compression-level=2");
      expect(args).not.toContain("-auto-orient");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "darwin")(
    "uses sips geometry for external JPEG cover resize",
    async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-sips-"));
      try {
        const log = path.join(tmp, "args.jsonl");
        const script = path.join(tmp, "sips.js");
        await writeImageToolScript(script, log, {
          jpeg: jpegWithAppMetadata(5, 5),
        });
        const rastermill = createRastermill({
          execution: "external",
          commandResolver: (command) => (command === "sips" ? script : null),
        });

        const result = await rastermill.encode(rgbaImage(10, 6), {
          format: "jpeg",
          resize: { fit: "cover", width: 5, height: 5 },
        });

        expect(result).toMatchObject({ format: "jpeg", width: 5, height: 5 });
        const args = JSON.parse((await readFile(log, "utf8")).trim()) as string[];
        expect(args).toContain("--cropToHeightWidth");
        expect(args).toContain("--out");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "darwin")(
    "applies EXIF orientation before sips encoding",
    async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-sips-orient-"));
      try {
        const log = path.join(tmp, "args.jsonl");
        const script = path.join(tmp, "sips.js");
        await writeImageToolScript(script, log, {
          jpeg: jpegWithAppMetadata(2, 4),
        });
        const rastermill = createRastermill({
          execution: "external",
          commandResolver: (command) => (command === "sips" ? script : null),
        });

        const result = await rastermill.encode(jpegWithExifOrientation(4, 2, 6), {
          format: "jpeg",
        });

        expect(result).toMatchObject({ format: "jpeg", width: 2, height: 4 });
        const invocations = (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[]);
        expect(invocations[0]).toEqual(expect.arrayContaining(["-r", "90", "--out"]));
        expect(invocations[1]).toEqual(expect.arrayContaining(["-s", "format", "jpeg"]));
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  );

  it("uses GraphicsMagick argument shape for external PNG encoding", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-png-gm-"));
    try {
      const log = path.join(tmp, "args.jsonl");
      const script = path.join(tmp, "gm.js");
      await writeImageToolScript(script, log, {
        png: rgbaImage(2, 2),
      });
      const rastermill = createRastermill({
        execution: "external",
        commandResolver: (command) => (command === "gm" ? script : null),
      });

      const result = await rastermill.encode(rgbaImage(4, 4), {
        format: "png",
        resize: { maxSide: 2 },
      });

      expect(result).toMatchObject({ format: "png", width: 2, height: 2 });
      const args = JSON.parse((await readFile(log, "utf8")).trim()) as string[];
      expect(args[0]).toBe("convert");
      expect(args).toContain("-strip");
      expect(args).not.toContain("-define");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("searches quality when encoding WebP within a byte budget", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-webp-budget-"));
    try {
      const script = path.join(tmp, "magick.js");
      await writeFile(
        script,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          "const quality = Number(args[args.indexOf('-quality') + 1]);",
          `const header = Buffer.from(${JSON.stringify(losslessWebpHeader(4, 4, false).toString("base64"))}, 'base64');`,
          "const padding = Buffer.alloc(quality > 60 ? 500 : 20);",
          "fs.writeFileSync(process.argv.at(-1), Buffer.concat([header, padding]));",
        ].join("\n"),
        "utf8",
      );
      await chmod(script, 0o755);
      const rastermill = createRastermill({
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      const result = await rastermill.encode(rgbaImage(4, 4), {
        format: "webp",
        maxBytes: 200,
        search: { maxSide: [4], quality: [85, 50] },
      });

      expect(result.withinBudget).toBe(true);
      expect(result.chosen.quality).toBe(50);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rethrows the first byte-budget encode error when no candidate succeeds", async () => {
    const rastermill = createRastermill({
      execution: "external",
      commandResolver: () => null,
    });

    await expect(
      rastermill.encode(rgbaImage(4, 4), {
        format: "png",
        maxBytes: 100,
        search: { maxSide: [4], compressionLevel: [9] },
      }),
    ).rejects.toBeInstanceOf(RastermillUnavailableError);
  });

  it("strips JPEG metadata emitted by native backends", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-jpeg-strip-"));
    try {
      const script = path.join(tmp, "magick.js");
      await writeFile(
        script,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(process.argv.at(-1), Buffer.from(${JSON.stringify(jpegWithAppMetadata(4, 4).toString("base64"))}, 'base64'));`,
        ].join("\n"),
        "utf8",
      );
      await chmod(script, 0o755);
      const rastermill = createRastermill({
        execution: "external",
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      const result = await rastermill.encode(rgbaImage(4, 4), { format: "jpeg" });

      expect(result).toMatchObject({ format: "jpeg", width: 4, height: 4, metadata: "stripped" });
      expect(result.data.includes(Buffer.from("Exif\0\0", "binary"))).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects images over the configured pixel budget before decoding", async () => {
    const rastermill = createRastermill({ limits: { inputPixels: 100 } });
    const source = rgbaImage(20, 20);

    await expect(
      rastermill.encode(source, { format: "jpeg", resize: { maxSide: 8 } }),
    ).rejects.toMatchObject({
      code: "RASTERMILL_INPUT_TOO_LARGE",
    });
  });

  it("rejects oversized ISO BMFF inputs before native tools run", async () => {
    const requested: string[] = [];
    const rastermill = createRastermill({
      limits: { inputPixels: 100 },
      commandResolver: (command) => {
        requested.push(command);
        return command;
      },
    });
    const source = heifLikeImage({ width: 8, height: 8 }, { width: 20, height: 20 });

    await expect(rastermill.probe(source)).resolves.toBeNull();
    await expect(
      rastermill.encode(source, { format: "jpeg", resize: { maxSide: 8 } }),
    ).rejects.toMatchObject({
      code: "RASTERMILL_INPUT_TOO_LARGE",
    });
    expect(requested).toEqual([]);
  });

  it("rejects unknown input before native tools run", async () => {
    const requested: string[] = [];
    const rastermill = createRastermill({
      commandResolver: (command) => {
        requested.push(command);
        return command;
      },
    });

    await expect(
      rastermill.encode(Buffer.from("not-an-image"), { format: "jpeg" }),
    ).rejects.toMatchObject({
      code: "RASTERMILL_UNDECODABLE",
    });
    expect(requested).toEqual([]);
  });

  it("rejects resize targets over the configured output pixel budget", async () => {
    const rastermill = createRastermill({ limits: { outputPixels: 100 } });
    const source = rgbaImage(1, 1);

    await expect(
      rastermill.encode(source, { format: "jpeg", resize: { maxSide: 100_000, enlarge: true } }),
    ).rejects.toMatchObject({ code: "RASTERMILL_OUTPUT_TOO_LARGE" });
  });

  it("uses typed errors for invalid options", async () => {
    const rastermill = createRastermill();

    expect(isRastermillError(new RastermillError("RASTERMILL_BAD_OPTION", "bad"))).toBe(true);
    expect(isRastermillUnavailableError(new Error("plain"))).toBe(false);
    expect(() => createRastermill({ temp: { rootDir: "  " } })).toThrow(/rootDir/);
    expect(() => createRastermill({ temp: { prefix: "" } })).toThrow(/prefix/);
    expect(() => createRastermill({ temp: { prefix: "nested/path" } })).toThrow(/prefix/);
    await expect(
      rastermill.encode(rgbaImage(8, 8), { format: "png", resize: { maxSide: 0 } }),
    ).rejects.toBeInstanceOf(RastermillError);
    await expect(
      rastermill.encode(rgbaImage(8, 8), { format: "png", resize: { maxSide: 0 } }),
    ).rejects.toMatchObject({ code: "RASTERMILL_BAD_OPTION" });
    await expect(
      rastermill.encode(rgbaImage(8, 8), {
        format: "jpeg",
        maxBytes: 100,
        search: { maxSide: [0] },
      }),
    ).rejects.toMatchObject({ code: "RASTERMILL_BAD_OPTION" });
    expect(() => createRastermill({ execution: "sideways" as never })).toThrow(/execution/);
  });

  it("passes exact fill dimensions through to native backends", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-native-test-"));
    try {
      const tempRoot = await mkdtemp(path.join(tmp, "secure-root-"));
      const log = path.join(tmp, "args.json");
      const script = path.join(tmp, "magick.js");
      const outputPng = rgbaImage(4, 4).toString("base64");
      await writeFile(
        script,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));`,
          `fs.writeFileSync(process.argv.at(-1), Buffer.from(${JSON.stringify(outputPng)}, 'base64'));`,
        ].join("\n"),
        "utf8",
      );
      await chmod(script, 0o755);
      const rastermill = createRastermill({
        execution: "external",
        temp: { rootDir: tempRoot, prefix: "custom-img-" },
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      const result = await rastermill.encode(rgbaImage(8, 4), {
        format: "jpeg",
        resize: { fit: "fill", width: 4, height: 4 },
      });

      expect(result).toMatchObject({ width: 4, height: 4 });
      const args = JSON.parse(await readFile(log, "utf8")) as string[];
      expect(args).toContain("4x4!");
      const inputArg = args.find((arg) => arg.endsWith("in.img[0]"));
      expect(inputArg).toBeDefined();
      const inputPath = inputArg?.slice(0, -"[0]".length) ?? "";
      expect(path.relative(tempRoot, inputPath).startsWith("custom-img-")).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("center-crops cover resize requests", async () => {
    const rastermill = createRastermill();

    const jpeg = await rastermill.encode(rgbaImage(8, 4), {
      format: "jpeg",
      resize: { fit: "cover", width: 4, height: 4 },
    });

    expect(jpeg).toMatchObject({ format: "jpeg", width: 4, height: 4 });
  });

  it("encodes WebP output", async () => {
    const rastermill = createRastermill();

    const webp = await rastermill.encode(rgbaImage(12, 6), {
      format: "webp",
      resize: { maxSide: 6 },
    });

    expect(webp).toMatchObject({ format: "webp", width: 6, height: 3 });
    expect(readImageProbeFromHeader(webp.data)).toMatchObject({ format: "webp" });
  });

  it.runIf(process.platform === "darwin" && existsSync("/usr/bin/sips"))(
    "encodes through native tools when execution is external",
    async () => {
      const rastermill = createRastermill({ execution: "external" });

      const jpeg = await rastermill.encode(rgbaImage(16, 8), {
        format: "jpeg",
        resize: { maxSide: 4 },
      });

      expect(jpeg).toMatchObject({ format: "jpeg", width: 4, height: 2 });
    },
  );

  it("uses the largest linked TIFF page for metadata and pixel limits", async () => {
    const rastermill = createRastermill({ limits: { inputPixels: 25_000_000 } });
    const source = tiffImageFileDirectories([
      { width: 8, height: 8 },
      { width: 8000, height: 4000 },
    ]);

    expect(readImageMetadataFromHeader(source)).toEqual({ width: 8000, height: 4000 });
    await expect(
      rastermill.encode(source, { format: "jpeg", resize: { maxSide: 8 } }),
    ).rejects.toThrow("pixel input limit");
  });

  it("rejects TIFF SubIFD structures instead of guessing their pixel budget", () => {
    const source = tiffImageFileDirectories([{ width: 8, height: 8 }], { subIfd: true });

    expect(readImageMetadataFromHeader(source)).toBeNull();
  });

  it("reports unavailable external processing with structured errors", async () => {
    const rastermill = createRastermill({
      execution: "external",
      commandResolver: () => null,
    });
    const source = rgbaImage(4, 4);

    await expect(
      rastermill.encode(source, { format: "png", resize: { maxSide: 2 } }),
    ).rejects.toBeInstanceOf(RastermillUnavailableError);
  });

  it("keeps execution=internal inside the process boundary", async () => {
    const requested: string[] = [];
    const rastermill = createRastermill({
      execution: "internal",
      commandResolver: (command) => {
        requested.push(command);
        return command;
      },
    });

    await expect(
      rastermill.encode(tiffImageFileDirectories([{ width: 4, height: 4 }]), {
        format: "jpeg",
        resize: { maxSide: 4 },
      }),
    ).rejects.toBeInstanceOf(RastermillUnavailableError);
    expect(requested).toEqual([]);
  });

  it("keeps execution=external from importing Photon", async () => {
    vi.resetModules();
    let photonImported = false;
    vi.doMock("@silvia-odwyer/photon-node", () => {
      photonImported = true;
      throw new Error("Photon should not be imported for external execution");
    });
    const { createRastermill: createFreshRastermill, encodePngRgba: encodeFreshPngRgba } =
      await import("../src/index.js");
    const rastermill = createFreshRastermill({
      execution: "external",
      commandResolver: () => null,
    });

    await expect(
      rastermill.encode(encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4), {
        format: "jpeg",
        resize: { maxSide: 2 },
      }),
    ).rejects.toMatchObject({ code: "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE" });
    expect(photonImported).toBe(false);
  });

  it("resolves native fallback commands through the injected resolver", async () => {
    const requested: string[] = [];
    const rastermill = createRastermill({
      execution: "external",
      commandResolver: (command) => {
        requested.push(command);
        return null;
      },
    });

    await expect(
      rastermill.encode(rgbaImage(4, 4), { format: "jpeg", resize: { maxSide: 4 } }),
    ).rejects.toBeInstanceOf(RastermillUnavailableError);
    expect(requested).toEqual(
      process.platform === "darwin"
        ? ["sips", "magick", "convert", "gm", "ffmpeg"]
        : process.platform === "win32"
          ? ["powershell", "magick", "gm", "ffmpeg"]
          : ["magick", "convert", "gm", "ffmpeg"],
    );
  });

  it.runIf(process.platform === "darwin")(
    "tries sips first for external JPEG processing on macOS",
    async () => {
      const requested: string[] = [];
      const rastermill = createRastermill({
        execution: "external",
        commandResolver: (command) => {
          requested.push(command);
          return null;
        },
      });

      await expect(
        rastermill.encode(rgbaImage(4, 4), { format: "jpeg", resize: { maxSide: 4 } }),
      ).rejects.toBeInstanceOf(RastermillUnavailableError);
      expect(requested[0]).toBe("sips");
    },
  );

  it("does not fall back to native tools after a real Photon processing error", async () => {
    vi.resetModules();
    vi.doMock("@silvia-odwyer/photon-node", () => {
      class MockPhotonImage {
        static new_from_byteslice = vi.fn<() => MockPhotonImage>(() => new MockPhotonImage());
        free(): void {}
        get_bytes_webp(): Uint8Array {
          return new Uint8Array();
        }
        get_height(): number {
          return 4;
        }
        get_width(): number {
          return 4;
        }
      }
      return {
        PhotonImage: MockPhotonImage,
        SamplingFilter: {
          Lanczos3: 1,
        },
        crop: vi.fn<() => void>(),
        resize: vi.fn<() => never>(() => {
          throw new Error("corrupt image payload");
        }),
      };
    });

    const { createRastermill: createFreshRastermill, encodePngRgba: encodeFreshPngRgba } =
      await import("../src/index.js");
    const requested: string[] = [];
    const rastermill = createFreshRastermill({
      commandResolver: (command) => {
        requested.push(command);
        return command;
      },
    });

    await expect(
      rastermill.encode(encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4), {
        format: "jpeg",
        resize: { maxSide: 2 },
        quality: 80,
      }),
    ).rejects.toThrow(/corrupt image payload/);
    expect(requested).toEqual([]);
  });
});
