import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);

type PhotonModule = typeof import("@silvia-odwyer/photon-node");
type PhotonImage = InstanceType<PhotonModule["PhotonImage"]>;

/** Image bytes accepted by Rastermill. File paths and streams are intentionally not part of the public API yet. */
export type ImageInput = Buffer | Uint8Array | ArrayBuffer;

/** Pixel dimensions read from an image header or encoded output. */
export type ImageMetadata = {
  width: number;
  height: number;
};

/** Input formats Rastermill can identify from headers. Decode support depends on execution mode and available codecs. */
export type ImageFormat = "png" | "gif" | "webp" | "bmp" | "tiff" | "heif" | "avif" | "jpeg";

/** Output formats Rastermill can encode. WebP quality requires an external backend because Photon exposes fixed-quality WebP only. */
export type EncodedImageFormat = "jpeg" | "png" | "webp";

/** Header-only probe result. `hasAlpha` is a cheap hint and may be null when the container does not expose it. */
export type ImageProbe = ImageMetadata & {
  format: ImageFormat;
  hasAlpha: boolean | null;
  orientation: number | null;
  bytes: number;
};

/** Full alpha inspection result. This decodes pixels for formats whose header cannot prove transparency. */
export type ImageTransparency = {
  hasAlphaChannel: boolean;
  hasTransparentPixels: boolean;
};

type ImageBackend =
  | "photon"
  | "sips"
  | "windows-native"
  | "imagemagick"
  | "graphicsmagick"
  | "ffmpeg";

/** Controls whether Rastermill may load Photon in-process, spawn native tools, or use both. */
export type ImageExecutionMode = "auto" | "internal" | "external";

/** Resolves native command names. Return null to mark a tool unavailable. */
export type ImageCommandResolver = (command: string) => string | null | Promise<string | null>;

/** Produces temporary directory prefixes for native-tool workspaces. */
export type TempPrefixResolver = () => string;

/** Rastermill instance configuration. Pixel limits are enforced before decode or native-tool execution whenever dimensions are knowable from headers. */
export type RastermillOptions = {
  execution?: ImageExecutionMode;
  limits?: {
    inputPixels?: number;
    outputPixels?: number;
  };
  temp?: {
    rootDir?: string;
    prefix?: string | TempPrefixResolver;
  };
  timeoutMs?: number;
  maxProcessBufferBytes?: number;
  commandResolver?: ImageCommandResolver;
};

type ResolvedOptions = {
  execution: ImageExecutionMode;
  maxInputPixels: number;
  maxOutputPixels: number;
  tempRootDir: string;
  tempPrefix: string | TempPrefixResolver;
  timeoutMs: number;
  maxProcessBufferBytes: number;
  commandResolver: ImageCommandResolver;
};

/** Resize strategy. `cover` center-crops after scaling; `fill` stretches to exact dimensions. */
export type ResizeFit = "inside" | "cover" | "fill";

/** Resize request. By default Rastermill preserves aspect ratio and never enlarges. */
export type ResizeOptions = {
  fit?: ResizeFit;
  maxSide?: number;
  width?: number;
  height?: number;
  enlarge?: boolean;
};

/** Output metadata handling. Photon cannot read, copy, or selectively preserve EXIF/GPS/ICC/XMP. */
export type ImageMetadataPolicy = "strip" | "preserve";

/** What happened to source metadata in the returned bytes. */
export type EncodedImageMetadataStatus = "stripped" | "preserved";

type BaseEncodeOptions = {
  resize?: ResizeOptions;
  autoOrient?: boolean;
  signal?: AbortSignal;
  /**
   * Metadata policy. Default "strip" forces a decode/re-encode even for no-op encodes.
   * "preserve" only preserves metadata when Rastermill can return original bytes unchanged;
   * any actual transform still strips metadata because Photon has no metadata API.
   */
  metadata?: ImageMetadataPolicy;
};

/** JPEG encode options. `quality` is 1-100 and defaults to 85. */
export type JpegEncodeOptions = BaseEncodeOptions & {
  format: "jpeg";
  quality?: number;
};

/** PNG encode options. `compressionLevel` is 0-9 and defaults to 6. */
export type PngEncodeOptions = BaseEncodeOptions & {
  format: "png";
  compressionLevel?: number;
};

/** WebP encode options. `quality` requires an external backend; Photon only exposes fixed-quality WebP. */
export type WebpEncodeOptions = BaseEncodeOptions & {
  format: "webp";
  quality?: number;
};

/** Concrete-format encode options. Format-specific knobs are only valid on their matching format. */
export type SpecificEncodeOptions = JpegEncodeOptions | PngEncodeOptions | WebpEncodeOptions;

/** Search axes for byte-budget encoding. WebP quality search requires external execution. */
export type EncodeSearchOptions = {
  maxSide?: readonly number[];
  quality?: readonly number[];
  compressionLevel?: readonly number[];
};

/** Format preferences for `format: "auto"`. WebP quality requires an external backend. */
export type EncodeFormatPreference =
  | {
      format: "jpeg";
      quality?: number;
    }
  | {
      format: "png";
      compressionLevel?: number;
    }
  | {
      format: "webp";
      quality?: number;
    };

export type TransparentEncodeFormatPreference = Extract<
  EncodeFormatPreference,
  { format: "png" | "webp" }
>;

/** Transparency policy for `format: "auto"`. `auto` only decodes known alpha-capable internal formats before deciding. */
export type EncodeTransparencyMode = "auto" | "prefer" | "preserve" | "flatten";

/** Dimension limits for `encode`. At least one limit must be present when `limits` is supplied. */
export type ImageDimensionLimits = {
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
};

type EncodePolicyOptions = {
  maxBytes?: number;
  search?: EncodeSearchOptions;
  limits?: ImageDimensionLimits;
};

/** Automatic output selection. Opaque images use `opaque`; images with transparent pixels use `transparent`. */
export type AutoEncodeOptions = BaseEncodeOptions &
  EncodePolicyOptions & {
    format?: "auto";
    opaque?: EncodeFormatPreference;
    transparent?: TransparentEncodeFormatPreference;
    transparency?: EncodeTransparencyMode;
  };

/** Public encode options. Use `format: "jpeg" | "png" | "webp"` for exact output, or `format: "auto"` for policy-driven output. */
export type EncodeOptions = (SpecificEncodeOptions & EncodePolicyOptions) | AutoEncodeOptions;

/** Encoded output bytes plus final dimensions, metadata status, and any policy choices Rastermill made. */
export type EncodedImage = ImageMetadata & {
  data: Buffer;
  format: EncodedImageFormat;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  metadata: EncodedImageMetadataStatus;
  withinBudget?: boolean;
  resized: boolean;
  chosen: {
    format: EncodedImageFormat;
    transparency?: "preserved" | "flattened" | "not-present";
    maxSide?: number;
    quality?: number;
    compressionLevel?: number;
  };
};

type BudgetEncodeOptions = SpecificEncodeOptions & {
  maxBytes: number;
  search?: EncodeSearchOptions;
};

type BudgetEncodedImage = EncodedImage & {
  withinBudget: boolean;
};

type AutoPolicyEncodeOptions = BaseEncodeOptions & {
  opaque?: EncodeFormatPreference;
  transparent?: TransparentEncodeFormatPreference;
  maxBytes?: number;
  search?: EncodeSearchOptions;
  transparency?: EncodeTransparencyMode;
  resize?: ResizeOptions;
};

type AutoEncodedImage = EncodedImage;

type LimitEncodeOptions = BaseEncodeOptions & {
  limits: ImageDimensionLimits;
  opaque?: EncodeFormatPreference;
  transparent?: TransparentEncodeFormatPreference;
  maxBytes?: number;
  search?: EncodeSearchOptions;
  transparency?: EncodeTransparencyMode;
};

type NativeEncodeOptions = {
  target: ImageMetadata;
  scaledTarget: ImageMetadata;
  fit: ResizeFit;
  quality?: number;
  compressionLevel?: number;
  autoOrient?: boolean;
  signal?: AbortSignal;
  metadata: ImageMetadataPolicy;
};

/** Rastermill processor instance. Create one when you need custom limits, execution mode, temp roots, or command resolution. */
export type Rastermill = {
  /** Read cheap header facts without full decode. Returns null for unknown, undecodable, or over-budget inputs. */
  probe(input: ImageInput): Promise<ImageProbe | null>;
  /** Decode enough pixels to distinguish alpha-channel presence from real transparent pixels. Never spawns external tools. */
  transparency(input: ImageInput): Promise<ImageTransparency>;
  /** Resize, convert, auto-select format, fit dimension limits, and/or search a byte budget. */
  encode(input: ImageInput, options?: EncodeOptions): Promise<EncodedImage>;
};

type RastermillInternal = Rastermill & {
  encodeDirect(input: ImageInput, options: SpecificEncodeOptions): Promise<EncodedImage>;
  encodeWithBudget(
    input: ImageInput,
    options: BudgetEncodeOptions,
  ): Promise<BudgetEncodedImage>;
  encodeAuto(input: ImageInput, options?: AutoPolicyEncodeOptions): Promise<AutoEncodedImage>;
  encodeWithLimits(input: ImageInput, options: LimitEncodeOptions): Promise<AutoEncodedImage>;
};

type ImageOperation = "encode" | "transparency";

/** Structured Rastermill error codes. These are stable for external callers. */
export type RastermillErrorCode =
  | "RASTERMILL_INPUT_TOO_LARGE"
  | "RASTERMILL_OUTPUT_TOO_LARGE"
  | "RASTERMILL_BAD_OPTION"
  | "RASTERMILL_UNDECODABLE"
  | "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE";

type ExternalImageTool =
  | { backend: "sips"; flavor: "sips"; command: string }
  | { backend: "windows-native"; flavor: "powershell"; command: string }
  | { backend: "imagemagick"; flavor: "magick" | "convert"; command: string }
  | { backend: "graphicsmagick"; flavor: "gm"; command: string }
  | { backend: "ffmpeg"; flavor: "ffmpeg"; command: string };

const DEFAULT_MAX_INPUT_PIXELS = 25_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PROCESS_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_JPEG_QUALITY = 85;
const DEFAULT_PNG_COMPRESSION_LEVEL = 6;
const DEFAULT_TEMP_PREFIX = "rastermill-";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_PNG_SIDES = [2048, 1536, 1280, 1024, 800] as const;
const DEFAULT_PNG_COMPRESSION_LEVELS = [6, 7, 8, 9] as const;

const ISO_BMFF_IMAGE_BRANDS = new Set([
  "avif",
  "avis",
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heif",
  "mif1",
  "msf1",
]);

const ISO_BMFF_CONTAINER_BOXES = new Set([
  "edts",
  "ipco",
  "iprp",
  "mdia",
  "meta",
  "minf",
  "moov",
  "stbl",
  "trak",
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

let photonPromise: Promise<PhotonModule> | null = null;

/** Base error for validation, size-limit, undecodable-input, and backend-unavailable failures. */
export class RastermillError extends Error {
  readonly code: RastermillErrorCode;

  constructor(code: RastermillErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RastermillError";
    this.code = code;
  }
}

/** Error thrown when the configured execution boundary cannot perform the requested image operation. */
export class RastermillUnavailableError extends RastermillError {
  readonly operation: ImageOperation;
  readonly causes: unknown[];

  constructor(operation: ImageOperation, message: string, causes: unknown[] = []) {
    super("RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE", message, {
      cause: causes.find((cause): cause is Error => cause instanceof Error),
    });
    this.name = "RastermillUnavailableError";
    this.operation = operation;
    this.causes = causes;
  }
}

/** Type guard for all structured Rastermill errors. */
export function isRastermillError(error: unknown): error is RastermillError {
  return error instanceof RastermillError;
}

/** Type guard for backend/codecs-unavailable errors. Malformed images and bad options are not "unavailable". */
export function isRastermillUnavailableError(error: unknown): error is RastermillUnavailableError {
  return error instanceof RastermillUnavailableError;
}

function toBuffer(input: ImageInput): Buffer {
  if (input instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(input));
  }
  return Buffer.from(input);
}

function rastermillError(
  code: Exclude<RastermillErrorCode, "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE">,
  message: string,
  options?: ErrorOptions,
): RastermillError {
  return new RastermillError(code, message, options);
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw rastermillError("RASTERMILL_BAD_OPTION", `${label} must be a positive integer`);
  }
  return value;
}

function normalizeTempRootDir(value: string | undefined): string {
  const rootDir = value ?? os.tmpdir();
  if (rootDir.trim().length === 0) {
    throw rastermillError("RASTERMILL_BAD_OPTION", "temp.rootDir must not be empty");
  }
  return rootDir;
}

function validateTempPrefix(value: string): string {
  if (value.length === 0) {
    throw rastermillError("RASTERMILL_BAD_OPTION", "temp.prefix must not be empty");
  }
  if (value.includes("/") || value.includes("\\")) {
    throw rastermillError("RASTERMILL_BAD_OPTION", "temp.prefix must be a filename prefix");
  }
  return value;
}

function normalizeOptions(options: RastermillOptions): ResolvedOptions {
  const execution = normalizeExecutionMode(options.execution);
  const maxInputPixels = normalizePositiveInteger(
    options.limits?.inputPixels ?? DEFAULT_MAX_INPUT_PIXELS,
    "limits.inputPixels",
  );
  const tempPrefix = options.temp?.prefix ?? DEFAULT_TEMP_PREFIX;
  if (typeof tempPrefix === "string") {
    validateTempPrefix(tempPrefix);
  }
  return {
    execution,
    maxInputPixels,
    maxOutputPixels: normalizePositiveInteger(
      options.limits?.outputPixels ?? maxInputPixels,
      "limits.outputPixels",
    ),
    tempRootDir: normalizeTempRootDir(options.temp?.rootDir),
    tempPrefix,
    timeoutMs: normalizePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs"),
    maxProcessBufferBytes: normalizePositiveInteger(
      options.maxProcessBufferBytes ?? DEFAULT_MAX_PROCESS_BUFFER_BYTES,
      "maxProcessBufferBytes",
    ),
    commandResolver: options.commandResolver ?? resolveExecutableFromPath,
  };
}

function normalizeExecutionMode(value: string | undefined): ImageExecutionMode {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case undefined:
    case "":
    case "auto":
      return "auto";
    case "internal":
    case "in-process":
    case "inprocess":
      return "internal";
    case "external":
    case "native":
      return "external";
    default:
      throw rastermillError(
        "RASTERMILL_BAD_OPTION",
        'execution must be "auto", "internal", or "external"',
      );
  }
}

function isInternalBackend(backend: ImageBackend): boolean {
  return backend === "photon";
}

function allowsInternalBackend(options: Pick<ResolvedOptions, "execution">): boolean {
  return options.execution !== "external";
}

function normalizeMetadata(width: number, height: number): ImageMetadata | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function readPngMetadata(buffer: Buffer): ImageMetadata | null {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return normalizeMetadata(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function readPngAlphaChannel(buffer: Buffer): boolean | null {
  if (buffer.length < 29 || readPngMetadata(buffer) === null) {
    return null;
  }
  const colorType = buffer[25];
  if (colorType === 4 || colorType === 6) {
    return true;
  }
  if (colorType !== 0 && colorType !== 2 && colorType !== 3) {
    return null;
  }
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const nextOffset = dataEnd + 4;
    if (dataEnd > buffer.length || nextOffset > buffer.length) {
      return null;
    }
    const chunkType = buffer.toString("ascii", typeStart, typeStart + 4);
    if (chunkType === "tRNS") {
      return chunkLength > 0;
    }
    if (chunkType === "IDAT" || chunkType === "IEND") {
      return false;
    }
    offset = nextOffset;
  }
  return false;
}

function readWebpAlphaChannel(buffer: Buffer): boolean | null {
  if (
    buffer.length < 21 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  if (buffer.toString("ascii", 12, 16) === "VP8X") {
    return (buffer[20] ?? 0) & 0x10 ? true : false;
  }
  if (buffer.toString("ascii", 12, 16) === "VP8L") {
    if (buffer.length < 25 || buffer[20] !== 0x2f) {
      return null;
    }
    const bits =
      buffer.readUInt8(21) |
      (buffer.readUInt8(22) << 8) |
      (buffer.readUInt8(23) << 16) |
      (buffer.readUInt8(24) << 24);
    return (bits >>> 28) & 1 ? true : false;
  }
  return null;
}

function readGifMetadata(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 10) {
    return null;
  }
  const signature = buffer.toString("ascii", 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    return null;
  }
  return normalizeMetadata(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
}

function readWebpMetadata(buffer: Buffer): ImageMetadata | null {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return normalizeMetadata(1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3));
  }
  if (chunkType === "VP8 ") {
    return normalizeMetadata(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }
  if (chunkType === "VP8L") {
    if (buffer.length < 25 || buffer[20] !== 0x2f) {
      return null;
    }
    const bits =
      buffer.readUInt8(21) |
      (buffer.readUInt8(22) << 8) |
      (buffer.readUInt8(23) << 16) |
      (buffer.readUInt8(24) << 24);
    return normalizeMetadata((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return null;
}

function readBmpMetadata(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 26 || buffer.toString("ascii", 0, 2) !== "BM") {
    return null;
  }
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (dibHeaderSize === 12) {
    return normalizeMetadata(buffer.readUInt16LE(18), buffer.readUInt16LE(20));
  }
  if (dibHeaderSize < 40) {
    return null;
  }
  return normalizeMetadata(buffer.readInt32LE(18), Math.abs(buffer.readInt32LE(22)));
}

function readTiffUnsignedInteger(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readTiffUnsignedLong(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function readTiffMetadata(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 8) {
    return null;
  }
  const byteOrder = buffer.toString("ascii", 0, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") {
    return null;
  }
  if (readTiffUnsignedInteger(buffer, 2, littleEndian) !== 42) {
    return null;
  }
  let ifdOffset = readTiffUnsignedLong(buffer, 4, littleEndian);
  let largest: ImageMetadata | null = null;
  const seen = new Set<number>();

  while (ifdOffset !== 0) {
    if (seen.has(ifdOffset) || ifdOffset + 2 > buffer.length) {
      return null;
    }
    seen.add(ifdOffset);

    const entryCount = readTiffUnsignedInteger(buffer, ifdOffset, littleEndian);
    const entriesStart = ifdOffset + 2;
    const entriesEnd = entriesStart + entryCount * 12;
    if (entriesEnd + 4 > buffer.length) {
      return null;
    }

    let width: number | null = null;
    let height: number | null = null;
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = entriesStart + index * 12;
      const tag = readTiffUnsignedInteger(buffer, entryOffset, littleEndian);
      if (tag === 330) {
        return null;
      }
      if (tag !== 256 && tag !== 257) {
        continue;
      }
      const type = readTiffUnsignedInteger(buffer, entryOffset + 2, littleEndian);
      const count = readTiffUnsignedLong(buffer, entryOffset + 4, littleEndian);
      if (count !== 1 || (type !== 3 && type !== 4)) {
        continue;
      }
      const value =
        type === 3
          ? readTiffUnsignedInteger(buffer, entryOffset + 8, littleEndian)
          : readTiffUnsignedLong(buffer, entryOffset + 8, littleEndian);
      if (tag === 256) {
        width = value;
      } else {
        height = value;
      }
    }

    const metadata = width === null || height === null ? null : normalizeMetadata(width, height);
    if (!metadata) {
      return null;
    }
    largest = pickLargerImageMetadata(largest, metadata);
    ifdOffset = readTiffUnsignedLong(buffer, entriesEnd, littleEndian);
  }

  return largest;
}

function readIsoBmffBoxSize(buffer: Buffer, offset: number, end: number): number | null {
  if (offset + 8 > end) {
    return null;
  }
  const size32 = buffer.readUInt32BE(offset);
  if (size32 === 0) {
    return end - offset;
  }
  if (size32 === 1) {
    if (offset + 16 > end) {
      return null;
    }
    const size64 = buffer.readBigUInt64BE(offset + 8);
    return size64 <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(size64) : null;
  }
  return size32;
}

function isIsoBmffImage(buffer: Buffer): boolean {
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    return false;
  }
  const ftypSize = readIsoBmffBoxSize(buffer, 0, buffer.length);
  if (!ftypSize || ftypSize < 16 || ftypSize > buffer.length) {
    return false;
  }
  for (let offset = 8; offset + 4 <= ftypSize; offset += 4) {
    if (ISO_BMFF_IMAGE_BRANDS.has(buffer.toString("ascii", offset, offset + 4))) {
      return true;
    }
  }
  return false;
}

function isAvifImage(buffer: Buffer): boolean {
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    return false;
  }
  const ftypSize = readIsoBmffBoxSize(buffer, 0, buffer.length);
  if (!ftypSize || ftypSize < 16 || ftypSize > buffer.length) {
    return false;
  }
  for (let offset = 8; offset + 4 <= ftypSize; offset += 4) {
    const brand = buffer.toString("ascii", offset, offset + 4);
    if (brand === "avif" || brand === "avis") {
      return true;
    }
  }
  return false;
}

function pickLargerImageMetadata(
  current: ImageMetadata | null,
  candidate: ImageMetadata | null,
): ImageMetadata | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  const currentPixels = BigInt(current.width) * BigInt(current.height);
  const candidatePixels = BigInt(candidate.width) * BigInt(candidate.height);
  return candidatePixels > currentPixels ? candidate : current;
}

function findIsoBmffIspeMetadata(
  buffer: Buffer,
  start: number,
  end: number,
  depth: number,
): ImageMetadata | null {
  if (depth > 8) {
    return null;
  }
  let offset = start;
  let largest: ImageMetadata | null = null;
  while (offset + 8 <= end) {
    const boxSize = readIsoBmffBoxSize(buffer, offset, end);
    if (!boxSize || boxSize < 8 || offset + boxSize > end) {
      return null;
    }
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const headerSize = buffer.readUInt32BE(offset) === 1 ? 16 : 8;
    const dataStart = offset + headerSize;
    const boxEnd = offset + boxSize;
    if (type === "ispe" && dataStart + 12 <= boxEnd) {
      largest = pickLargerImageMetadata(
        largest,
        normalizeMetadata(buffer.readUInt32BE(dataStart + 4), buffer.readUInt32BE(dataStart + 8)),
      );
    }
    if (ISO_BMFF_CONTAINER_BOXES.has(type)) {
      const childStart = type === "meta" ? dataStart + 4 : dataStart;
      largest = pickLargerImageMetadata(
        largest,
        findIsoBmffIspeMetadata(buffer, childStart, boxEnd, depth + 1),
      );
    }
    offset = boxEnd;
  }
  return largest;
}

function readIsoBmffImageMetadata(buffer: Buffer): ImageMetadata | null {
  return isIsoBmffImage(buffer) ? findIsoBmffIspeMetadata(buffer, 0, buffer.length, 0) : null;
}

function readJpegMetadata(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 8 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buffer.length) {
      return null;
    }
    const marker = buffer.readUInt8(offset);
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 1 >= buffer.length) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (segmentLength < 7 || offset + 6 >= buffer.length) {
        return null;
      }
      return normalizeMetadata(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

/** Read dimensions from a recognized image header without decoding pixels. Returns null when dimensions are unknown. */
export function readImageMetadataFromHeader(input: ImageInput): ImageMetadata | null {
  const buffer = toBuffer(input);
  const probe = readImageProbeFromHeader(buffer);
  return probe ? { width: probe.width, height: probe.height } : null;
}

/** Read format, dimensions, alpha hints, orientation, and byte size from a recognized image header. */
export function readImageProbeFromHeader(input: ImageInput): ImageProbe | null {
  const buffer = toBuffer(input);
  const png = readPngMetadata(buffer);
  if (png) {
    return {
      ...png,
      format: "png",
      hasAlpha: readPngAlphaChannel(buffer),
      orientation: null,
      bytes: buffer.length,
    };
  }
  const gif = readGifMetadata(buffer);
  if (gif) {
    return { ...gif, format: "gif", hasAlpha: null, orientation: null, bytes: buffer.length };
  }
  const webp = readWebpMetadata(buffer);
  if (webp) {
    return {
      ...webp,
      format: "webp",
      hasAlpha: readWebpAlphaChannel(buffer),
      orientation: null,
      bytes: buffer.length,
    };
  }
  const bmp = readBmpMetadata(buffer);
  if (bmp) {
    return { ...bmp, format: "bmp", hasAlpha: null, orientation: null, bytes: buffer.length };
  }
  const tiff = readTiffMetadata(buffer);
  if (tiff) {
    return { ...tiff, format: "tiff", hasAlpha: null, orientation: null, bytes: buffer.length };
  }
  const heif = readIsoBmffImageMetadata(buffer);
  if (heif) {
    return {
      ...heif,
      format: isAvifImage(buffer) ? "avif" : "heif",
      hasAlpha: null,
      orientation: null,
      bytes: buffer.length,
    };
  }
  const jpeg = readJpegMetadata(buffer);
  if (jpeg) {
    return {
      ...jpeg,
      format: "jpeg",
      hasAlpha: false,
      orientation: readJpegExifOrientation(buffer),
      bytes: buffer.length,
    };
  }
  return null;
}

function hasPhotonDecodableHeader(buffer: Buffer): boolean {
  return (
    readPngMetadata(buffer) !== null ||
    readGifMetadata(buffer) !== null ||
    readWebpMetadata(buffer) !== null ||
    readJpegMetadata(buffer) !== null
  );
}

function assertPhotonDecodableHeader(buffer: Buffer, operation: ImageOperation): void {
  if (!hasPhotonDecodableHeader(buffer)) {
    throw new RastermillUnavailableError(operation, "Photon cannot decode this image format");
  }
}

function validatePixelBudget(meta: ImageMetadata, maxInputPixels: number): ImageMetadata {
  if (meta.width > Math.floor(maxInputPixels / meta.height)) {
    const pixels = Number.isSafeInteger(meta.width * meta.height)
      ? ` (${meta.width * meta.height} pixels)`
      : "";
    throw rastermillError(
      "RASTERMILL_INPUT_TOO_LARGE",
      `Image dimensions exceed the ${maxInputPixels.toLocaleString("en-US")} pixel input limit: ${meta.width}x${meta.height}${pixels}`,
    );
  }
  return meta;
}

function assertHeaderPixelBudget(buffer: Buffer, maxInputPixels: number): ImageMetadata {
  const meta = readImageMetadataFromHeader(buffer);
  if (!meta) {
    throw rastermillError(
      "RASTERMILL_UNDECODABLE",
      "Unable to determine image dimensions; refusing to process",
    );
  }
  return validatePixelBudget(meta, maxInputPixels);
}

function readJpegExifOrientation(buffer: Buffer): number | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      return null;
    }
    if (offset + 4 > buffer.length) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      return null;
    }
    if (
      marker === 0xe1 &&
      segmentLength >= 14 &&
      buffer.toString("ascii", offset + 4, offset + 8) === "Exif" &&
      buffer[offset + 8] === 0 &&
      buffer[offset + 9] === 0
    ) {
      return readExifOrientationFromTiff(buffer, offset + 10, offset + 2 + segmentLength);
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readExifOrientationFromTiff(
  buffer: Buffer,
  tiffStart: number,
  tiffEnd: number,
): number | null {
  if (tiffStart + 8 > tiffEnd) {
    return null;
  }
  const byteOrder = buffer.toString("ascii", tiffStart, tiffStart + 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") {
    return null;
  }
  const readU16 = (offset: number) =>
    littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const readU32 = (offset: number) =>
    littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (readU16(tiffStart + 2) !== 42) {
    return null;
  }
  const ifd0Start = tiffStart + readU32(tiffStart + 4);
  if (ifd0Start + 2 > tiffEnd) {
    return null;
  }
  const entries = readU16(ifd0Start);
  for (let index = 0; index < entries; index += 1) {
    const entryOffset = ifd0Start + 2 + index * 12;
    if (entryOffset + 12 > tiffEnd) {
      return null;
    }
    if (readU16(entryOffset) === 0x0112) {
      const orientation = readU16(entryOffset + 8);
      return orientation >= 1 && orientation <= 8 ? orientation : null;
    }
  }
  return null;
}

function transformOrientation(
  rawPixels: Uint8Array,
  width: number,
  height: number,
  orientation: number,
): { pixels: Uint8Array; width: number; height: number } {
  if (orientation === 1) {
    return { pixels: rawPixels, width, height };
  }
  const swapsAxes =
    orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
  const outputWidth = swapsAxes ? height : width;
  const outputHeight = swapsAxes ? width : height;
  const out = new Uint8Array(outputWidth * outputHeight * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let targetX = x;
      let targetY = y;
      switch (orientation) {
        case 2:
          targetX = width - 1 - x;
          break;
        case 3:
          targetX = width - 1 - x;
          targetY = height - 1 - y;
          break;
        case 4:
          targetY = height - 1 - y;
          break;
        case 5:
          targetX = y;
          targetY = x;
          break;
        case 6:
          targetX = height - 1 - y;
          targetY = x;
          break;
        case 7:
          targetX = height - 1 - y;
          targetY = width - 1 - x;
          break;
        case 8:
          targetX = y;
          targetY = width - 1 - x;
          break;
      }
      const sourceOffset = (y * width + x) * 4;
      const targetOffset = (targetY * outputWidth + targetX) * 4;
      out[targetOffset] = rawPixels[sourceOffset] ?? 0;
      out[targetOffset + 1] = rawPixels[sourceOffset + 1] ?? 0;
      out[targetOffset + 2] = rawPixels[sourceOffset + 2] ?? 0;
      out[targetOffset + 3] = rawPixels[sourceOffset + 3] ?? 255;
    }
  }
  return { pixels: out, width: outputWidth, height: outputHeight };
}

async function loadPhoton(): Promise<PhotonModule> {
  photonPromise ??= import("@silvia-odwyer/photon-node").then((mod) => {
    if (
      typeof mod.PhotonImage?.new_from_byteslice !== "function" ||
      typeof mod.resize !== "function" ||
      typeof mod.crop !== "function" ||
      mod.SamplingFilter?.Lanczos3 === undefined
    ) {
      throw new Error("Photon did not expose the required image processor API");
    }
    if (typeof mod.PhotonImage.prototype.get_bytes_webp !== "function") {
      throw new Error("Photon did not expose WebP encoding");
    }
    return mod;
  });
  return await photonPromise;
}

function applyExifOrientation(
  photon: PhotonModule,
  image: PhotonImage,
  buffer: Buffer,
): PhotonImage {
  const orientation = readJpegExifOrientation(buffer);
  if (!orientation || orientation === 1) {
    return image;
  }
  const transformed = transformOrientation(
    image.get_raw_pixels(),
    image.get_width(),
    image.get_height(),
    orientation,
  );
  image.free();
  return new photon.PhotonImage(transformed.pixels, transformed.width, transformed.height);
}

function paethPredictor(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const distanceLeft = Math.abs(prediction - left);
  const distanceUp = Math.abs(prediction - up);
  const distanceUpperLeft = Math.abs(prediction - upperLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) {
    return left;
  }
  return distanceUp <= distanceUpperLeft ? up : upperLeft;
}

function unfilterPngScanlines(
  inflated: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer | null {
  const stride = width * bytesPerPixel;
  if (inflated.length !== (stride + 1) * height) {
    return null;
  }
  const out = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[row * (stride + 1)];
    const sourceOffset = row * (stride + 1) + 1;
    const targetOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[sourceOffset + column] ?? 0;
      const left = column >= bytesPerPixel ? (out[targetOffset + column - bytesPerPixel] ?? 0) : 0;
      const up = row > 0 ? (out[targetOffset + column - stride] ?? 0) : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? (out[targetOffset + column - stride - bytesPerPixel] ?? 0)
          : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + Math.floor((left + up) / 2);
          break;
        case 4:
          value = raw + paethPredictor(left, up, upperLeft);
          break;
        default:
          return null;
      }
      out[targetOffset + column] = value & 0xff;
    }
  }
  return out;
}

function decodeGrayscaleAlphaPng(buffer: Buffer): {
  pixels: Uint8Array;
  width: number;
  height: number;
} | null {
  if (buffer.length < 33 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }
  let width = 0;
  let height = 0;
  const idatChunks: Buffer[] = [];
  for (let offset = 8; offset + 12 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      return null;
    }
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (
        length !== 13 ||
        data[8] !== 8 ||
        data[9] !== 4 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        return null;
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  const metadata = normalizeMetadata(width, height);
  if (!metadata || idatChunks.length === 0) {
    return null;
  }
  const expectedInflatedLength = (width * 2 + 1) * height;
  const grayAlpha = unfilterPngScanlines(
    inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedInflatedLength }),
    width,
    height,
    2,
  );
  if (!grayAlpha) {
    return null;
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let source = 0, target = 0; source < grayAlpha.length; source += 2, target += 4) {
    const gray = grayAlpha[source] ?? 0;
    pixels[target] = gray;
    pixels[target + 1] = gray;
    pixels[target + 2] = gray;
    pixels[target + 3] = grayAlpha[source + 1] ?? 255;
  }
  return { pixels, width, height };
}

async function loadOrientedPhotonImage(
  buffer: Buffer,
  maxInputPixels: number,
  autoOrient = true,
  operation: ImageOperation = "encode",
): Promise<{ photon: PhotonModule; image: PhotonImage }> {
  assertHeaderPixelBudget(buffer, maxInputPixels);
  assertPhotonDecodableHeader(buffer, operation);
  const photon = await loadPhoton();
  let decoded: PhotonImage;
  try {
    decoded = photon.PhotonImage.new_from_byteslice(buffer);
  } catch (error) {
    const grayscaleAlpha = decodeGrayscaleAlphaPng(buffer);
    if (!grayscaleAlpha) {
      throw rastermillError("RASTERMILL_UNDECODABLE", "Unable to decode image with Photon", {
        cause: error,
      });
    }
    decoded = new photon.PhotonImage(
      grayscaleAlpha.pixels,
      grayscaleAlpha.width,
      grayscaleAlpha.height,
    );
  }
  validatePixelBudget({ width: decoded.get_width(), height: decoded.get_height() }, maxInputPixels);
  return { photon, image: autoOrient ? applyExifOrientation(photon, decoded, buffer) : decoded };
}

function targetSize(
  image: PhotonImage,
  resize: NormalizedResizeOptions,
): { width: number; height: number } {
  return scaledDimensions({ width: image.get_width(), height: image.get_height() }, resize);
}

type NormalizedResizeOptions = {
  fit: ResizeFit;
  width?: number;
  height?: number;
  maxSide?: number;
  enlarge: boolean;
};

function normalizeResizeOptions(
  resize: ResizeOptions | undefined,
  metadata: ImageMetadata,
): NormalizedResizeOptions {
  if (!resize) {
    return {
      fit: "inside",
      enlarge: false,
    };
  }
  if (resize.width !== undefined) {
    normalizePositiveInteger(resize.width, "resize.width");
  }
  if (resize.height !== undefined) {
    normalizePositiveInteger(resize.height, "resize.height");
  }
  if (resize.maxSide !== undefined) {
    normalizePositiveInteger(resize.maxSide, "resize.maxSide");
  }
  const fit = resize.fit ?? "inside";
  const hasMaxSide = resize.maxSide !== undefined;
  const hasWidthAndHeight = resize.width !== undefined && resize.height !== undefined;
  if ((fit === "cover" || fit === "fill") && !hasMaxSide && !hasWidthAndHeight) {
    throw rastermillError(
      "RASTERMILL_BAD_OPTION",
      `resize.width and resize.height are required when resize.fit is ${fit}`,
    );
  }
  return {
    fit,
    ...(resize.width === undefined ? {} : { width: resize.width }),
    ...(resize.height === undefined ? {} : { height: resize.height }),
    ...(resize.maxSide === undefined ? {} : { maxSide: resize.maxSide }),
    enlarge: resize.enlarge === true,
  };
}

function resizeBox(resize: NormalizedResizeOptions): ImageMetadata | null {
  let boxWidth = resize.width;
  let boxHeight = resize.height;
  if (resize.maxSide !== undefined) {
    boxWidth ??= resize.maxSide;
    boxHeight ??= resize.maxSide;
  }
  return boxWidth === undefined && boxHeight === undefined
    ? null
    : { width: boxWidth ?? 0, height: boxHeight ?? 0 };
}

function scaledDimensions(metadata: ImageMetadata, resize: NormalizedResizeOptions): ImageMetadata {
  if (metadata.width <= 0 || metadata.height <= 0) {
    throw rastermillError("RASTERMILL_UNDECODABLE", "Invalid image dimensions");
  }
  if (resize.fit === "fill") {
    if (resize.width === undefined || resize.height === undefined) {
      throw rastermillError(
        "RASTERMILL_BAD_OPTION",
        "resize.width and resize.height are required when resize.fit is fill",
      );
    }
    if (!resize.enlarge && (resize.width > metadata.width || resize.height > metadata.height)) {
      return { width: metadata.width, height: metadata.height };
    }
    return { width: resize.width, height: resize.height };
  }

  const box = resizeBox(resize);
  if (!box) {
    return { width: metadata.width, height: metadata.height };
  }
  const boxWidth = box.width === 0 ? undefined : box.width;
  const boxHeight = box.height === 0 ? undefined : box.height;
  const widthScale = boxWidth === undefined ? Number.POSITIVE_INFINITY : boxWidth / metadata.width;
  const heightScale =
    boxHeight === undefined ? Number.POSITIVE_INFINITY : boxHeight / metadata.height;
  const requestedScale =
    resize.fit === "cover" ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale);
  const scale = resize.enlarge ? requestedScale : Math.min(1, requestedScale);
  return {
    width: Math.max(1, Math.round(metadata.width * scale)),
    height: Math.max(1, Math.round(metadata.height * scale)),
  };
}

function finalDimensions(metadata: ImageMetadata, resize: NormalizedResizeOptions): ImageMetadata {
  const scaled = scaledDimensions(metadata, resize);
  if (resize.fit !== "cover") {
    return scaled;
  }
  const box = resizeBox(resize);
  if (!box || box.width <= 0 || box.height <= 0) {
    return scaled;
  }
  const boxAspect = box.width / box.height;
  const scaledAspect = scaled.width / scaled.height;
  if (scaledAspect > boxAspect) {
    return {
      width: Math.max(1, Math.min(scaled.width, Math.round(scaled.height * boxAspect))),
      height: scaled.height,
    };
  }
  return {
    width: scaled.width,
    height: Math.max(1, Math.min(scaled.height, Math.round(scaled.width / boxAspect))),
  };
}

function normalizeDimensionLimits(limits: ImageDimensionLimits): ImageDimensionLimits {
  const normalized = {
    ...(limits.maxWidth === undefined
      ? {}
      : { maxWidth: normalizePositiveInteger(limits.maxWidth, "limits.maxWidth") }),
    ...(limits.maxHeight === undefined
      ? {}
      : { maxHeight: normalizePositiveInteger(limits.maxHeight, "limits.maxHeight") }),
    ...(limits.maxPixels === undefined
      ? {}
      : { maxPixels: normalizePositiveInteger(limits.maxPixels, "limits.maxPixels") }),
  };
  if (
    normalized.maxWidth === undefined &&
    normalized.maxHeight === undefined &&
    normalized.maxPixels === undefined
  ) {
    throw rastermillError(
      "RASTERMILL_BAD_OPTION",
      "encode limits require at least one dimension limit",
    );
  }
  return normalized;
}

function resizeForDimensionLimits(
  metadata: ImageMetadata,
  limits: ImageDimensionLimits,
): ResizeOptions | null {
  const scale = Math.min(
    1,
    limits.maxWidth === undefined ? 1 : limits.maxWidth / metadata.width,
    limits.maxHeight === undefined ? 1 : limits.maxHeight / metadata.height,
    limits.maxPixels === undefined
      ? 1
      : Math.sqrt(limits.maxPixels / (metadata.width * metadata.height)),
  );
  if (!Number.isFinite(scale) || scale >= 1) {
    return null;
  }
  const maxWidth = limits.maxWidth ?? Number.POSITIVE_INFINITY;
  const maxHeight = limits.maxHeight ?? Number.POSITIVE_INFINITY;
  const maxPixels = limits.maxPixels ?? Number.POSITIVE_INFINITY;
  let width = Math.max(1, Math.floor(metadata.width * scale));
  let height = Math.max(1, Math.floor(metadata.height * scale));
  while (width > maxWidth || height > maxHeight || width * height > maxPixels) {
    if (width >= height && width > 1) {
      width -= 1;
    } else if (height > 1) {
      height -= 1;
    } else {
      break;
    }
  }
  return { width, height, fit: "inside", enlarge: false };
}

function autoOrientedMetadata(
  buffer: Buffer,
  metadata: ImageMetadata,
  autoOrient: boolean,
): ImageMetadata {
  if (!autoOrient) {
    return metadata;
  }
  const orientation = readJpegExifOrientation(buffer);
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8
    ? { width: metadata.height, height: metadata.width }
    : metadata;
}

function assertOutputPixelBudget(
  metadata: ImageMetadata,
  resize: NormalizedResizeOptions,
  maxOutputPixels: number,
): void {
  const scaled = scaledDimensions(metadata, resize);
  const target = finalDimensions(metadata, resize);
  for (const candidate of [scaled, target]) {
    if (candidate.width > Math.floor(maxOutputPixels / candidate.height)) {
      throw rastermillError(
        "RASTERMILL_OUTPUT_TOO_LARGE",
        `Image resize target exceeds the ${maxOutputPixels.toLocaleString("en-US")} pixel output limit: ${candidate.width}x${candidate.height}`,
      );
    }
  }
}

function resizePhotonImage(
  photon: PhotonModule,
  image: PhotonImage,
  resize: NormalizedResizeOptions,
): PhotonImage {
  const source = { width: image.get_width(), height: image.get_height() };
  const size = targetSize(image, resize);
  const resized =
    size.width === image.get_width() && size.height === image.get_height()
      ? image
      : photon.resize(image, size.width, size.height, photon.SamplingFilter.Lanczos3);
  if (resized !== image) {
    image.free();
  }
  if (resize.fit !== "cover") {
    return resized;
  }
  const box = resizeBox(resize);
  if (box && box.width > 0 && box.height > 0) {
    const target = finalDimensions(source, resize);
    const cropWidth = Math.min(target.width, resized.get_width());
    const cropHeight = Math.min(target.height, resized.get_height());
    const left = Math.max(0, Math.floor((resized.get_width() - cropWidth) / 2));
    const top = Math.max(0, Math.floor((resized.get_height() - cropHeight) / 2));
    const cropped = photon.crop(resized, left, top, left + cropWidth, top + cropHeight);
    resized.free();
    return cropped;
  }
  return resized;
}

function scanRgbaTransparency(pixels: Uint8Array): boolean {
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if ((pixels[offset] ?? 255) < 255) {
      return true;
    }
  }
  return false;
}

async function readPhotonTransparency(
  buffer: Buffer,
  header: ImageProbe,
  maxInputPixels: number,
): Promise<ImageTransparency> {
  const { image } = await loadOrientedPhotonImage(
    buffer,
    maxInputPixels,
    false,
    "transparency",
  );
  try {
    const hasTransparentPixels = scanRgbaTransparency(image.get_raw_pixels());
    return {
      hasAlphaChannel: header.hasAlpha === true || hasTransparentPixels,
      hasTransparentPixels,
    };
  } finally {
    image.free();
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Encode raw RGBA pixels as PNG. This low-level helper writes no metadata chunks. */
export function encodePngRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  compressionLevel = 6,
): Buffer {
  normalizePositiveInteger(width, "width");
  normalizePositiveInteger(height, "height");
  if (pixels.byteLength !== width * height * 4) {
    throw rastermillError(
      "RASTERMILL_BAD_OPTION",
      "pixels length must equal width * height * 4",
    );
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const source = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (stride + 1);
    raw[rawOffset] = 0;
    source.copy(raw, rawOffset + 1, row * stride, row * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk(
      "IDAT",
      deflateSync(raw, { level: Math.max(0, Math.min(9, Math.round(compressionLevel))) }),
    ),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function backendsForFormat(
  format: EncodedImageFormat,
  execution: ImageExecutionMode,
  options: { webpQuality?: boolean } = {},
): ImageBackend[] {
  const candidates: ImageBackend[] =
    format === "webp"
      ? ["photon", "imagemagick", "graphicsmagick", "ffmpeg"]
      : format === "png"
        ? process.platform === "win32"
          ? ["photon", "windows-native", "imagemagick", "graphicsmagick"]
          : ["photon", "imagemagick", "graphicsmagick"]
        : process.platform === "darwin"
          ? ["photon", "sips", "imagemagick", "graphicsmagick", "ffmpeg"]
          : process.platform === "win32"
            ? ["photon", "windows-native", "imagemagick", "graphicsmagick", "ffmpeg"]
            : ["photon", "imagemagick", "graphicsmagick", "ffmpeg"];
  const usableCandidates =
    format === "webp" && options.webpQuality
      ? candidates.filter((backend) => backend !== "photon")
      : candidates;
  if (execution === "internal") {
    return usableCandidates.filter(isInternalBackend);
  }
  if (execution === "external") {
    return usableCandidates.filter((backend) => !isInternalBackend(backend));
  }
  return usableCandidates;
}

function isBackendUnavailable(error: unknown): boolean {
  if (error instanceof RastermillUnavailableError) {
    return true;
  }
  if (error instanceof RastermillError) {
    return false;
  }
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  const detail = messages.join("\n").toLowerCase();
  return (
    detail.includes("cannot decode") ||
    detail.includes("decode delegate") ||
    detail.includes("decoder not found") ||
    detail.includes("not available") ||
    detail.includes("command not found") ||
    detail.includes("does not convert heic") ||
    detail.includes("enoent") ||
    detail.includes("photon did not expose") ||
    detail.includes("cannot find package '@silvia-odwyer/photon-node'") ||
    detail.includes('cannot find package "@silvia-odwyer/photon-node"') ||
    detail.includes("cannot find module '@silvia-odwyer/photon-node'") ||
    detail.includes('cannot find module "@silvia-odwyer/photon-node"') ||
    detail.includes("no images defined") ||
    detail.includes("support for this compression format has not been built in") ||
    detail.includes("unsupported image format")
  );
}

async function runWithBackends<T>(
  format: EncodedImageFormat,
  options: ResolvedOptions,
  backendOptions: { webpQuality?: boolean },
  fn: (backend: ImageBackend) => Promise<T>,
): Promise<T> {
  const errors: unknown[] = [];
  const backends = backendsForFormat(format, options.execution, backendOptions);
  for (const backend of backends) {
    try {
      return await fn(backend);
    } catch (error) {
      errors.push(error);
      if (!isBackendUnavailable(error)) {
        throw error;
      }
    }
  }
  throw new RastermillUnavailableError(
    "encode",
    `Image processor unavailable for ${format} encoding; tried: ${backends.join(", ")}`,
    errors,
  );
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function pathCandidates(command: string): string[] {
  if (path.isAbsolute(command)) {
    return [command];
  }
  const paths = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? [];
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT?.split(";").filter(Boolean) ?? [".EXE", ".CMD", ".BAT"])
      : [""];
  return paths.flatMap((dir) => extensions.map((ext) => path.join(dir, `${command}${ext}`)));
}

async function resolveExecutableFromPath(command: string): Promise<string | null> {
  for (const candidate of pathCandidates(command)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next PATH candidate.
    }
  }
  return null;
}

async function resolveExecutable(
  command: string,
  options: ResolvedOptions,
): Promise<string | null> {
  return await options.commandResolver(command);
}

async function resolveExternalTool(
  backend: Exclude<ImageBackend, "photon">,
  options: ResolvedOptions,
): Promise<ExternalImageTool | null> {
  if (backend === "sips") {
    const sips = await resolveExecutable("sips", options);
    return sips && process.platform === "darwin"
      ? { backend, flavor: "sips", command: sips }
      : null;
  }
  if (backend === "windows-native") {
    const powershell = await resolveExecutable("powershell", options);
    return powershell && process.platform === "win32"
      ? { backend, flavor: "powershell", command: powershell }
      : null;
  }
  if (backend === "imagemagick") {
    const magick = await resolveExecutable("magick", options);
    if (magick) {
      return { backend, flavor: "magick", command: magick };
    }
    if (process.platform !== "win32") {
      const convert = await resolveExecutable("convert", options);
      if (convert) {
        return { backend, flavor: "convert", command: convert };
      }
    }
    return null;
  }
  if (backend === "graphicsmagick") {
    const gm = await resolveExecutable("gm", options);
    return gm ? { backend, flavor: "gm", command: gm } : null;
  }
  const ffmpeg = await resolveExecutable("ffmpeg", options);
  return ffmpeg ? { backend, flavor: "ffmpeg", command: ffmpeg } : null;
}

function resolveTempPrefix(options: ResolvedOptions): string {
  const prefix =
    typeof options.tempPrefix === "function" ? options.tempPrefix() : options.tempPrefix;
  return validateTempPrefix(prefix);
}

async function withImageTemp<T>(
  options: ResolvedOptions,
  fn: (workspace: {
    path(name: string): string;
    write(name: string, buffer: Buffer): Promise<string>;
    read(name: string): Promise<Buffer>;
  }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(options.tempRootDir, resolveTempPrefix(options)));
  try {
    return await fn({
      path: (name) => path.join(dir, name),
      write: async (name, buffer) => {
        const target = path.join(dir, name);
        await writeFile(target, buffer);
        return target;
      },
      read: async (name) => await readFile(path.join(dir, name)),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runTool(
  command: string,
  args: string[],
  options: ResolvedOptions,
  signal?: AbortSignal,
): Promise<void> {
  await execFileAsync(command, args, {
    timeout: options.timeoutMs,
    maxBuffer: options.maxProcessBufferBytes,
    ...(signal === undefined ? {} : { signal }),
  });
}

function convertToolArgs(
  tool: Extract<ExternalImageTool, { flavor: "magick" | "convert" | "gm" }>,
  args: string[],
): string[] {
  return tool.flavor === "gm" ? ["convert", ...args] : args;
}

function firstImageScene(
  _tool: Extract<ExternalImageTool, { flavor: "magick" | "convert" | "gm" }>,
  input: string,
): string {
  return `${input}[0]`;
}

async function runConvertTool(
  tool: Extract<ExternalImageTool, { flavor: "magick" | "convert" | "gm" }>,
  args: string[],
  options: ResolvedOptions,
  signal?: AbortSignal,
): Promise<void> {
  await runTool(tool.command, convertToolArgs(tool, args), options, signal);
}

function buildConvertResizeGeometry(target: ImageMetadata, fit: ResizeFit): string {
  if (fit === "cover") {
    return `${target.width}x${target.height}^`;
  }
  return `${target.width}x${target.height}!`;
}

function buildFfmpegResizeFilter(target: ImageMetadata, fit: ResizeFit): string {
  if (fit === "cover") {
    return `scale=w=${target.width}:h=${target.height}:force_original_aspect_ratio=increase,crop=w=${target.width}:h=${target.height}`;
  }
  return `scale=w=${target.width}:h=${target.height}`;
}

function convertResizeArgs(native: NativeEncodeOptions): string[] {
  if (native.fit === "cover") {
    return [
      "-resize",
      buildConvertResizeGeometry(native.target, native.fit),
      "-gravity",
      "center",
      "-extent",
      `${native.target.width}x${native.target.height}`,
    ];
  }
  return ["-resize", buildConvertResizeGeometry(native.target, native.fit)];
}

function convertStripArgs(): string[] {
  return ["-strip"];
}

function ffmpegStripArgs(): string[] {
  return ["-map_metadata", "-1"];
}

function sipsOrientationArgs(orientation: number): string[] {
  switch (orientation) {
    case 2:
      return ["-f", "horizontal"];
    case 3:
      return ["-r", "180"];
    case 4:
      return ["-f", "vertical"];
    case 5:
      return ["-r", "270", "-f", "horizontal"];
    case 6:
      return ["-r", "90"];
    case 7:
      return ["-r", "90", "-f", "horizontal"];
    case 8:
      return ["-r", "270"];
    default:
      return [];
  }
}

async function sipsApplyOrientation(
  tool: Extract<ExternalImageTool, { flavor: "sips" }>,
  buffer: Buffer,
  options: ResolvedOptions,
  signal?: AbortSignal,
): Promise<Buffer> {
  const orientation = readJpegExifOrientation(buffer);
  const args = orientation ? sipsOrientationArgs(orientation) : [];
  if (args.length === 0) {
    return buffer;
  }
  return await withImageTemp(options, async (workspace) => {
    const input = await workspace.write("in.jpg", buffer);
    const output = workspace.path("out.jpg");
    await runTool(tool.command, [...args, input, "--out", output], options, signal);
    return await workspace.read("out.jpg");
  });
}

const WINDOWS_NATIVE_RESIZE_SCRIPT = `
param(
  [string]$InputPath,
  [string]$OutputPath,
  [int]$Quality,
  [string]$Format,
  [int]$TargetWidth,
  [int]$TargetHeight,
  [int]$AutoOrient
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile($InputPath)
$bitmap = $null
$graphics = $null
try {
  try {
    if ($AutoOrient -eq 1 -and $source.PropertyIdList -contains 274) {
      $orientation = [BitConverter]::ToUInt16($source.GetPropertyItem(274).Value, 0)
      switch ($orientation) {
        2 { $source.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX) }
        3 { $source.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
        4 { $source.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipX) }
        5 { $source.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipX) }
        6 { $source.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
        7 { $source.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipX) }
        8 { $source.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
      }
      try { $source.RemovePropertyItem(274) } catch {}
    }
  } catch {}
  $width = $TargetWidth
  $height = $TargetHeight
  if ($width -le 0 -or $height -le 0) { throw 'Invalid image dimensions' }
  $pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  if ($Format -eq 'png') {
    $pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  }
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, $pixelFormat)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  if ($Format -eq 'png') {
    $graphics.Clear([System.Drawing.Color]::Transparent)
  } else {
    $graphics.Clear([System.Drawing.Color]::White)
  }
  $graphics.DrawImage($source, 0, 0, $width, $height)
  if ($Format -eq 'png') {
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
      Where-Object { $_.MimeType -eq 'image/jpeg' } |
      Select-Object -First 1
    if ($null -eq $codec) { throw 'JPEG encoder not available' }
    $encoder = [System.Drawing.Imaging.Encoder]::Quality
    $encoderParam = New-Object System.Drawing.Imaging.EncoderParameter($encoder, [int64]$Quality)
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    try {
      $encoderParams.Param[0] = $encoderParam
      $bitmap.Save($OutputPath, $codec, $encoderParams)
    } finally {
      $encoderParam.Dispose()
      $encoderParams.Dispose()
    }
  }
} finally {
  if ($null -ne $graphics) { $graphics.Dispose() }
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  $source.Dispose()
}
`;

async function windowsNativeResize(
  tool: Extract<ExternalImageTool, { flavor: "powershell" }>,
  buffer: Buffer,
  native: NativeEncodeOptions,
  format: "jpeg" | "png",
  options: ResolvedOptions,
): Promise<Buffer> {
  return await withImageTemp(options, async (workspace) => {
    const scriptPath = await workspace.write(
      "resize.ps1",
      Buffer.from(WINDOWS_NATIVE_RESIZE_SCRIPT, "utf8"),
    );
    const input = await workspace.write("in.img", buffer);
    const outputName = format === "png" ? "out.png" : "out.jpg";
    const output = workspace.path(outputName);
    await runTool(
      tool.command,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        input,
        output,
        String(clampInteger(native.quality ?? 90, 1, 100)),
        format,
        String(native.target.width),
        String(native.target.height),
        native.autoOrient === false ? "0" : "1",
      ],
      options,
      native.signal,
    );
    return await workspace.read(outputName);
  });
}

async function externalToJpeg(
  backend: Exclude<ImageBackend, "photon">,
  buffer: Buffer,
  native: NativeEncodeOptions,
  options: ResolvedOptions,
): Promise<Buffer> {
  const tool = await resolveExternalTool(backend, options);
  if (!tool) {
    throw new Error(`Image backend ${backend} is not available`);
  }
  const quality = clampInteger(native.quality ?? DEFAULT_JPEG_QUALITY, 1, 100);
  if (tool.flavor === "sips") {
    return await withImageTemp(options, async (workspace) => {
      const oriented =
        native.autoOrient === false
          ? buffer
          : await sipsApplyOrientation(tool, buffer, options, native.signal);
      const input = await workspace.write("in.img", oriented);
      const output = workspace.path("out.jpg");
      const args =
        native.fit === "cover"
          ? [
              "-z",
              String(native.scaledTarget.height),
              String(native.scaledTarget.width),
              "--cropToHeightWidth",
              String(native.target.height),
              String(native.target.width),
              "-s",
              "format",
              "jpeg",
              "-s",
              "formatOptions",
              String(quality),
              input,
              "--out",
              output,
            ]
          : [
          "-z",
          String(native.target.height),
          String(native.target.width),
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          String(quality),
          input,
          "--out",
          output,
            ];
      await runTool(tool.command, args, options, native.signal);
      return await workspace.read("out.jpg");
    });
  }
  if (tool.flavor === "powershell") {
    return await windowsNativeResize(tool, buffer, native, "jpeg", options);
  }
  return await withImageTemp(options, async (workspace) => {
    const input = await workspace.write("in.img", buffer);
    const output = workspace.path("out.jpg");
    if (tool.flavor === "ffmpeg") {
      const qv = clampInteger(31 - quality * 0.29, 2, 31);
      await runTool(
        tool.command,
        [
          "-y",
          "-i",
          input,
          ...ffmpegStripArgs(),
          "-vf",
          buildFfmpegResizeFilter(native.target, native.fit),
          "-frames:v",
          "1",
          "-q:v",
          String(qv),
          output,
        ],
        options,
        native.signal,
      );
      return await workspace.read("out.jpg");
    }
    const args = [
      firstImageScene(tool, input),
      ...convertResizeArgs(native),
      ...convertStripArgs(),
      "-quality",
      String(quality),
      output,
    ];
    if (native.autoOrient !== false) {
      args.splice(1, 0, "-auto-orient");
    }
    await runConvertTool(tool, args, options, native.signal);
    return await workspace.read("out.jpg");
  });
}

async function externalToPng(
  backend: Exclude<ImageBackend, "photon" | "sips" | "ffmpeg">,
  buffer: Buffer,
  native: NativeEncodeOptions,
  options: ResolvedOptions,
): Promise<Buffer> {
  const tool = await resolveExternalTool(backend, options);
  if (!tool || tool.flavor === "ffmpeg" || tool.flavor === "sips") {
    throw new Error(`Image backend ${backend} is not available for PNG encoding`);
  }
  if (tool.flavor === "powershell") {
    return await windowsNativeResize(tool, buffer, native, "png", options);
  }
  return await withImageTemp(options, async (workspace) => {
    const input = await workspace.write("in.img", buffer);
    const output = workspace.path("out.png");
    const args = [firstImageScene(tool, input), ...convertResizeArgs(native)];
    if (native.autoOrient !== false) {
      args.splice(1, 0, "-auto-orient");
    }
    if (native.compressionLevel !== undefined && tool.flavor !== "gm") {
      args.push("-define", `png:compression-level=${clampInteger(native.compressionLevel, 0, 9)}`);
    }
    args.push(...convertStripArgs());
    args.push(output);
    await runConvertTool(tool, args, options, native.signal);
    return await workspace.read("out.png");
  });
}

async function externalToWebp(
  backend: Exclude<ImageBackend, "photon" | "sips" | "windows-native">,
  buffer: Buffer,
  native: NativeEncodeOptions,
  options: ResolvedOptions,
): Promise<Buffer> {
  const tool = await resolveExternalTool(backend, options);
  if (!tool || tool.flavor === "sips" || tool.flavor === "powershell") {
    throw new Error(`Image backend ${backend} is not available for WebP encoding`);
  }
  const quality = clampInteger(native.quality ?? DEFAULT_JPEG_QUALITY, 1, 100);
  return await withImageTemp(options, async (workspace) => {
    const input = await workspace.write("in.img", buffer);
    const output = workspace.path("out.webp");
    if (tool.flavor === "ffmpeg") {
      await runTool(
        tool.command,
        [
          "-y",
          "-i",
          input,
          ...ffmpegStripArgs(),
          "-vf",
          buildFfmpegResizeFilter(native.target, native.fit),
          "-frames:v",
          "1",
          "-quality",
          String(quality),
          output,
        ],
        options,
        native.signal,
      );
      return await workspace.read("out.webp");
    }
    const args = [
      firstImageScene(tool, input),
      ...convertResizeArgs(native),
      ...convertStripArgs(),
      "-quality",
      String(quality),
      output,
    ];
    if (native.autoOrient !== false) {
      args.splice(1, 0, "-auto-orient");
    }
    await runConvertTool(tool, args, options, native.signal);
    return await workspace.read("out.webp");
  });
}

async function externalConvertToJpeg(
  backend: Exclude<ImageBackend, "photon">,
  buffer: Buffer,
  options: ResolvedOptions,
  jpegOptions: { quality?: number; autoOrient?: boolean; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const tool = await resolveExternalTool(backend, options);
  if (!tool) {
    throw new Error(`Image backend ${backend} is not available`);
  }
  const quality = clampInteger(jpegOptions.quality ?? DEFAULT_JPEG_QUALITY, 1, 100);
  const autoOrient = jpegOptions.autoOrient !== false;
  return await withImageTemp(options, async (workspace) => {
    const oriented =
      tool.flavor === "sips" && autoOrient
        ? await sipsApplyOrientation(tool, buffer, options, jpegOptions.signal)
        : buffer;
    const input = await workspace.write("in.img", oriented);
    const output = workspace.path("out.jpg");
    if (tool.flavor === "sips") {
      await runTool(
        tool.command,
        [
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          String(quality),
          input,
          "--out",
          output,
        ],
        options,
        jpegOptions.signal,
      );
    } else if (tool.flavor === "powershell") {
      throw new Error("Windows native image backend does not convert HEIC to JPEG");
    } else if (tool.flavor === "ffmpeg") {
      await runTool(
        tool.command,
        [
          "-y",
          "-i",
          input,
          ...ffmpegStripArgs(),
          "-frames:v",
          "1",
          "-q:v",
          String(clampInteger(31 - quality * 0.29, 2, 31)),
          output,
        ],
        options,
        jpegOptions.signal,
      );
    } else {
      const args = [firstImageScene(tool, input)];
      if (autoOrient) {
        args.push("-auto-orient");
      }
      args.push(...convertStripArgs(), "-quality", String(quality), output);
      await runConvertTool(tool, args, options, jpegOptions.signal);
    }
    return await workspace.read("out.jpg");
  });
}

function readRequiredEncodedMetadata(data: Buffer, format: EncodedImageFormat): ImageMetadata {
  const metadata = readImageMetadataFromHeader(data);
  if (!metadata) {
    throw rastermillError("RASTERMILL_UNDECODABLE", `Unable to read ${format} output dimensions`);
  }
  return metadata;
}

function stripJpegMetadata(data: Buffer): Buffer {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return data;
  }
  const chunks: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;
  while (offset + 1 < data.length) {
    if (data[offset] !== 0xff) {
      chunks.push(data.subarray(offset));
      break;
    }
    let markerOffset = offset;
    while (markerOffset < data.length && data[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    if (markerOffset >= data.length) {
      break;
    }
    const marker = data[markerOffset] ?? 0;
    const segmentStart = offset;
    const payloadStart = markerOffset + 1;
    if (marker === 0xda) {
      chunks.push(data.subarray(segmentStart));
      break;
    }
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(data.subarray(segmentStart, payloadStart));
      offset = payloadStart;
      continue;
    }
    if (payloadStart + 2 > data.length) {
      chunks.push(data.subarray(segmentStart));
      break;
    }
    const length = data.readUInt16BE(payloadStart);
    const segmentEnd = payloadStart + length;
    if (length < 2 || segmentEnd > data.length) {
      chunks.push(data.subarray(segmentStart));
      break;
    }
    const isMetadataSegment = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadataSegment) {
      chunks.push(data.subarray(segmentStart, segmentEnd));
    }
    offset = segmentEnd;
  }
  return chunks.length === 1 ? data : Buffer.concat(chunks);
}

function normalizeMetadataPolicy(policy: ImageMetadataPolicy | undefined): ImageMetadataPolicy {
  return policy ?? "strip";
}

function mimeTypeForEncodedFormat(format: EncodedImageFormat): EncodedImage["mimeType"] {
  return format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : "image/webp";
}

function encodedImage(
  data: Buffer,
  format: EncodedImageFormat,
  metadataStatus: EncodedImageMetadataStatus,
): EncodedImage {
  const output =
    metadataStatus === "stripped" && format === "jpeg" ? stripJpegMetadata(data) : data;
  const metadata = readRequiredEncodedMetadata(output, format);
  return {
    data: output,
    format,
    mimeType: mimeTypeForEncodedFormat(format),
    width: metadata.width,
    height: metadata.height,
    bytes: output.length,
    metadata: metadataStatus,
    resized: false,
    chosen: { format },
  };
}

function hasExplicitEncodeWork(format: EncodedImageFormat, options: SpecificEncodeOptions): boolean {
  if (format === "jpeg") {
    return options.format === "jpeg" && options.quality !== undefined;
  }
  if (format === "png") {
    return options.format === "png" && options.compressionLevel !== undefined;
  }
  return options.format === "webp" && options.quality !== undefined;
}

function canReuseInputEncoding(
  buffer: Buffer,
  format: EncodedImageFormat,
  header: ImageProbe | null,
  resize: NormalizedResizeOptions,
  options: SpecificEncodeOptions,
): boolean {
  if (normalizeMetadataPolicy(options.metadata) !== "preserve") {
    return false;
  }
  if (!header || header.format !== format || hasExplicitEncodeWork(format, options)) {
    return false;
  }
  const autoOrient = options.autoOrient !== false;
  if (autoOrient && header.orientation !== null && header.orientation !== 1) {
    return false;
  }
  const target = finalDimensions(autoOrientedMetadata(buffer, header, autoOrient), resize);
  return target.width === header.width && target.height === header.height;
}

function encodeAutoOptions(options: AutoPolicyEncodeOptions | undefined): Required<
  Pick<AutoPolicyEncodeOptions, "opaque" | "transparent" | "transparency">
> &
  Omit<AutoPolicyEncodeOptions, "opaque" | "transparent" | "transparency"> {
  return {
    ...options,
    opaque: options?.opaque ?? { format: "jpeg" },
    transparent: options?.transparent ?? { format: "png" },
    transparency: options?.transparency ?? "auto",
  };
}

function encodeWithLimitsOptions(options: LimitEncodeOptions): Required<
  Pick<LimitEncodeOptions, "opaque" | "transparent" | "transparency">
> &
  Omit<LimitEncodeOptions, "opaque" | "transparent" | "transparency"> {
  return {
    ...options,
    opaque: options.opaque ?? { format: "jpeg" },
    transparent: options.transparent ?? { format: "png" },
    transparency: options.transparency ?? "auto",
  };
}

function encodeAutoFormatOptions(
  formatOptions: EncodeFormatPreference,
  options: AutoPolicyEncodeOptions,
): SpecificEncodeOptions {
  return {
    ...formatOptions,
    ...(options.resize === undefined ? {} : { resize: options.resize }),
    ...(options.autoOrient === undefined ? {} : { autoOrient: options.autoOrient }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

function encodeAutoWithinBytesOptions(
  formatOptions: EncodeFormatPreference,
  options: AutoPolicyEncodeOptions & { maxBytes: number },
): BudgetEncodeOptions {
  return {
    ...encodeAutoFormatOptions(formatOptions, options),
    maxBytes: options.maxBytes,
    ...(options.search === undefined ? {} : { search: options.search }),
  };
}

function resizeForSearchMaxSide(
  resize: ResizeOptions | undefined,
  maxSide: number,
): ResizeOptions {
  const nextResize = { ...resize, maxSide };
  if (resize?.width === undefined && resize?.height === undefined) {
    return nextResize;
  }
  const boxMaxSide = Math.max(resize.width ?? 0, resize.height ?? 0);
  if (boxMaxSide <= 0 || boxMaxSide <= maxSide) {
    return nextResize;
  }
  const scale = maxSide / boxMaxSide;
  return {
    ...nextResize,
    ...(resize.width === undefined
      ? {}
      : { width: Math.max(1, Math.floor(resize.width * scale)) }),
    ...(resize.height === undefined
      ? {}
      : { height: Math.max(1, Math.floor(resize.height * scale)) }),
  };
}

async function inspectImageTransparency(
  rastermill: Rastermill,
  buffer: Buffer,
  header: ImageProbe | null,
): Promise<ImageTransparency> {
  if (header?.hasAlpha === false) {
    return { hasAlphaChannel: false, hasTransparentPixels: false };
  }
  try {
    return await rastermill.transparency(buffer);
  } catch (error) {
    if (isRastermillUnavailableError(error) && header?.hasAlpha === true) {
      return { hasAlphaChannel: true, hasTransparentPixels: true };
    }
    throw error;
  }
}

function headerTransparencyHint(header: ImageProbe | null): ImageTransparency {
  return {
    hasAlphaChannel: header?.hasAlpha === true,
    hasTransparentPixels: false,
  };
}

function shouldAutoInspectTransparency(header: ImageProbe | null): boolean {
  if (!header || header.hasAlpha === false) {
    return false;
  }
  return header.format === "png" || header.format === "gif" || header.format === "webp";
}

async function resolveAutoTransparency(
  rastermill: Rastermill,
  mode: EncodeTransparencyMode,
  buffer: Buffer,
  header: ImageProbe | null,
): Promise<ImageTransparency> {
  if (mode === "flatten") {
    return headerTransparencyHint(header);
  }
  if (mode === "auto" && !shouldAutoInspectTransparency(header)) {
    return headerTransparencyHint(header);
  }
  return await inspectImageTransparency(rastermill, buffer, header);
}

function bestChosen(
  out: EncodedImage | BudgetEncodedImage,
  transparency: NonNullable<AutoEncodedImage["chosen"]["transparency"]>,
): AutoEncodedImage {
  const withinBudget =
    "withinBudget" in out ? { withinBudget: out.withinBudget } : {};
  return {
    ...out,
    ...withinBudget,
    chosen: {
      ...out.chosen,
      transparency,
    },
  };
}

function nativeResizeOptions(
  metadata: ImageMetadata,
  resize: NormalizedResizeOptions,
): Pick<NativeEncodeOptions, "target" | "scaledTarget" | "fit"> {
  return {
    target: finalDimensions(metadata, resize),
    scaledTarget: scaledDimensions(metadata, resize),
    fit: resize.fit,
  };
}

function normalizeEncodeOptions(options: EncodeOptions | undefined): EncodeOptions {
  return { ...(options ?? { format: "auto" }) };
}

function isAutoEncodeOptions(options: EncodeOptions): options is AutoEncodeOptions {
  return options.format === undefined || options.format === "auto";
}

function resizeForLimits(
  buffer: Buffer,
  requested: ResizeOptions | undefined,
  limits: ImageDimensionLimits,
  autoOrient: boolean,
  maxInputPixels: number,
): ResizeOptions | undefined {
  const metadata = assertHeaderPixelBudget(buffer, maxInputPixels);
  const orientedMetadata = autoOrientedMetadata(buffer, metadata, autoOrient);
  const normalizedLimits = normalizeDimensionLimits(limits);
  const requestedResize = normalizeResizeOptions(requested, orientedMetadata);
  const requestedDimensions = finalDimensions(orientedMetadata, requestedResize);
  const limitResize = resizeForDimensionLimits(requestedDimensions, normalizedLimits);
  if (limitResize === null) {
    return requested;
  }
  const clampedDimensions = finalDimensions(
    requestedDimensions,
    normalizeResizeOptions(limitResize, requestedDimensions),
  );
  return {
    fit: requested?.fit ?? "inside",
    width: clampedDimensions.width,
    height: clampedDimensions.height,
    enlarge: requested?.enlarge === true,
  };
}

function withResizeStatus(
  out: EncodedImage,
  metadata: ImageMetadata,
  resize: NormalizedResizeOptions,
): EncodedImage {
  const target = finalDimensions(metadata, resize);
  return {
    ...out,
    resized: target.width !== metadata.width || target.height !== metadata.height,
    chosen: { ...out.chosen, format: out.format },
  };
}

function createProcessor(options: ResolvedOptions): Rastermill {
  const rastermill: RastermillInternal = {
    async probe(input) {
      const buffer = toBuffer(input);
      const header = readImageProbeFromHeader(buffer);
      if (header) {
        try {
          validatePixelBudget(header, options.maxInputPixels);
          return header;
        } catch {
          return null;
        }
      }
      return null;
    },

    async transparency(input) {
      const buffer = toBuffer(input);
      const header = readImageProbeFromHeader(buffer);
      if (!header) {
        throw rastermillError(
          "RASTERMILL_UNDECODABLE",
          "Unable to determine image dimensions; refusing to process",
        );
      }
      validatePixelBudget(header, options.maxInputPixels);
      if (header.hasAlpha === false) {
        return {
          hasAlphaChannel: false,
          hasTransparentPixels: false,
        };
      }
      if (!allowsInternalBackend(options)) {
        throw new RastermillUnavailableError(
          "transparency",
          "Internal image processing is disabled for transparency inspection",
        );
      }
      try {
        return await readPhotonTransparency(buffer, header, options.maxInputPixels);
      } catch (error) {
        if (error instanceof RastermillUnavailableError) {
          throw error;
        }
        if (isBackendUnavailable(error)) {
          throw new RastermillUnavailableError(
            "transparency",
            "Image processor unavailable for transparency inspection; tried: photon",
            [error],
          );
        }
        throw error;
      }
    },

    async encode(input, rawOptions) {
      const encodeOptions = normalizeEncodeOptions(rawOptions);
      if (isAutoEncodeOptions(encodeOptions)) {
        if (encodeOptions.limits) {
          const { format: _format, ...optionsWithoutFormat } = encodeOptions;
          return await rastermill.encodeWithLimits(input, {
            ...optionsWithoutFormat,
            limits: encodeOptions.limits,
          });
        }
        return await rastermill.encodeAuto(input, encodeOptions);
      }

      const buffer = toBuffer(input);
      const resize = encodeOptions.limits
        ? resizeForLimits(
            buffer,
            encodeOptions.resize,
            encodeOptions.limits,
            encodeOptions.autoOrient !== false,
            options.maxInputPixels,
          )
        : undefined;
      const { limits: _limits, maxBytes, search, ...specificOptions } = encodeOptions;
      const exactOptions = {
        ...specificOptions,
        ...(resize === undefined ? {} : { resize }),
      } satisfies SpecificEncodeOptions;
      if (maxBytes !== undefined) {
        return await rastermill.encodeWithBudget(buffer, {
          ...exactOptions,
          maxBytes,
          ...(search === undefined ? {} : { search }),
        });
      }
      return await rastermill.encodeDirect(buffer, exactOptions);
    },

    async encodeDirect(input, encodeOptions) {
      const buffer = toBuffer(input);
      const header = readImageProbeFromHeader(buffer);
      const metadata = assertHeaderPixelBudget(buffer, options.maxInputPixels);
      const orientedMetadata = autoOrientedMetadata(
        buffer,
        metadata,
        encodeOptions.autoOrient !== false,
      );
      const resize = normalizeResizeOptions(encodeOptions.resize, orientedMetadata);
      assertOutputPixelBudget(orientedMetadata, resize, options.maxOutputPixels);
      if (canReuseInputEncoding(buffer, encodeOptions.format, header, resize, encodeOptions)) {
        return encodedImage(buffer, encodeOptions.format, "preserved");
      }
      const out = await runWithBackends(
        encodeOptions.format,
        options,
        { webpQuality: encodeOptions.format === "webp" && encodeOptions.quality !== undefined },
        async (backend) => {
        if (backend === "photon") {
          const { photon, image } = await loadOrientedPhotonImage(
            buffer,
            options.maxInputPixels,
            encodeOptions.autoOrient !== false,
          );
          const resized = resizePhotonImage(photon, image, resize);
          try {
            if (encodeOptions.format === "jpeg") {
              return encodedImage(
                Buffer.from(resized.get_bytes_jpeg(encodeOptions.quality ?? DEFAULT_JPEG_QUALITY)),
                "jpeg",
                "stripped",
              );
            }
            if (encodeOptions.format === "webp") {
              return encodedImage(Buffer.from(resized.get_bytes_webp()), "webp", "stripped");
            }
            if (encodeOptions.format === "png") {
              return encodedImage(
                encodePngRgba(
                  resized.get_raw_pixels(),
                  resized.get_width(),
                  resized.get_height(),
                  encodeOptions.compressionLevel ?? DEFAULT_PNG_COMPRESSION_LEVEL,
                ),
                "png",
                "stripped",
              );
            }
          } finally {
            resized.free();
          }
        }
        const nativeBackend = backend as Exclude<ImageBackend, "photon">;
        if (encodeOptions.format === "jpeg") {
          // No resize means a straight decode-and-encode (e.g. HEIC/AVIF to JPEG).
          const jpeg = encodeOptions.resize
            ? await externalToJpeg(
                nativeBackend,
                buffer,
                {
                  ...nativeResizeOptions(orientedMetadata, resize),
                  ...(encodeOptions.quality === undefined
                    ? {}
                    : { quality: encodeOptions.quality }),
                  ...(encodeOptions.autoOrient === undefined
                    ? {}
                    : { autoOrient: encodeOptions.autoOrient }),
                  ...(encodeOptions.signal === undefined ? {} : { signal: encodeOptions.signal }),
                  metadata: normalizeMetadataPolicy(encodeOptions.metadata),
                },
                options,
              )
            : await externalConvertToJpeg(nativeBackend, buffer, options, {
                ...(encodeOptions.quality === undefined ? {} : { quality: encodeOptions.quality }),
                ...(encodeOptions.autoOrient === undefined
                  ? {}
                  : { autoOrient: encodeOptions.autoOrient }),
                ...(encodeOptions.signal === undefined ? {} : { signal: encodeOptions.signal }),
              });
          return encodedImage(jpeg, "jpeg", "stripped");
        }
        if (encodeOptions.format === "webp") {
          if (backend === "imagemagick" || backend === "graphicsmagick" || backend === "ffmpeg") {
            return encodedImage(
              await externalToWebp(
                backend,
                buffer,
                {
                  ...nativeResizeOptions(orientedMetadata, resize),
                  ...(encodeOptions.autoOrient === undefined
                    ? {}
                    : { autoOrient: encodeOptions.autoOrient }),
                  ...(encodeOptions.quality === undefined ? {} : { quality: encodeOptions.quality }),
                  ...(encodeOptions.signal === undefined ? {} : { signal: encodeOptions.signal }),
                  metadata: normalizeMetadataPolicy(encodeOptions.metadata),
                },
                options,
              ),
              "webp",
              "stripped",
            );
          }
          throw new Error(`Image backend ${backend} is not available for WebP encoding`);
        }
        if (
          backend === "windows-native" ||
          backend === "imagemagick" ||
          backend === "graphicsmagick"
        ) {
          return encodedImage(
            await externalToPng(
              backend,
              buffer,
              {
                ...nativeResizeOptions(orientedMetadata, resize),
                ...(encodeOptions.compressionLevel === undefined
                  ? {}
                  : { compressionLevel: encodeOptions.compressionLevel }),
                ...(encodeOptions.autoOrient === undefined
                  ? {}
                  : { autoOrient: encodeOptions.autoOrient }),
                ...(encodeOptions.signal === undefined ? {} : { signal: encodeOptions.signal }),
                metadata: normalizeMetadataPolicy(encodeOptions.metadata),
              },
              options,
            ),
            "png",
            "stripped",
          );
        }
        throw new Error(`Image backend ${backend} is not available for PNG encoding`);
      });
      return withResizeStatus(out, orientedMetadata, resize);
    },

    async encodeWithBudget(input, encodeOptions) {
      const buffer = toBuffer(input);
      const maxBytes = normalizePositiveInteger(encodeOptions.maxBytes, "maxBytes");
      const defaultMaxSides =
        encodeOptions.format === "png" ? [...DEFAULT_PNG_SIDES] : [2048, 1536, 1280, 1024, 800];
      const resizeMaxSide = encodeOptions.resize?.maxSide;
      const maxSides = encodeOptions.search?.maxSide?.length
        ? [...encodeOptions.search.maxSide]
        : resizeMaxSide === undefined
          ? defaultMaxSides
          : [
              normalizePositiveInteger(resizeMaxSide, "resize.maxSide"),
              ...defaultMaxSides.filter((side) => side < resizeMaxSide),
            ].filter((side, index, sides) => sides.indexOf(side) === index);
      const qualities = encodeOptions.search?.quality?.length
        ? [...encodeOptions.search.quality]
        : [85, 75, 65, 55, 45, 35];
      const compressionLevels = encodeOptions.search?.compressionLevel?.length
        ? [...encodeOptions.search.compressionLevel]
        : [...DEFAULT_PNG_COMPRESSION_LEVELS];
      let smallest: BudgetEncodedImage | null = null;
      let firstEncodeError: unknown;
      for (const side of maxSides) {
        for (const quality of encodeOptions.format === "jpeg" || encodeOptions.format === "webp"
          ? qualities
          : [undefined]) {
          for (const compressionLevel of encodeOptions.format === "png"
            ? compressionLevels
            : [undefined]) {
            try {
              const nextResize = resizeForSearchMaxSide(encodeOptions.resize, side);
              const out =
                encodeOptions.format === "jpeg"
                  ? await rastermill.encodeDirect(buffer, {
                      ...encodeOptions,
                      ...(quality === undefined ? {} : { quality }),
                      resize: nextResize,
                    })
                  : encodeOptions.format === "png"
                    ? await rastermill.encodeDirect(buffer, {
                        ...encodeOptions,
                        ...(compressionLevel === undefined ? {} : { compressionLevel }),
                        resize: nextResize,
                      })
                    : await rastermill.encodeDirect(buffer, {
                        ...encodeOptions,
                        ...(quality === undefined ? {} : { quality }),
                        resize: nextResize,
                      });
              const withinBudget = out.bytes <= maxBytes;
              const candidate = {
                ...out,
                withinBudget,
                chosen: {
                  ...out.chosen,
                  maxSide: side,
                  ...(quality === undefined ? {} : { quality }),
                  ...(compressionLevel === undefined ? {} : { compressionLevel }),
                },
              };
              if (!smallest || candidate.bytes < smallest.bytes) {
                smallest = candidate;
              }
              if (withinBudget) {
                return candidate;
              }
            } catch (error) {
              firstEncodeError ??= error;
            }
          }
        }
      }
      if (smallest) {
        return smallest;
      }
      if (firstEncodeError) {
        throw firstEncodeError;
      }
      throw rastermillError("RASTERMILL_UNDECODABLE", "Failed to encode image within byte budget");
    },

    async encodeAuto(input, rawOptions = {}) {
      const buffer = toBuffer(input);
      const encodeOptions = encodeAutoOptions(rawOptions);
      const header = readImageProbeFromHeader(buffer);
      const alpha = await resolveAutoTransparency(
        rastermill,
        encodeOptions.transparency,
        buffer,
        header,
      );
      const useTransparent =
        alpha.hasTransparentPixels && encodeOptions.transparency !== "flatten";
      const firstFormat = useTransparent ? encodeOptions.transparent : encodeOptions.opaque;
      const firstTransparency = useTransparent
        ? "preserved"
        : alpha.hasAlphaChannel
          ? "flattened"
          : "not-present";

      if (encodeOptions.maxBytes === undefined) {
        const out = await rastermill.encodeDirect(
          buffer,
          encodeAutoFormatOptions(firstFormat, encodeOptions),
        );
        return bestChosen(out, firstTransparency);
      }

      const maxBytes = normalizePositiveInteger(encodeOptions.maxBytes, "maxBytes");
      const first = await rastermill.encodeWithBudget(
        buffer,
        encodeAutoWithinBytesOptions(firstFormat, {
          ...encodeOptions,
          maxBytes,
        }),
      );
      if (!useTransparent || first.withinBudget || encodeOptions.transparency === "preserve") {
        return bestChosen(first, firstTransparency);
      }
      const flattened = await rastermill.encodeWithBudget(
        buffer,
        encodeAutoWithinBytesOptions(encodeOptions.opaque, {
          ...encodeOptions,
          maxBytes,
        }),
      );
      return bestChosen(flattened, alpha.hasAlphaChannel ? "flattened" : "not-present");
    },

    async encodeWithLimits(input, rawOptions) {
      const buffer = toBuffer(input);
      const encodeOptions = encodeWithLimitsOptions(rawOptions);
      const header = readImageProbeFromHeader(buffer);
      const limits = normalizeDimensionLimits(encodeOptions.limits);
      const requestedResize = encodeOptions.resize;
      const effectiveResize = resizeForLimits(
        buffer,
        requestedResize,
        limits,
        encodeOptions.autoOrient !== false,
        options.maxInputPixels,
      );
      if (
        !effectiveResize &&
        encodeOptions.maxBytes === undefined &&
        encodeOptions.transparency !== "flatten" &&
        header
      ) {
        if (
          header.format === "jpeg" ||
          header.format === "png" ||
          header.format === "webp"
        ) {
          const out = await rastermill.encodeDirect(buffer, {
            format: header.format,
            ...(encodeOptions.autoOrient === undefined
              ? {}
              : { autoOrient: encodeOptions.autoOrient }),
            metadata: encodeOptions.metadata ?? "preserve",
            ...(encodeOptions.signal === undefined ? {} : { signal: encodeOptions.signal }),
          });
          return {
            ...bestChosen(out, header.hasAlpha === true ? "preserved" : "not-present"),
            resized: false,
          };
        }
      }
      const out = await rastermill.encodeAuto(buffer, {
        opaque: encodeOptions.opaque,
        transparent: encodeOptions.transparent,
        transparency: encodeOptions.transparency,
        ...(effectiveResize === undefined ? {} : { resize: effectiveResize }),
        ...(encodeOptions.maxBytes === undefined ? {} : { maxBytes: encodeOptions.maxBytes }),
        ...(encodeOptions.search === undefined ? {} : { search: encodeOptions.search }),
        ...(encodeOptions.autoOrient === undefined ? {} : { autoOrient: encodeOptions.autoOrient }),
        ...(encodeOptions.metadata === undefined ? {} : { metadata: encodeOptions.metadata }),
        ...(encodeOptions.signal === undefined ? {} : { signal: encodeOptions.signal }),
      });
      return out;
    },
  };
  return rastermill;
}

/** Create a Rastermill processor with explicit execution, safety limits, temp, timeout, and command-resolution settings. */
export function createRastermill(options: RastermillOptions = {}): Rastermill {
  return createProcessor(normalizeOptions(options));
}

let defaultRastermill: Rastermill | null = null;

function getDefaultRastermill(): Rastermill {
  defaultRastermill ??= createRastermill();
  return defaultRastermill;
}

/** Default-instance `probe`. Use `createRastermill` for custom limits or execution boundaries. */
export async function probe(input: ImageInput): Promise<ImageProbe | null> {
  return await getDefaultRastermill().probe(input);
}

/** Default-instance `transparency`. Uses Photon only and does not spawn native tools. */
export async function transparency(input: ImageInput): Promise<ImageTransparency> {
  return await getDefaultRastermill().transparency(input);
}

/** Default-instance `encode`. Metadata is stripped unless `metadata: "preserve"` can return the original bytes unchanged. */
export async function encode(input: ImageInput, options?: EncodeOptions): Promise<EncodedImage> {
  return await getDefaultRastermill().encode(input, options);
}
