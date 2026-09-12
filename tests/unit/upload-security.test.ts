import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES, PROJECT_CONTAINER_MEDIA_TYPE, PRODUCT_VERSION, ProjectSchema } from "@cnc-render/contracts";
import { decodeZip, encodeDeterministicZip, exportProjectContainer, importProjectContainer, importProjectFile, sha256Hex, validateImportedModel, validateProjectUploadMetadata } from "@cnc-render/storage";
import fixture from "../fixtures/m1/valid-project.json";

function stl(count = 1) {
  const bytes = new Uint8Array(84 + count * 50);
  new DataView(bytes.buffer).setUint32(80, count, true);
  return bytes;
}

describe("M12 upload-security", () => {
  it.each([0, -1, NaN, Infinity, DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES + 1])("rejects upload size %s before reading bytes", async (size) => {
    const arrayBuffer = vi.fn();
    await expect(importProjectFile({ name: "a.cncrender", type: PROJECT_CONTAINER_MEDIA_TYPE, size, arrayBuffer } as unknown as File)).rejects.toThrow();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it("validates extension/MIME, including unknown custom-extension browser MIME", () => {
    expect(() => validateProjectUploadMetadata({ name: "a.CNCRENDER", type: "", size: 100 })).not.toThrow();
    expect(() => validateProjectUploadMetadata({ name: "a.stl", type: PROJECT_CONTAINER_MEDIA_TYPE, size: 100 })).toThrow();
    expect(() => validateProjectUploadMetadata({ name: "a.cncrender", type: "text/html", size: 100 })).toThrow();
  });
  it("rejects magic bytes, corrupted ZIP and decompression-bomb declarations", async () => {
    await expect(importProjectContainer(new TextEncoder().encode("<script>alert(1)</script>"))).rejects.toThrow();
    const zip = encodeDeterministicZip([{ path: "manifest.json", bytes: new Uint8Array([1, 2, 3]) }]);
    const corrupt = Uint8Array.from(zip);
    corrupt[43] ^= 1;
    await expect(decodeZip(corrupt)).rejects.toThrow();
    const bomb = Uint8Array.from(zip);
    const view = new DataView(bomb.buffer);
    let directory = 0;
    while (view.getUint32(directory, true) !== 0x02014b50) directory += 1;
    view.setUint32(directory + 24, DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES + 1, true);
    await expect(decodeZip(bomb)).rejects.toMatchObject({ diagnosticCode: "storage.import.uncompressed-limit" });
    view.setUint32(directory + 24, 10_000, true);
    await expect(decodeZip(bomb)).rejects.toMatchObject({ diagnosticCode: "storage.import.compression-ratio-limit" });
  });
  it("rejects unsupported models, declared triangle bombs and non-finite geometry", () => {
    expect(() => validateImportedModel("model.stl", "model/stl", stl())).not.toThrow();
    expect(() => validateImportedModel("model.glb", "model/gltf-binary", stl())).toThrow();
    expect(() => validateImportedModel("model.stl", "text/html", stl())).toThrow();
    expect(() => validateImportedModel("model.stl", "model/stl", new Uint8Array(83))).toThrow();
    const bytes = stl();
    new DataView(bytes.buffer).setUint32(80, 500_001, true);
    expect(() => validateImportedModel("model.stl", "model/stl", bytes)).toThrow();
    new DataView(bytes.buffer).setUint32(80, 2, true);
    expect(() => validateImportedModel("model.stl", "model/stl", bytes)).toThrow();
    new DataView(bytes.buffer).setUint32(80, 1, true);
    new DataView(bytes.buffer).setFloat32(96, NaN, true);
    expect(() => validateImportedModel("model.stl", "model/stl", bytes)).toThrow();
  });
  it("enforces the model guard even when ZIP, manifest and resource hashes are valid", async () => {
    const project = ProjectSchema.parse(structuredClone(fixture));
    const bytes = stl();
    new DataView(bytes.buffer).setUint32(80, 500_001, true);
    const descriptor = { ...project.resources[0], id: "12000000-0000-4000-8000-000000000001", path: "models/stock.stl", role: "stock-model" as const, mediaType: "model/stl", byteLength: bytes.length, sha256: await sha256Hex(bytes) };
    project.resources.push(descriptor);
    const gcodeBytes = new Uint8Array(128);
    project.resources[0].sha256 = await sha256Hex(gcodeBytes);
    const archive = await exportProjectContainer({ project, engineVersion: PRODUCT_VERSION, resources: [
      { ...project.resources[0], bytes: gcodeBytes }, { ...descriptor, bytes },
    ] });
    await expect(importProjectContainer(archive)).rejects.toMatchObject({ diagnosticCode: "storage.import.triangle-limit" });
  });
});
