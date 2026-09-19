import { DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES, PROJECT_CONTAINER_MEDIA_TYPE } from "@cnc-render/contracts";
import { persistenceFailure } from "./errors";

export const MAX_IMPORTED_MODEL_TRIANGLES = 500_000;

/** Validate browser File metadata before requesting its (possibly large) bytes. */
export function validateProjectUploadMetadata(file: { name: string; type: string; size: number }): void {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES) {
    throw persistenceFailure("storage.import.upload-limit", "import", "Project upload exceeds the 100 MiB limit or has an invalid size.");
  }
  if (!file.name.toLowerCase().endsWith(".cncrender")) {
    throw persistenceFailure("storage.import.extension-invalid", "import", "Only .cncrender project uploads are supported.");
  }
  // Browsers may provide no MIME for a registered custom extension. Known wrong MIME is never accepted.
  if (file.type !== "" && file.type !== PROJECT_CONTAINER_MEDIA_TYPE) {
    throw persistenceFailure("storage.import.media-type-invalid", "import", "Project upload MIME does not match its extension.");
  }
}

/** Opaque CAD bytes must not bypass resource budgets just because their ZIP hashes match. */
export function validateImportedModel(path: string, mediaType: string, bytes: Uint8Array): void {
  if (!path.toLowerCase().endsWith(".stl") || mediaType !== "model/stl") {
    throw persistenceFailure("storage.import.model-format-unsupported", "import", "Model import currently accepts bounded binary STL only; other CAD formats are not decoded.");
  }
  if (bytes.byteLength < 84) {
    throw persistenceFailure("storage.import.model-corrupt", "import", "Binary STL header is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  if (triangles === 0 || triangles > MAX_IMPORTED_MODEL_TRIANGLES) {
    throw persistenceFailure("storage.import.triangle-limit", "import", "Model triangle count is outside the 1..500000 budget.");
  }
  if (84 + triangles * 50 !== bytes.byteLength) {
    throw persistenceFailure("storage.import.model-corrupt", "import", "Binary STL triangle records do not match the declared size.");
  }
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    for (let component = 0; component < 12; component += 1) {
      if (!Number.isFinite(view.getFloat32(84 + triangle * 50 + component * 4, true))) {
        throw persistenceFailure("storage.import.model-nonfinite", "import", "Binary STL contains a non-finite normal or coordinate.");
      }
    }
  }
}
