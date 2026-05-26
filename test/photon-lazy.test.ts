import { afterEach, describe, expect, it, vi } from "vitest";

describe("Photon loading", () => {
  afterEach(() => {
    vi.doUnmock("@silvia-odwyer/photon-node");
    vi.resetModules();
  });

  it("does not import Photon until an encode path needs it", async () => {
    let photonImported = false;
    vi.doMock("@silvia-odwyer/photon-node", () => {
      photonImported = true;
      throw new Error("Photon should not be imported for header-only work");
    });

    const {
      createRastermill,
      encodePngRgba,
      readImageMetadataFromHeader,
      readImageProbeFromHeader,
    } = await import("../src/index.js");

    expect(photonImported).toBe(false);

    const image = encodePngRgba(new Uint8Array(4 * 4 * 4), 4, 4);
    expect(readImageMetadataFromHeader(image)).toEqual({ width: 4, height: 4 });
    expect(readImageProbeFromHeader(image)).toMatchObject({ format: "png", width: 4, height: 4 });
    await expect(createRastermill().probe(image)).resolves.toMatchObject({
      format: "png",
      width: 4,
      height: 4,
    });

    expect(photonImported).toBe(false);
  });
});
