import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRastermill,
  encodePngRgba,
  RastermillUnavailableError,
  readImageMetadataFromHeader,
  readImageProbeFromHeader,
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

function jpegHeaderWithExifOrientation(width: number, height: number, orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exifPayload.length + 2, 2);

  const sof0 = Buffer.alloc(19);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3;

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exifPayload, sof0, Buffer.from([0xff, 0xd9])]);
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

  it("reads image metadata from headers without decoding", () => {
    const image = rgbaImage(16, 8);

    expect(readImageMetadataFromHeader(image)).toEqual({ width: 16, height: 8 });
    expect(readImageProbeFromHeader(image)).toEqual({
      format: "png",
      width: 16,
      height: 8,
      hasAlpha: true,
      orientation: null,
    });
  });

  it("encodes PNG input to JPEG through the unified processor API", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 8);

    const jpeg = await rastermill.encode(source, {
      format: "jpeg",
      resize: { maxSide: 4 },
      quality: 82,
    });

    expect(jpeg).toMatchObject({ format: "jpeg", width: 4, height: 2, bytes: jpeg.data.length });
    await expect(rastermill.metadata(jpeg.data)).resolves.toEqual({ width: 4, height: 2 });
  });

  it("keeps compatibility wrappers delegating to encode", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 8);

    const jpeg = await rastermill.toJpeg(source, { maxSide: 4, quality: 82 });

    await expect(rastermill.metadata(jpeg)).resolves.toEqual({ width: 4, height: 2 });
  });

  it("copies caller-owned buffers before async processing", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 8);
    const replacement = rgbaImage(64, 64);

    const resize = rastermill.toJpeg(source, { maxSide: 4, quality: 82 });
    replacement.copy(source, 0, 0, Math.min(source.length, replacement.length));
    const jpeg = await resize;

    await expect(rastermill.metadata(jpeg)).resolves.toEqual({ width: 4, height: 2 });
  });

  it("resizes PNG input while preserving alpha", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(10, 6, 120);

    const png = await rastermill.toPng(source, { maxSide: 5, compressionLevel: 9 });

    await expect(rastermill.metadata(png)).resolves.toEqual({ width: 5, height: 3 });
    await expect(rastermill.hasAlpha(png)).resolves.toBe(true);
  });

  it("optimizes PNG output under the requested byte cap when possible", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 255);
    const { optimizePng } = rastermill;

    const result = await optimizePng(source, {
      maxBytes: 256,
      sides: [16, 8],
      compressionLevels: [9],
    });

    expect(result.optimizedSize).toBeLessThanOrEqual(256);
    expect(result.resizeSide).toBeGreaterThan(0);
  });

  it("generalizes byte-budget encoding across formats", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 255);

    const result = await rastermill.encodeWithinBytes(source, {
      format: "jpeg",
      maxBytes: 700,
      search: {
        maxSide: [32, 16],
        quality: [80, 50],
      },
    });

    expect(result.bytes).toBeLessThanOrEqual(700);
    expect(result.chosen.maxSide).toBeGreaterThan(0);
    expect(result.chosen.quality).toBeGreaterThan(0);
  });

  it("keeps the caller resize cap as the default byte-budget search side", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 255);

    const result = await rastermill.encodeWithinBytes(source, {
      format: "jpeg",
      maxBytes: 10_000_000,
      resize: { maxSide: 16 },
    });

    expect(result.width).toBeLessThanOrEqual(16);
    expect(result.height).toBeLessThanOrEqual(16);
    expect(result.chosen.maxSide).toBe(16);
  });

  it("rejects images over the configured pixel budget before decoding", async () => {
    const rastermill = createRastermill({ maxInputPixels: 100 });
    const source = rgbaImage(20, 20);

    await expect(rastermill.toJpeg(source, { maxSide: 8 })).rejects.toThrow(
      "pixel input limit",
    );
  });

  it("rejects resize targets over the configured output pixel budget", async () => {
    const rastermill = createRastermill({ maxOutputPixels: 100 });
    const source = rgbaImage(1, 1);

    await expect(
      rastermill.toJpeg(source, { maxSide: 100_000, withoutEnlargement: false }),
    ).rejects.toThrow("pixel output limit");
  });

  it("validates normalize inputs before returning unchanged bytes", async () => {
    const rastermill = createRastermill({ maxInputPixels: 100 });

    await expect(rastermill.normalize(rgbaImage(20, 20))).rejects.toThrow("pixel input limit");
  });

  it("reports normalize backend unavailability as a normalize failure", async () => {
    const rastermill = createRastermill({
      backend: "imagemagick",
      commandResolver: () => null,
    });

    await expect(rastermill.normalize(jpegHeaderWithExifOrientation(8, 4, 6))).rejects.toMatchObject({
      operation: "normalize",
    });
  });

  it("passes exact fill dimensions through to native backends", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "rastermill-native-test-"));
    try {
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
        backend: "imagemagick",
        commandResolver: (command) => (command === "magick" ? script : null),
      });

      const result = await rastermill.encode(rgbaImage(8, 4), {
        format: "jpeg",
        resize: { fit: "fill", width: 4, height: 4 },
      });

      expect(result).toMatchObject({ width: 4, height: 4 });
      expect(JSON.parse(await readFile(log, "utf8"))).toContain("4x4!");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects cover resize until crop semantics are implemented", async () => {
    const rastermill = createRastermill();

    await expect(
      rastermill.encode(rgbaImage(8, 4), {
        format: "jpeg",
        resize: { fit: "cover", width: 4 },
      }),
    ).rejects.toThrow("resize.fit cover is not supported yet");
  });

  it("uses the largest linked TIFF page for metadata and pixel limits", async () => {
    const rastermill = createRastermill({ maxInputPixels: 25_000_000 });
    const source = tiffImageFileDirectories([
      { width: 8, height: 8 },
      { width: 8000, height: 4000 },
    ]);

    expect(readImageMetadataFromHeader(source)).toEqual({ width: 8000, height: 4000 });
    await expect(rastermill.toJpeg(source, { maxSide: 8 })).rejects.toThrow("pixel input limit");
  });

  it("rejects TIFF SubIFD structures instead of guessing their pixel budget", () => {
    const source = tiffImageFileDirectories([{ width: 8, height: 8 }], { subIfd: true });

    expect(readImageMetadataFromHeader(source)).toBeNull();
  });

  it("reports unavailable forced backends with structured errors", async () => {
    const rastermill = createRastermill({ backend: "ffmpeg" });
    const source = rgbaImage(4, 4);

    await expect(rastermill.toPng(source, { maxSide: 4 })).rejects.toBeInstanceOf(
      RastermillUnavailableError,
    );
  });

  it("resolves native fallback commands through the injected resolver", async () => {
    const requested: string[] = [];
    const rastermill = createRastermill({
      backend: "imagemagick",
      commandResolver: (command) => {
        requested.push(command);
        return null;
      },
    });

    await expect(rastermill.toJpeg(rgbaImage(4, 4), { maxSide: 4 })).rejects.toBeInstanceOf(
      RastermillUnavailableError,
    );
    expect(requested).toEqual(process.platform === "win32" ? ["magick"] : ["magick", "convert"]);
  });

  it("uses the Rastermill backend env var without app-specific fallbacks", async () => {
    const previousRastermillBackend = process.env.RASTERMILL_IMAGE_BACKEND;
    const previousOpenClawBackend = process.env.OPENCLAW_IMAGE_BACKEND;
    try {
      process.env.RASTERMILL_IMAGE_BACKEND = "imagemagick";
      process.env.OPENCLAW_IMAGE_BACKEND = "ffmpeg";
      const requested: string[] = [];
      const rastermill = createRastermill({
        commandResolver: (command) => {
          requested.push(command);
          return null;
        },
      });

      await expect(rastermill.toJpeg(rgbaImage(4, 4), { maxSide: 4 })).rejects.toBeInstanceOf(
        RastermillUnavailableError,
      );
      expect(requested).toEqual(process.platform === "win32" ? ["magick"] : ["magick", "convert"]);
    } finally {
      if (previousRastermillBackend === undefined) {
        delete process.env.RASTERMILL_IMAGE_BACKEND;
      } else {
        process.env.RASTERMILL_IMAGE_BACKEND = previousRastermillBackend;
      }
      if (previousOpenClawBackend === undefined) {
        delete process.env.OPENCLAW_IMAGE_BACKEND;
      } else {
        process.env.OPENCLAW_IMAGE_BACKEND = previousOpenClawBackend;
      }
    }
  });

  it("does not fall back to native tools after a real Photon processing error", async () => {
    vi.resetModules();
    vi.doMock("@silvia-odwyer/photon-node", () => {
      const image = {
        free: vi.fn(),
        get_height: vi.fn(() => 4),
        get_width: vi.fn(() => 4),
      };
      return {
        PhotonImage: {
          new_from_byteslice: vi.fn(() => image),
        },
        SamplingFilter: {
          Lanczos3: 1,
        },
        resize: vi.fn(() => {
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
      rastermill.toJpeg(encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4), {
        maxSide: 2,
        quality: 80,
      }),
    ).rejects.toThrow(/corrupt image payload/);
    expect(requested).toEqual([]);
  });
});
