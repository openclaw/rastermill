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
export type EncodeFormatPreference = {
    format: "jpeg";
    quality?: number;
} | {
    format: "png";
    compressionLevel?: number;
} | {
    format: "webp";
    quality?: number;
};
export type TransparentEncodeFormatPreference = Extract<EncodeFormatPreference, {
    format: "png" | "webp";
}>;
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
export type AutoEncodeOptions = BaseEncodeOptions & EncodePolicyOptions & {
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
/** Rastermill processor instance. Create one when you need custom limits, execution mode, temp roots, or command resolution. */
export type Rastermill = {
    /** Read cheap header facts without full decode. Returns null for unknown, undecodable, or over-budget inputs. */
    probe(input: ImageInput): Promise<ImageProbe | null>;
    /** Decode enough pixels to distinguish alpha-channel presence from real transparent pixels. Never spawns external tools. */
    transparency(input: ImageInput): Promise<ImageTransparency>;
    /** Resize, convert, auto-select format, fit dimension limits, and/or search a byte budget. */
    encode(input: ImageInput, options?: EncodeOptions): Promise<EncodedImage>;
};
type ImageOperation = "encode" | "transparency";
/** Structured Rastermill error codes. These are stable for external callers. */
export type RastermillErrorCode = "RASTERMILL_INPUT_TOO_LARGE" | "RASTERMILL_OUTPUT_TOO_LARGE" | "RASTERMILL_BAD_OPTION" | "RASTERMILL_UNDECODABLE" | "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE";
/** Base error for validation, size-limit, undecodable-input, and backend-unavailable failures. */
export declare class RastermillError extends Error {
    readonly code: RastermillErrorCode;
    constructor(code: RastermillErrorCode, message: string, options?: ErrorOptions);
}
/** Error thrown when the configured execution boundary cannot perform the requested image operation. */
export declare class RastermillUnavailableError extends RastermillError {
    readonly operation: ImageOperation;
    readonly causes: unknown[];
    constructor(operation: ImageOperation, message: string, causes?: unknown[]);
}
/** Type guard for all structured Rastermill errors. */
export declare function isRastermillError(error: unknown): error is RastermillError;
/** Type guard for backend/codecs-unavailable errors. Malformed images and bad options are not "unavailable". */
export declare function isRastermillUnavailableError(error: unknown): error is RastermillUnavailableError;
/** Read dimensions from a recognized image header without decoding pixels. Returns null when dimensions are unknown. */
export declare function readImageMetadataFromHeader(input: ImageInput): ImageMetadata | null;
/** Read format, dimensions, alpha hints, orientation, and byte size from a recognized image header. */
export declare function readImageProbeFromHeader(input: ImageInput): ImageProbe | null;
/** Encode raw RGBA pixels as PNG. This low-level helper writes no metadata chunks. */
export declare function encodePngRgba(pixels: Uint8Array, width: number, height: number, compressionLevel?: number): Buffer;
/** Create a Rastermill processor with explicit execution, safety limits, temp, timeout, and command-resolution settings. */
export declare function createRastermill(options?: RastermillOptions): Rastermill;
/** Default-instance `probe`. Use `createRastermill` for custom limits or execution boundaries. */
export declare function probe(input: ImageInput): Promise<ImageProbe | null>;
/** Default-instance `transparency`. Uses Photon only and does not spawn native tools. */
export declare function transparency(input: ImageInput): Promise<ImageTransparency>;
/** Default-instance `encode`. Metadata is stripped unless `metadata: "preserve"` can return the original bytes unchanged. */
export declare function encode(input: ImageInput, options?: EncodeOptions): Promise<EncodedImage>;
export {};
//# sourceMappingURL=index.d.ts.map