import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

    expect(jpeg).toMatchObject({ format: "jpeg", width: 4, height: 2, bytes: jpeg.data.length });
    expect(readImageMetadataFromHeader(jpeg.data)).toEqual({ width: 4, height: 2 });
  });

  it("copies caller-owned buffers before async processing", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(16, 8);
    const replacement = rgbaImage(64, 64);

    const pending = rastermill.encode(source, { format: "jpeg", resize: { maxSide: 4 }, quality: 82 });
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
      png: { compressionLevel: 9 },
    });

    expect(png).toMatchObject({ format: "png", width: 5, height: 3 });
    await expect(rastermill.probe(png.data)).resolves.toMatchObject({ hasAlpha: true });
  });

  it("encodes under a byte budget by searching dimensions and compression", async () => {
    const rastermill = createRastermill();
    const source = rgbaImage(64, 64, 255);

    const result = await rastermill.encodeWithinBytes(source, {
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

    const result = await rastermill.encodeWithinBytes(source, {
      format: "jpeg",
      maxBytes: 700,
      search: { maxSide: [32, 16], quality: [80, 50] },
    });

    expect(result.bytes).toBeLessThanOrEqual(700);
    expect(result.chosen.maxSide).toBeGreaterThan(0);
    expect(result.chosen.quality).toBeGreaterThan(0);
  });

  it("rejects images over the configured pixel budget before decoding", async () => {
    const rastermill = createRastermill({ limits: { inputPixels: 100 } });
    const source = rgbaImage(20, 20);

    await expect(
      rastermill.encode(source, { format: "jpeg", resize: { maxSide: 8 } }),
    ).rejects.toThrow("pixel input limit");
  });

  it("rejects resize targets over the configured output pixel budget", async () => {
    const rastermill = createRastermill({ limits: { outputPixels: 100 } });
    const source = rgbaImage(1, 1);

    await expect(
      rastermill.encode(source, { format: "jpeg", resize: { maxSide: 100_000, enlarge: true } }),
    ).rejects.toThrow("pixel output limit");
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
      rastermill.encode(rgbaImage(8, 4), { format: "jpeg", resize: { fit: "cover", width: 4 } }),
    ).rejects.toThrow("resize.fit cover is not supported yet");
  });

  it.runIf(process.platform === "darwin" && existsSync("/usr/bin/sips"))(
    "encodes through the native sips backend",
    async () => {
      const rastermill = createRastermill({ backend: "sips" });

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

  it("reports unavailable forced backends with structured errors", async () => {
    const rastermill = createRastermill({ backend: "ffmpeg" });
    const source = rgbaImage(4, 4);

    await expect(
      rastermill.encode(source, { format: "png", resize: { maxSide: 4 } }),
    ).rejects.toBeInstanceOf(RastermillUnavailableError);
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

    await expect(
      rastermill.encode(rgbaImage(4, 4), { format: "jpeg", resize: { maxSide: 4 } }),
    ).rejects.toBeInstanceOf(RastermillUnavailableError);
    expect(requested).toEqual(process.platform === "win32" ? ["magick"] : ["magick", "convert"]);
  });

  it("reads the backend preference from the configured env var without app-specific fallbacks", async () => {
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

      await expect(
        rastermill.encode(rgbaImage(4, 4), { format: "jpeg", resize: { maxSide: 4 } }),
      ).rejects.toBeInstanceOf(RastermillUnavailableError);
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
      rastermill.encode(encodeFreshPngRgba(new Uint8Array(4 * 4 * 4), 4, 4), {
        format: "jpeg",
        resize: { maxSide: 2 },
        quality: 80,
      }),
    ).rejects.toThrow(/corrupt image payload/);
    expect(requested).toEqual([]);
  });
});
