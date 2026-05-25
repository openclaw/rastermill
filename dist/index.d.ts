export type ImageInput = Buffer | Uint8Array | ArrayBuffer;
export type ImageMetadata = {
    width: number;
    height: number;
};
export type ImageFormat = "png" | "gif" | "webp" | "bmp" | "tiff" | "heif" | "avif" | "jpeg";
export type EncodedImageFormat = "jpeg" | "png";
export type ImageProbe = ImageMetadata & {
    format: ImageFormat;
    hasAlpha: boolean | null;
    orientation: number | null;
};
export type ImageBackend = "photon" | "sips" | "windows-native" | "imagemagick" | "graphicsmagick" | "ffmpeg";
export type ImageBackendPreference = ImageBackend | "auto";
export type ImageCommandResolver = (command: string) => string | null | Promise<string | null>;
export type RastermillOptions = {
    backend?: ImageBackendPreference;
    limits?: {
        inputPixels?: number;
        outputPixels?: number;
    };
    maxInputPixels?: number;
    maxOutputPixels?: number;
    timeoutMs?: number;
    maxProcessBufferBytes?: number;
    env?: {
        backendVar?: string;
    };
    envBackendVariable?: string;
    commandResolver?: ImageCommandResolver;
};
export type ResizeFit = "inside" | "cover" | "fill";
export type ResizeOptions = {
    fit?: ResizeFit;
    maxSide?: number;
    width?: number;
    height?: number;
    enlarge?: boolean;
};
export type EncodeOptions = {
    format: EncodedImageFormat;
    resize?: ResizeOptions;
    quality?: number;
    png?: {
        compressionLevel?: number;
    };
    autoOrient?: boolean;
};
export type EncodedImage = ImageMetadata & {
    data: Buffer;
    format: EncodedImageFormat;
    bytes: number;
};
export type EncodeSearchOptions = {
    maxSide?: readonly number[];
    quality?: readonly number[];
    compressionLevel?: readonly number[];
};
export type EncodeWithinBytesOptions = EncodeOptions & {
    maxBytes: number;
    search?: EncodeSearchOptions;
};
export type EncodedImageWithinBytes = EncodedImage & {
    chosen: {
        maxSide?: number;
        quality?: number;
        compressionLevel?: number;
    };
};
export type ResizeToJpegOptions = {
    maxSide: number;
    quality?: number;
    withoutEnlargement?: boolean;
};
export type ResizeToPngOptions = {
    maxSide: number;
    compressionLevel?: number;
    withoutEnlargement?: boolean;
};
export type OptimizePngOptions = {
    maxBytes: number;
    sides?: readonly number[];
    compressionLevels?: readonly number[];
};
export type OptimizedPng = {
    buffer: Buffer;
    optimizedSize: number;
    resizeSide: number;
    compressionLevel: number;
};
export type Rastermill = {
    probe(input: ImageInput): Promise<ImageProbe | null>;
    metadata(input: ImageInput): Promise<ImageMetadata | null>;
    normalize(input: ImageInput): Promise<Buffer>;
    encode(input: ImageInput, options: EncodeOptions): Promise<EncodedImage>;
    encodeWithinBytes(input: ImageInput, options: EncodeWithinBytesOptions): Promise<EncodedImageWithinBytes>;
    toJpeg(input: ImageInput, options: ResizeToJpegOptions): Promise<Buffer>;
    toPng(input: ImageInput, options: ResizeToPngOptions): Promise<Buffer>;
    optimizePng(input: ImageInput, options: OptimizePngOptions): Promise<OptimizedPng>;
    convertHeicToJpeg(input: ImageInput): Promise<Buffer>;
    hasAlpha(input: ImageInput): Promise<boolean>;
};
type ImageOperation = "encode" | "toJpeg" | "toPng" | "optimizePng" | "convertHeicToJpeg" | "hasAlpha";
export declare class RastermillUnavailableError extends Error {
    readonly code = "RASTERMILL_IMAGE_PROCESSOR_UNAVAILABLE";
    readonly operation: ImageOperation;
    readonly causes: unknown[];
    constructor(operation: ImageOperation, message: string, causes?: unknown[]);
}
export declare function isRastermillUnavailableError(error: unknown): error is RastermillUnavailableError;
export declare function readImageMetadataFromHeader(input: ImageInput): ImageMetadata | null;
export declare function readImageProbeFromHeader(input: ImageInput): ImageProbe | null;
export declare function encodePngRgba(pixels: Uint8Array, width: number, height: number, compressionLevel?: number): Buffer;
export declare function createRastermill(options?: RastermillOptions): Rastermill;
export declare function probe(input: ImageInput): Promise<ImageProbe | null>;
export declare function metadata(input: ImageInput): Promise<ImageMetadata | null>;
export declare function normalize(input: ImageInput): Promise<Buffer>;
export declare function encode(input: ImageInput, options: EncodeOptions): Promise<EncodedImage>;
export declare function encodeWithinBytes(input: ImageInput, options: EncodeWithinBytesOptions): Promise<EncodedImageWithinBytes>;
export declare function toJpeg(input: ImageInput, options: ResizeToJpegOptions): Promise<Buffer>;
export declare function toPng(input: ImageInput, options: ResizeToPngOptions): Promise<Buffer>;
export declare function optimizePng(input: ImageInput, options: OptimizePngOptions): Promise<OptimizedPng>;
export declare function convertHeicToJpeg(input: ImageInput): Promise<Buffer>;
export declare function hasAlpha(input: ImageInput): Promise<boolean>;
export {};
//# sourceMappingURL=index.d.ts.map