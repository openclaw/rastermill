import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";
const execFileAsync = promisify(execFile);
const DEFAULT_MAX_INPUT_PIXELS = 25_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PROCESS_BUFFER_BYTES = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_PNG_SIDES = [2048, 1536, 1280, 1024, 800];
const DEFAULT_PNG_COMPRESSION_LEVELS = [6, 7, 8, 9];
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
let photonPromise = null;
export class RastermillUnavailableError extends Error {
    code = "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE";
    operation;
    causes;
    constructor(operation, message, causes = []) {
        super(message, {
            cause: causes.find((cause) => cause instanceof Error),
        });
        this.name = "RastermillUnavailableError";
        this.operation = operation;
        this.causes = causes;
    }
}
export function isRastermillUnavailableError(error) {
    return error instanceof RastermillUnavailableError;
}
function toBuffer(input) {
    if (input instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(input));
    }
    return Buffer.from(input);
}
function normalizePositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value;
}
function normalizeOptions(options) {
    return {
        backend: normalizeBackendPreference(options.backend ?? readBackendPreferenceFromEnv(options.envBackendVariable)),
        maxInputPixels: normalizePositiveInteger(options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS, "maxInputPixels"),
        maxOutputPixels: normalizePositiveInteger(options.maxOutputPixels ?? options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS, "maxOutputPixels"),
        timeoutMs: normalizePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs"),
        maxProcessBufferBytes: normalizePositiveInteger(options.maxProcessBufferBytes ?? DEFAULT_MAX_PROCESS_BUFFER_BYTES, "maxProcessBufferBytes"),
        envBackendVariable: options.envBackendVariable ?? "PRISM_IMAGE_BACKEND",
        commandResolver: options.commandResolver ?? resolveExecutableFromPath,
    };
}
function readBackendPreferenceFromEnv(name) {
    const envName = name ?? "PRISM_IMAGE_BACKEND";
    return process.env[envName] ?? process.env.OPENCLAW_IMAGE_BACKEND;
}
function normalizeBackendPreference(value) {
    const normalized = value?.trim().toLowerCase();
    switch (normalized) {
        case "photon":
        case "sips":
        case "windows-native":
        case "imagemagick":
        case "graphicsmagick":
        case "ffmpeg":
            return normalized;
        case "windows":
        case "powershell":
        case "system.drawing":
        case "systemdrawing":
            return "windows-native";
        case "magick":
        case "convert":
            return "imagemagick";
        case "gm":
            return "graphicsmagick";
        default:
            return "auto";
    }
}
function normalizeMetadata(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        return null;
    }
    return { width, height };
}
function readPngMetadata(buffer) {
    if (buffer.length < 24 ||
        !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        buffer.toString("ascii", 12, 16) !== "IHDR") {
        return null;
    }
    return normalizeMetadata(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}
function readPngAlphaChannel(buffer) {
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
function readGifMetadata(buffer) {
    if (buffer.length < 10) {
        return null;
    }
    const signature = buffer.toString("ascii", 0, 6);
    if (signature !== "GIF87a" && signature !== "GIF89a") {
        return null;
    }
    return normalizeMetadata(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
}
function readWebpMetadata(buffer) {
    if (buffer.length < 30 ||
        buffer.toString("ascii", 0, 4) !== "RIFF" ||
        buffer.toString("ascii", 8, 12) !== "WEBP") {
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
        const bits = buffer.readUInt8(21) |
            (buffer.readUInt8(22) << 8) |
            (buffer.readUInt8(23) << 16) |
            (buffer.readUInt8(24) << 24);
        return normalizeMetadata((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    return null;
}
function readBmpMetadata(buffer) {
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
function readTiffUnsignedInteger(buffer, offset, littleEndian) {
    return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}
function readTiffUnsignedLong(buffer, offset, littleEndian) {
    return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}
function readTiffMetadata(buffer) {
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
    let largest = null;
    const seen = new Set();
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
        let width = null;
        let height = null;
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
            const value = type === 3
                ? readTiffUnsignedInteger(buffer, entryOffset + 8, littleEndian)
                : readTiffUnsignedLong(buffer, entryOffset + 8, littleEndian);
            if (tag === 256) {
                width = value;
            }
            else {
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
function readIsoBmffBoxSize(buffer, offset, end) {
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
function isIsoBmffImage(buffer) {
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
function pickLargerImageMetadata(current, candidate) {
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
function findIsoBmffIspeMetadata(buffer, start, end, depth) {
    if (depth > 8) {
        return null;
    }
    let offset = start;
    let largest = null;
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
            largest = pickLargerImageMetadata(largest, normalizeMetadata(buffer.readUInt32BE(dataStart + 4), buffer.readUInt32BE(dataStart + 8)));
        }
        if (ISO_BMFF_CONTAINER_BOXES.has(type)) {
            const childStart = type === "meta" ? dataStart + 4 : dataStart;
            largest = pickLargerImageMetadata(largest, findIsoBmffIspeMetadata(buffer, childStart, boxEnd, depth + 1));
        }
        offset = boxEnd;
    }
    return largest;
}
function readIsoBmffImageMetadata(buffer) {
    return isIsoBmffImage(buffer) ? findIsoBmffIspeMetadata(buffer, 0, buffer.length, 0) : null;
}
function readJpegMetadata(buffer) {
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
        const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
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
export function readImageMetadataFromHeader(input) {
    const buffer = toBuffer(input);
    return (readPngMetadata(buffer) ??
        readGifMetadata(buffer) ??
        readWebpMetadata(buffer) ??
        readBmpMetadata(buffer) ??
        readTiffMetadata(buffer) ??
        readIsoBmffImageMetadata(buffer) ??
        readJpegMetadata(buffer));
}
function hasPhotonDecodableHeader(buffer) {
    return (readPngMetadata(buffer) !== null ||
        readGifMetadata(buffer) !== null ||
        readWebpMetadata(buffer) !== null ||
        readJpegMetadata(buffer) !== null);
}
function assertPhotonDecodableHeader(buffer) {
    if (!hasPhotonDecodableHeader(buffer)) {
        throw new Error("Photon cannot decode this image format");
    }
}
function validatePixelBudget(meta, maxInputPixels) {
    if (meta.width > Math.floor(maxInputPixels / meta.height)) {
        const pixels = Number.isSafeInteger(meta.width * meta.height)
            ? ` (${meta.width * meta.height} pixels)`
            : "";
        throw new Error(`Image dimensions exceed the ${maxInputPixels.toLocaleString("en-US")} pixel input limit: ${meta.width}x${meta.height}${pixels}`);
    }
    return meta;
}
function assertHeaderPixelBudget(buffer, maxInputPixels) {
    const meta = readImageMetadataFromHeader(buffer);
    if (!meta) {
        throw new Error("Unable to determine image dimensions; refusing to process");
    }
    return validatePixelBudget(meta, maxInputPixels);
}
function readJpegExifOrientation(buffer) {
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
        if (marker === 0xe1 &&
            segmentLength >= 14 &&
            buffer.toString("ascii", offset + 4, offset + 8) === "Exif" &&
            buffer[offset + 8] === 0 &&
            buffer[offset + 9] === 0) {
            return readExifOrientationFromTiff(buffer, offset + 10, offset + 2 + segmentLength);
        }
        offset += 2 + segmentLength;
    }
    return null;
}
function readExifOrientationFromTiff(buffer, tiffStart, tiffEnd) {
    if (tiffStart + 8 > tiffEnd) {
        return null;
    }
    const byteOrder = buffer.toString("ascii", tiffStart, tiffStart + 2);
    const littleEndian = byteOrder === "II";
    if (!littleEndian && byteOrder !== "MM") {
        return null;
    }
    const readU16 = (offset) => littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    const readU32 = (offset) => littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
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
function transformOrientation(rawPixels, width, height, orientation) {
    if (orientation === 1) {
        return { pixels: rawPixels, width, height };
    }
    const swapsAxes = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
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
async function loadPhoton() {
    photonPromise ??= import("@silvia-odwyer/photon-node").then((mod) => {
        if (typeof mod.PhotonImage?.new_from_byteslice !== "function" ||
            typeof mod.resize !== "function" ||
            mod.SamplingFilter?.Lanczos3 === undefined) {
            throw new Error("Photon did not expose the required image processor API");
        }
        return mod;
    });
    return await photonPromise;
}
function applyExifOrientation(photon, image, buffer) {
    const orientation = readJpegExifOrientation(buffer);
    if (!orientation || orientation === 1) {
        return image;
    }
    const transformed = transformOrientation(image.get_raw_pixels(), image.get_width(), image.get_height(), orientation);
    image.free();
    return new photon.PhotonImage(transformed.pixels, transformed.width, transformed.height);
}
function paethPredictor(left, up, upperLeft) {
    const prediction = left + up - upperLeft;
    const distanceLeft = Math.abs(prediction - left);
    const distanceUp = Math.abs(prediction - up);
    const distanceUpperLeft = Math.abs(prediction - upperLeft);
    if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) {
        return left;
    }
    return distanceUp <= distanceUpperLeft ? up : upperLeft;
}
function unfilterPngScanlines(inflated, width, height, bytesPerPixel) {
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
            const upperLeft = row > 0 && column >= bytesPerPixel
                ? (out[targetOffset + column - stride - bytesPerPixel] ?? 0)
                : 0;
            let value;
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
function decodeGrayscaleAlphaPng(buffer) {
    if (buffer.length < 33 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        return null;
    }
    let width = 0;
    let height = 0;
    const idatChunks = [];
    for (let offset = 8; offset + 12 <= buffer.length;) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buffer.length) {
            return null;
        }
        const data = buffer.subarray(dataStart, dataEnd);
        if (type === "IHDR") {
            if (length !== 13 ||
                data[8] !== 8 ||
                data[9] !== 4 ||
                data[10] !== 0 ||
                data[11] !== 0 ||
                data[12] !== 0) {
                return null;
            }
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
        }
        else if (type === "IDAT") {
            idatChunks.push(data);
        }
        else if (type === "IEND") {
            break;
        }
        offset = dataEnd + 4;
    }
    const metadata = normalizeMetadata(width, height);
    if (!metadata || idatChunks.length === 0) {
        return null;
    }
    const expectedInflatedLength = (width * 2 + 1) * height;
    const grayAlpha = unfilterPngScanlines(inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedInflatedLength }), width, height, 2);
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
async function loadOrientedPhotonImage(buffer, maxInputPixels) {
    assertHeaderPixelBudget(buffer, maxInputPixels);
    assertPhotonDecodableHeader(buffer);
    const photon = await loadPhoton();
    let decoded;
    try {
        decoded = photon.PhotonImage.new_from_byteslice(buffer);
    }
    catch (error) {
        const grayscaleAlpha = decodeGrayscaleAlphaPng(buffer);
        if (!grayscaleAlpha) {
            throw error;
        }
        decoded = new photon.PhotonImage(grayscaleAlpha.pixels, grayscaleAlpha.width, grayscaleAlpha.height);
    }
    validatePixelBudget({ width: decoded.get_width(), height: decoded.get_height() }, maxInputPixels);
    return { photon, image: applyExifOrientation(photon, decoded, buffer) };
}
function targetSize(image, maxSide, withoutEnlargement) {
    return targetDimensions({ width: image.get_width(), height: image.get_height() }, maxSide, withoutEnlargement);
}
function targetDimensions(metadata, maxSide, withoutEnlargement) {
    const maxDimension = Math.max(metadata.width, metadata.height);
    if (maxDimension <= 0) {
        throw new Error("Invalid image dimensions");
    }
    const requestedScale = maxSide / maxDimension;
    const scale = withoutEnlargement ? Math.min(1, requestedScale) : requestedScale;
    return {
        width: Math.max(1, Math.round(metadata.width * scale)),
        height: Math.max(1, Math.round(metadata.height * scale)),
    };
}
function assertOutputPixelBudget(metadata, resizeOptions, maxOutputPixels) {
    const target = targetDimensions(metadata, resizeOptions.maxSide, resizeOptions.withoutEnlargement !== false);
    if (target.width > Math.floor(maxOutputPixels / target.height)) {
        throw new Error(`Image resize target exceeds the ${maxOutputPixels.toLocaleString("en-US")} pixel output limit: ${target.width}x${target.height}`);
    }
}
function resizePhotonImage(photon, image, options) {
    const size = targetSize(image, options.maxSide, options.withoutEnlargement !== false);
    if (size.width === image.get_width() && size.height === image.get_height()) {
        return image;
    }
    const resized = photon.resize(image, size.width, size.height, photon.SamplingFilter.Lanczos3);
    image.free();
    return resized;
}
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}
export function encodePngRgba(pixels, width, height, compressionLevel = 6) {
    normalizePositiveInteger(width, "width");
    normalizePositiveInteger(height, "height");
    if (pixels.byteLength !== width * height * 4) {
        throw new Error("pixels length must equal width * height * 4");
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
        pngChunk("IDAT", deflateSync(raw, { level: Math.max(0, Math.min(9, Math.round(compressionLevel))) })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}
function backendsForOperation(operation, preference) {
    if (preference !== "auto") {
        return [preference];
    }
    if (operation === "convertHeicToJpeg") {
        return process.platform === "darwin"
            ? ["sips", "imagemagick", "graphicsmagick", "ffmpeg"]
            : ["imagemagick", "graphicsmagick", "ffmpeg"];
    }
    if (operation === "toPng") {
        return process.platform === "win32"
            ? ["photon", "windows-native", "imagemagick", "graphicsmagick"]
            : ["photon", "imagemagick", "graphicsmagick"];
    }
    return process.platform === "darwin"
        ? ["photon", "sips", "imagemagick", "graphicsmagick", "ffmpeg"]
        : process.platform === "win32"
            ? ["photon", "windows-native", "imagemagick", "graphicsmagick", "ffmpeg"]
            : ["photon", "imagemagick", "graphicsmagick", "ffmpeg"];
}
function isBackendUnavailable(error) {
    const messages = [];
    let current = error;
    while (current instanceof Error) {
        messages.push(current.message);
        current = current.cause;
    }
    const detail = messages.join("\n").toLowerCase();
    return (detail.includes("cannot decode") ||
        detail.includes("decode delegate") ||
        detail.includes("decoder not found") ||
        detail.includes("not available") ||
        detail.includes("command not found") ||
        detail.includes("enoent") ||
        detail.includes("photon did not expose") ||
        detail.includes("cannot find package '@silvia-odwyer/photon-node'") ||
        detail.includes('cannot find package "@silvia-odwyer/photon-node"') ||
        detail.includes("cannot find module '@silvia-odwyer/photon-node'") ||
        detail.includes('cannot find module "@silvia-odwyer/photon-node"') ||
        detail.includes("no images defined") ||
        detail.includes("support for this compression format has not been built in") ||
        detail.includes("unsupported image format"));
}
async function runWithBackends(operation, options, fn) {
    const errors = [];
    const backends = backendsForOperation(operation, options.backend);
    for (const backend of backends) {
        try {
            return await fn(backend);
        }
        catch (error) {
            errors.push(error);
            if (!isBackendUnavailable(error)) {
                throw error;
            }
        }
    }
    throw new RastermillUnavailableError(operation, `Image processor unavailable for ${operation}; tried: ${backends.join(", ")}`, errors);
}
function clampInteger(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
}
function pathCandidates(command) {
    if (path.isAbsolute(command)) {
        return [command];
    }
    const paths = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? [];
    const extensions = process.platform === "win32"
        ? (process.env.PATHEXT?.split(";").filter(Boolean) ?? [".EXE", ".CMD", ".BAT"])
        : [""];
    return paths.flatMap((dir) => extensions.map((ext) => path.join(dir, `${command}${ext}`)));
}
async function resolveExecutableFromPath(command) {
    for (const candidate of pathCandidates(command)) {
        try {
            await access(candidate);
            return candidate;
        }
        catch {
            // Try the next PATH candidate.
        }
    }
    return null;
}
async function resolveExecutable(command, options) {
    return await options.commandResolver(command);
}
async function resolveExternalTool(backend, options) {
    if (backend === "sips") {
        return process.platform === "darwin"
            ? { backend, flavor: "sips", command: "/usr/bin/sips" }
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
async function withImageTemp(fn) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-rastermill-"));
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
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
}
async function runTool(command, args, options) {
    await execFileAsync(command, args, {
        timeout: options.timeoutMs,
        maxBuffer: options.maxProcessBufferBytes,
    });
}
function convertToolArgs(tool, args) {
    return tool.flavor === "gm" ? ["convert", ...args] : args;
}
function firstImageScene(_tool, input) {
    return `${input}[0]`;
}
async function runConvertTool(tool, args, options) {
    await runTool(tool.command, convertToolArgs(tool, args), options);
}
function buildResizeGeometry(maxSide, withoutEnlargement) {
    const side = clampInteger(maxSide, 1, Number.MAX_SAFE_INTEGER);
    return `${side}x${side}${withoutEnlargement === false ? "" : ">"}`;
}
function buildFfmpegResizeFilter(maxSide, withoutEnlargement) {
    const side = clampInteger(maxSide, 1, Number.MAX_SAFE_INTEGER);
    if (withoutEnlargement === false) {
        return `scale=w=${side}:h=${side}:force_original_aspect_ratio=decrease`;
    }
    return `scale=w='min(${side},iw)':h='min(${side},ih)':force_original_aspect_ratio=decrease`;
}
function sipsOrientationArgs(orientation) {
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
async function sipsApplyOrientation(tool, buffer, options) {
    const orientation = readJpegExifOrientation(buffer);
    const args = orientation ? sipsOrientationArgs(orientation) : [];
    if (args.length === 0) {
        return buffer;
    }
    return await withImageTemp(async (workspace) => {
        const input = await workspace.write("in.jpg", buffer);
        const output = workspace.path("out.jpg");
        await runTool(tool.command, [...args, input, "--out", output], options);
        return await workspace.read("out.jpg");
    });
}
const WINDOWS_NATIVE_RESIZE_SCRIPT = `
param(
  [string]$InputPath,
  [string]$OutputPath,
  [int]$MaxSide,
  [int]$Quality,
  [int]$WithoutEnlargement,
  [string]$Format
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile($InputPath)
$bitmap = $null
$graphics = $null
try {
  try {
    if ($source.PropertyIdList -contains 274) {
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
  $maxDim = [Math]::Max($source.Width, $source.Height)
  if ($maxDim -le 0) { throw 'Invalid image dimensions' }
  $scale = $MaxSide / [double]$maxDim
  if ($WithoutEnlargement -eq 1) {
    $scale = [Math]::Min(1.0, $scale)
  }
  $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
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
async function windowsNativeResize(tool, buffer, resizeOptions, format, options) {
    return await withImageTemp(async (workspace) => {
        const scriptPath = await workspace.write("resize.ps1", Buffer.from(WINDOWS_NATIVE_RESIZE_SCRIPT, "utf8"));
        const input = await workspace.write("in.img", buffer);
        const outputName = format === "png" ? "out.png" : "out.jpg";
        const output = workspace.path(outputName);
        await runTool(tool.command, [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            input,
            output,
            String(clampInteger(resizeOptions.maxSide, 1, Number.MAX_SAFE_INTEGER)),
            String(clampInteger("quality" in resizeOptions ? resizeOptions.quality ?? 90 : 90, 1, 100)),
            resizeOptions.withoutEnlargement === false ? "0" : "1",
            format,
        ], options);
        return await workspace.read(outputName);
    });
}
async function externalToJpeg(backend, buffer, resizeOptions, options) {
    const tool = await resolveExternalTool(backend, options);
    if (!tool) {
        throw new Error(`Image backend ${backend} is not available`);
    }
    if (tool.flavor === "sips") {
        return await withImageTemp(async (workspace) => {
            const oriented = await sipsApplyOrientation(tool, buffer, options);
            const input = await workspace.write("in.img", oriented);
            const output = workspace.path("out.jpg");
            const resizeArgs = resizeOptions.withoutEnlargement === false
                ? (() => {
                    const metadata = assertHeaderPixelBudget(buffer, options.maxInputPixels);
                    const target = targetDimensions(metadata, resizeOptions.maxSide, false);
                    return ["-z", String(target.height), String(target.width)];
                })()
                : ["-Z", String(clampInteger(resizeOptions.maxSide, 1, Number.MAX_SAFE_INTEGER))];
            await runTool(tool.command, [
                ...resizeArgs,
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                String(clampInteger(resizeOptions.quality ?? 85, 1, 100)),
                input,
                "--out",
                output,
            ], options);
            return await workspace.read("out.jpg");
        });
    }
    if (tool.flavor === "powershell") {
        return await windowsNativeResize(tool, buffer, resizeOptions, "jpeg", options);
    }
    return await withImageTemp(async (workspace) => {
        const input = await workspace.write("in.img", buffer);
        const output = workspace.path("out.jpg");
        if (tool.flavor === "ffmpeg") {
            const qv = clampInteger(31 - (resizeOptions.quality ?? 85) * 0.29, 2, 31);
            await runTool(tool.command, [
                "-y",
                "-i",
                input,
                "-vf",
                buildFfmpegResizeFilter(resizeOptions.maxSide, resizeOptions.withoutEnlargement),
                "-frames:v",
                "1",
                "-q:v",
                String(qv),
                output,
            ], options);
            return await workspace.read("out.jpg");
        }
        await runConvertTool(tool, [
            firstImageScene(tool, input),
            "-auto-orient",
            "-resize",
            buildResizeGeometry(resizeOptions.maxSide, resizeOptions.withoutEnlargement),
            "-quality",
            String(clampInteger(resizeOptions.quality ?? 85, 1, 100)),
            output,
        ], options);
        return await workspace.read("out.jpg");
    });
}
async function externalToPng(backend, buffer, resizeOptions, options) {
    const tool = await resolveExternalTool(backend, options);
    if (!tool || tool.flavor === "ffmpeg" || tool.flavor === "sips") {
        throw new Error(`Image backend ${backend} is not available for PNG resizing`);
    }
    if (tool.flavor === "powershell") {
        return await windowsNativeResize(tool, buffer, resizeOptions, "png", options);
    }
    return await withImageTemp(async (workspace) => {
        const input = await workspace.write("in.img", buffer);
        const output = workspace.path("out.png");
        const args = [
            firstImageScene(tool, input),
            "-auto-orient",
            "-resize",
            buildResizeGeometry(resizeOptions.maxSide, resizeOptions.withoutEnlargement),
        ];
        if (resizeOptions.compressionLevel !== undefined && tool.flavor !== "gm") {
            args.push("-define", `png:compression-level=${clampInteger(resizeOptions.compressionLevel, 0, 9)}`);
        }
        args.push(output);
        await runConvertTool(tool, args, options);
        return await workspace.read("out.png");
    });
}
async function externalConvertToJpeg(backend, buffer, options) {
    const tool = await resolveExternalTool(backend, options);
    if (!tool) {
        throw new Error(`Image backend ${backend} is not available`);
    }
    return await withImageTemp(async (workspace) => {
        const oriented = tool.flavor === "sips" ? await sipsApplyOrientation(tool, buffer, options) : buffer;
        const input = await workspace.write("in.img", oriented);
        const output = workspace.path("out.jpg");
        if (tool.flavor === "sips") {
            await runTool(tool.command, ["-s", "format", "jpeg", input, "--out", output], options);
        }
        else if (tool.flavor === "powershell") {
            throw new Error("Windows native image backend does not convert HEIC to JPEG");
        }
        else if (tool.flavor === "ffmpeg") {
            await runTool(tool.command, ["-y", "-i", input, "-frames:v", "1", "-q:v", "3", output], options);
        }
        else {
            await runConvertTool(tool, [firstImageScene(tool, input), "-auto-orient", "-quality", "90", output], options);
        }
        return await workspace.read("out.jpg");
    });
}
async function externalHasAlpha(backend, buffer, options) {
    const tool = await resolveExternalTool(backend, options);
    if (!tool || tool.flavor === "sips" || tool.flavor === "ffmpeg" || tool.flavor === "powershell") {
        throw new Error(`Image backend ${backend} is not available for alpha inspection`);
    }
    return await withImageTemp(async (workspace) => {
        const input = await workspace.write("in.img", buffer);
        const identifyCommand = tool.flavor === "convert" ? await resolveExecutable("identify", options) : tool.command;
        if (!identifyCommand) {
            throw new Error("ImageMagick identify is not available for alpha inspection");
        }
        const args = tool.flavor === "gm"
            ? ["identify", "-format", "%A", firstImageScene(tool, input)]
            : tool.flavor === "magick"
                ? ["identify", "-format", "%[channels]", firstImageScene(tool, input)]
                : ["-format", "%[channels]", firstImageScene(tool, input)];
        const { stdout } = await execFileAsync(identifyCommand, args, {
            timeout: options.timeoutMs,
            maxBuffer: options.maxProcessBufferBytes,
        });
        return tool.flavor === "gm"
            ? parseGraphicsMagickAlpha(stdout)
            : parseImageMagickChannelsAlpha(stdout);
    });
}
function parseGraphicsMagickAlpha(value) {
    const normalized = value.trim().toLowerCase();
    return (normalized === "true" ||
        normalized === "on" ||
        normalized === "yes" ||
        normalized === "1" ||
        normalized === "matte");
}
function parseImageMagickChannelsAlpha(value) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "gray" || normalized === "grey" || normalized === "rgb") {
        return false;
    }
    const tokens = normalized.split(/[^a-z0-9]+/u).filter(Boolean);
    return tokens.some((token) => token === "alpha" ||
        token === "a" ||
        token === "rgba" ||
        token === "srgba" ||
        token === "cmyka" ||
        token === "graya" ||
        token === "greya" ||
        token.endsWith("alpha"));
}
function createProcessor(options) {
    const rastermill = {
        async metadata(input) {
            const buffer = toBuffer(input);
            const header = readImageMetadataFromHeader(buffer);
            if (header) {
                try {
                    return validatePixelBudget(header, options.maxInputPixels);
                }
                catch {
                    return null;
                }
            }
            if (options.backend !== "auto" && options.backend !== "photon") {
                return null;
            }
            try {
                const { image } = await loadOrientedPhotonImage(buffer, options.maxInputPixels);
                try {
                    return validatePixelBudget({ width: image.get_width(), height: image.get_height() }, options.maxInputPixels);
                }
                finally {
                    image.free();
                }
            }
            catch {
                return null;
            }
        },
        async normalize(input) {
            const buffer = toBuffer(input);
            assertHeaderPixelBudget(buffer, options.maxInputPixels);
            const orientation = readJpegExifOrientation(buffer);
            if (!orientation || orientation === 1) {
                return buffer;
            }
            return await runWithBackends("normalize", options, async (backend) => {
                if (backend === "photon") {
                    const { image } = await loadOrientedPhotonImage(buffer, options.maxInputPixels);
                    try {
                        return Buffer.from(image.get_bytes_jpeg(90));
                    }
                    finally {
                        image.free();
                    }
                }
                return await externalConvertToJpeg(backend, buffer, options);
            });
        },
        async toJpeg(input, resizeOptions) {
            const buffer = toBuffer(input);
            const metadata = assertHeaderPixelBudget(buffer, options.maxInputPixels);
            assertOutputPixelBudget(metadata, resizeOptions, options.maxOutputPixels);
            return await runWithBackends("toJpeg", options, async (backend) => {
                if (backend === "photon") {
                    const { photon, image } = await loadOrientedPhotonImage(buffer, options.maxInputPixels);
                    const resized = resizePhotonImage(photon, image, resizeOptions);
                    try {
                        return Buffer.from(resized.get_bytes_jpeg(resizeOptions.quality ?? 85));
                    }
                    finally {
                        resized.free();
                    }
                }
                return await externalToJpeg(backend, buffer, resizeOptions, options);
            });
        },
        async toPng(input, resizeOptions) {
            const buffer = toBuffer(input);
            const metadata = assertHeaderPixelBudget(buffer, options.maxInputPixels);
            assertOutputPixelBudget(metadata, resizeOptions, options.maxOutputPixels);
            return await runWithBackends("toPng", options, async (backend) => {
                if (backend === "photon") {
                    const { photon, image } = await loadOrientedPhotonImage(buffer, options.maxInputPixels);
                    const resized = resizePhotonImage(photon, image, resizeOptions);
                    try {
                        return encodePngRgba(resized.get_raw_pixels(), resized.get_width(), resized.get_height(), resizeOptions.compressionLevel);
                    }
                    finally {
                        resized.free();
                    }
                }
                if (backend === "windows-native" ||
                    backend === "imagemagick" ||
                    backend === "graphicsmagick") {
                    return await externalToPng(backend, buffer, resizeOptions, options);
                }
                throw new Error(`Image backend ${backend} is not available for PNG resizing`);
            });
        },
        async optimizePng(input, optimizeOptions) {
            const buffer = toBuffer(input);
            const sides = optimizeOptions.sides?.length
                ? [...optimizeOptions.sides]
                : [...DEFAULT_PNG_SIDES];
            const compressionLevels = optimizeOptions.compressionLevels?.length
                ? [...optimizeOptions.compressionLevels]
                : [...DEFAULT_PNG_COMPRESSION_LEVELS];
            let smallest = null;
            let firstResizeError;
            for (const side of sides) {
                for (const compressionLevel of compressionLevels) {
                    try {
                        const out = await rastermill.toPng(buffer, {
                            maxSide: side,
                            compressionLevel,
                            withoutEnlargement: true,
                        });
                        const candidate = {
                            buffer: out,
                            optimizedSize: out.length,
                            resizeSide: side,
                            compressionLevel,
                        };
                        if (!smallest || candidate.optimizedSize < smallest.optimizedSize) {
                            smallest = candidate;
                        }
                        if (candidate.optimizedSize <= optimizeOptions.maxBytes) {
                            return candidate;
                        }
                    }
                    catch (error) {
                        firstResizeError ??= error;
                    }
                }
            }
            if (smallest) {
                return smallest;
            }
            if (firstResizeError) {
                throw firstResizeError;
            }
            throw new Error("Failed to optimize PNG image");
        },
        async convertHeicToJpeg(input) {
            const buffer = toBuffer(input);
            assertHeaderPixelBudget(buffer, options.maxInputPixels);
            return await runWithBackends("convertHeicToJpeg", options, async (backend) => {
                if (backend === "photon") {
                    throw new Error("Photon cannot decode HEIC/AVIF images");
                }
                return await externalConvertToJpeg(backend, buffer, options);
            });
        },
        async hasAlpha(input) {
            const buffer = toBuffer(input);
            assertHeaderPixelBudget(buffer, options.maxInputPixels);
            const pngAlpha = readPngAlphaChannel(buffer);
            if (pngAlpha !== null) {
                return pngAlpha;
            }
            return await runWithBackends("hasAlpha", options, async (backend) => {
                if (backend === "photon") {
                    const { image } = await loadOrientedPhotonImage(buffer, options.maxInputPixels);
                    try {
                        const pixels = image.get_raw_pixels();
                        for (let offset = 3; offset < pixels.length; offset += 4) {
                            if ((pixels[offset] ?? 255) < 255) {
                                return true;
                            }
                        }
                        return false;
                    }
                    finally {
                        image.free();
                    }
                }
                return await externalHasAlpha(backend, buffer, options);
            });
        },
    };
    return rastermill;
}
export function createRastermill(options = {}) {
    return createProcessor(normalizeOptions(options));
}
const defaultRastermill = createRastermill();
export async function metadata(input) {
    return await defaultRastermill.metadata(input);
}
export async function normalize(input) {
    return await defaultRastermill.normalize(input);
}
export async function toJpeg(input, options) {
    return await defaultRastermill.toJpeg(input, options);
}
export async function toPng(input, options) {
    return await defaultRastermill.toPng(input, options);
}
export async function optimizePng(input, options) {
    return await defaultRastermill.optimizePng(input, options);
}
export async function convertHeicToJpeg(input) {
    return await defaultRastermill.convertHeicToJpeg(input);
}
export async function hasAlpha(input) {
    return await defaultRastermill.hasAlpha(input);
}
//# sourceMappingURL=index.js.map