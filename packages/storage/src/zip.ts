import {
  DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
  MAX_PROJECT_CONTAINER_ENTRIES,
  isSafeResourcePath,
} from "@cnc-render/contracts";

import { cloneBytes, concatBytes, decodeUtf8, encodeUtf8 } from "./bytes";
import { persistenceFailure } from "./errors";

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const STORE_METHOD = 0;
const DEFLATE_METHOD = 8;
const ZIP_VERSION_20 = 20;
const DOS_DATE_1980_01_01 = 0x0021;
const MAX_EOCD_SEARCH_BYTES = 65_557;
const DEFAULT_COMPRESSION_RATIO_LIMIT = 100;

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export interface ZipSourceEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface DecodedZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly crc32: number;
  readonly compressionMethod: 0 | 8;
}

export interface ZipDecodeLimits {
  readonly entryLimit?: number;
  readonly uncompressedByteLimit?: number;
  readonly compressionRatioLimit?: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function writeU16(target: DataView, offset: number, value: number): void {
  target.setUint16(offset, value, true);
}

function writeU32(target: DataView, offset: number, value: number): void {
  target.setUint32(offset, value, true);
}

function assertZip32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw persistenceFailure(
      "storage.export.zip64-required",
      "export",
      `${label} does not fit the supported ZIP32 envelope`,
    );
  }
}

function normalizedPathKey(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

function validateSourceEntries(entries: readonly ZipSourceEntry[]): void {
  if (entries.length === 0 || entries.length > MAX_PROJECT_CONTAINER_ENTRIES + 1) {
    throw persistenceFailure(
      "storage.export.entry-limit",
      "export",
      "container entry count is outside the supported range",
    );
  }
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!isSafeResourcePath(entry.path)) {
      throw persistenceFailure(
        "storage.export.path-unsafe",
        "export",
        `container path is unsafe: ${entry.path}`,
      );
    }
    const key = normalizedPathKey(entry.path);
    if (paths.has(key)) {
      throw persistenceFailure(
        "storage.export.path-duplicate",
        "export",
        `container path collides after normalization: ${entry.path}`,
      );
    }
    paths.add(key);
    assertZip32(entry.bytes.byteLength, "entry byte length");
  }
}

export function encodeDeterministicZip(
  sourceEntries: readonly ZipSourceEntry[],
): Uint8Array {
  validateSourceEntries(sourceEntries);
  const entries = [...sourceEntries].sort((left, right) =>
    left.path.localeCompare(right.path, "en-US"),
  );
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encodeUtf8(entry.path);
    if (name.byteLength > 0xffff) {
      throw persistenceFailure(
        "storage.export.path-too-long",
        "export",
        `container path is too long: ${entry.path}`,
      );
    }
    const checksum = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + name.byteLength);
    const localView = view(localHeader);
    writeU32(localView, 0, LOCAL_FILE_SIGNATURE);
    writeU16(localView, 4, ZIP_VERSION_20);
    writeU16(localView, 6, UTF8_FLAG);
    writeU16(localView, 8, STORE_METHOD);
    writeU16(localView, 10, 0);
    writeU16(localView, 12, DOS_DATE_1980_01_01);
    writeU32(localView, 14, checksum);
    writeU32(localView, 18, entry.bytes.byteLength);
    writeU32(localView, 22, entry.bytes.byteLength);
    writeU16(localView, 26, name.byteLength);
    writeU16(localView, 28, 0);
    localHeader.set(name, 30);

    const centralHeader = new Uint8Array(46 + name.byteLength);
    const centralView = view(centralHeader);
    writeU32(centralView, 0, CENTRAL_FILE_SIGNATURE);
    writeU16(centralView, 4, ZIP_VERSION_20);
    writeU16(centralView, 6, ZIP_VERSION_20);
    writeU16(centralView, 8, UTF8_FLAG);
    writeU16(centralView, 10, STORE_METHOD);
    writeU16(centralView, 12, 0);
    writeU16(centralView, 14, DOS_DATE_1980_01_01);
    writeU32(centralView, 16, checksum);
    writeU32(centralView, 20, entry.bytes.byteLength);
    writeU32(centralView, 24, entry.bytes.byteLength);
    writeU16(centralView, 28, name.byteLength);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, localOffset);
    centralHeader.set(name, 46);

    localChunks.push(localHeader, cloneBytes(entry.bytes));
    centralChunks.push(centralHeader);
    localOffset += localHeader.byteLength + entry.bytes.byteLength;
    assertZip32(localOffset, "local archive length");
  }

  const centralDirectory = concatBytes(centralChunks);
  assertZip32(centralDirectory.byteLength, "central directory length");
  const end = new Uint8Array(22);
  const endView = view(end);
  writeU32(endView, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, entries.length);
  writeU16(endView, 10, entries.length);
  writeU32(endView, 12, centralDirectory.byteLength);
  writeU32(endView, 16, localOffset);
  writeU16(endView, 20, 0);
  return concatBytes([...localChunks, centralDirectory, end]);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const bytesView = view(bytes);
  const firstCandidate = Math.max(0, bytes.byteLength - MAX_EOCD_SEARCH_BYTES);
  for (let offset = bytes.byteLength - 22; offset >= firstCandidate; offset -= 1) {
    if (bytesView.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      const commentLength = bytesView.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === bytes.byteLength) {
        return offset;
      }
    }
  }
  throw persistenceFailure(
    "storage.import.zip-directory-missing",
    "import",
    "ZIP end-of-central-directory record is missing or truncated",
  );
}

function assertRange(
  offset: number,
  byteLength: number,
  limit: number,
  diagnosticCode: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(byteLength) ||
    offset < 0 ||
    byteLength < 0 ||
    offset + byteLength > limit
  ) {
    throw persistenceFailure(
      diagnosticCode,
      "import",
      "ZIP structure points outside the uploaded file",
    );
  }
}

async function inflateRaw(
  compressed: Uint8Array,
  expectedByteLength: number,
): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>;
  try {
    const input = new Blob([Uint8Array.from(compressed)]).stream();
    stream = input.pipeThrough(
      new DecompressionStream("deflate-raw" as CompressionFormat),
    );
  } catch (error) {
    throw persistenceFailure(
      "storage.import.compression-unsupported",
      "import",
      "this browser cannot decode a DEFLATE project container",
      { cause: error },
    );
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const chunk = Uint8Array.from(result.value);
      byteLength += chunk.byteLength;
      if (byteLength > expectedByteLength) {
        await reader.cancel();
        throw persistenceFailure(
          "storage.import.size-mismatch",
          "import",
          "decompressed entry exceeds its declared length",
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ProjectPersistenceError) {
      throw error;
    }
    throw persistenceFailure(
      "storage.import.deflate-invalid",
      "import",
      "DEFLATE entry could not be decoded",
      { cause: error },
    );
  }
  if (byteLength !== expectedByteLength) {
    throw persistenceFailure(
      "storage.import.size-mismatch",
      "import",
      "decompressed entry length does not match its declaration",
    );
  }
  return concatBytes(chunks);
}

interface CentralRecord {
  readonly path: string;
  readonly flags: number;
  readonly compressionMethod: 0 | 8;
  readonly checksum: number;
  readonly compressedByteLength: number;
  readonly uncompressedByteLength: number;
  readonly localHeaderOffset: number;
}

export async function decodeZip(
  bytes: Uint8Array,
  limits: ZipDecodeLimits = {},
): Promise<readonly DecodedZipEntry[]> {
  if (bytes.byteLength < 22 || view(bytes).getUint32(0, true) !== LOCAL_FILE_SIGNATURE) {
    throw persistenceFailure(
      "storage.import.magic-invalid",
      "import",
      "uploaded project does not begin with a ZIP local-file signature",
    );
  }
  const entryLimit = limits.entryLimit ?? MAX_PROJECT_CONTAINER_ENTRIES + 1;
  const uncompressedByteLimit =
    limits.uncompressedByteLimit ?? DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES;
  const ratioLimit =
    limits.compressionRatioLimit ?? DEFAULT_COMPRESSION_RATIO_LIMIT;
  const endOffset = findEndOfCentralDirectory(bytes);
  const bytesView = view(bytes);
  const diskNumber = bytesView.getUint16(endOffset + 4, true);
  const directoryDisk = bytesView.getUint16(endOffset + 6, true);
  const diskEntries = bytesView.getUint16(endOffset + 8, true);
  const totalEntries = bytesView.getUint16(endOffset + 10, true);
  const directoryByteLength = bytesView.getUint32(endOffset + 12, true);
  const directoryOffset = bytesView.getUint32(endOffset + 16, true);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries) {
    throw persistenceFailure(
      "storage.import.multidisk-unsupported",
      "import",
      "multi-disk ZIP project containers are not supported",
    );
  }
  if (totalEntries === 0 || totalEntries > entryLimit) {
    throw persistenceFailure(
      "storage.import.entry-limit",
      "import",
      `ZIP entry count must be between 1 and ${entryLimit}`,
    );
  }
  assertRange(
    directoryOffset,
    directoryByteLength,
    endOffset,
    "storage.import.zip-directory-invalid",
  );
  if (directoryOffset + directoryByteLength !== endOffset) {
    throw persistenceFailure(
      "storage.import.zip-directory-invalid",
      "import",
      "central directory must immediately precede its end record",
    );
  }

  const records: CentralRecord[] = [];
  const paths = new Set<string>();
  let centralOffset = directoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    assertRange(
      centralOffset,
      46,
      endOffset,
      "storage.import.central-entry-truncated",
    );
    if (bytesView.getUint32(centralOffset, true) !== CENTRAL_FILE_SIGNATURE) {
      throw persistenceFailure(
        "storage.import.central-signature-invalid",
        "import",
        "ZIP central-directory entry signature is invalid",
      );
    }
    const flags = bytesView.getUint16(centralOffset + 8, true);
    const method = bytesView.getUint16(centralOffset + 10, true);
    const checksum = bytesView.getUint32(centralOffset + 16, true);
    const compressedByteLength = bytesView.getUint32(centralOffset + 20, true);
    const uncompressedByteLength = bytesView.getUint32(centralOffset + 24, true);
    const nameByteLength = bytesView.getUint16(centralOffset + 28, true);
    const extraByteLength = bytesView.getUint16(centralOffset + 30, true);
    const commentByteLength = bytesView.getUint16(centralOffset + 32, true);
    const startDisk = bytesView.getUint16(centralOffset + 34, true);
    const externalAttributes = bytesView.getUint32(centralOffset + 38, true);
    const localHeaderOffset = bytesView.getUint32(centralOffset + 42, true);
    const recordByteLength =
      46 + nameByteLength + extraByteLength + commentByteLength;
    assertRange(
      centralOffset,
      recordByteLength,
      endOffset,
      "storage.import.central-entry-truncated",
    );
    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw persistenceFailure(
        "storage.import.encryption-unsupported",
        "import",
        "encrypted project containers are not supported",
      );
    }
    if ((flags & ~(UTF8_FLAG | DATA_DESCRIPTOR_FLAG)) !== 0) {
      throw persistenceFailure(
        "storage.import.zip-flags-unsupported",
        "import",
        "ZIP entry uses unsupported general-purpose flags",
      );
    }
    if (method !== STORE_METHOD && method !== DEFLATE_METHOD) {
      throw persistenceFailure(
        "storage.import.compression-unsupported",
        "import",
        `ZIP compression method ${method} is not supported`,
      );
    }
    if (startDisk !== 0) {
      throw persistenceFailure(
        "storage.import.multidisk-unsupported",
        "import",
        "ZIP entry starts on a different disk",
      );
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0xf000) === 0xa000) {
      throw persistenceFailure(
        "storage.import.symlink-unsupported",
        "import",
        "symbolic-link ZIP entries are not supported",
      );
    }
    const nameStart = centralOffset + 46;
    const path = decodeUtf8(
      bytes.subarray(nameStart, nameStart + nameByteLength),
      "import",
    );
    if (!isSafeResourcePath(path)) {
      throw persistenceFailure(
        "storage.import.path-unsafe",
        "import",
        `ZIP entry path is unsafe: ${path}`,
      );
    }
    const pathKey = normalizedPathKey(path);
    if (paths.has(pathKey)) {
      throw persistenceFailure(
        "storage.import.path-duplicate",
        "import",
        `ZIP entry path collides after normalization: ${path}`,
      );
    }
    paths.add(pathKey);
    totalUncompressedBytes += uncompressedByteLength;
    if (totalUncompressedBytes > uncompressedByteLimit) {
      throw persistenceFailure(
        "storage.import.uncompressed-limit",
        "import",
        `ZIP content exceeds the ${uncompressedByteLimit}-byte limit`,
      );
    }
    if (
      uncompressedByteLength > 0 &&
      (compressedByteLength === 0 ||
        uncompressedByteLength / compressedByteLength > ratioLimit)
    ) {
      throw persistenceFailure(
        "storage.import.compression-ratio-limit",
        "import",
        "ZIP entry exceeds the permitted compression ratio",
      );
    }
    records.push({
      path,
      flags,
      compressionMethod: method,
      checksum,
      compressedByteLength,
      uncompressedByteLength,
      localHeaderOffset,
    });
    centralOffset += recordByteLength;
  }
  if (centralOffset !== endOffset) {
    throw persistenceFailure(
      "storage.import.zip-directory-invalid",
      "import",
      "central-directory byte length does not match its entries",
    );
  }

  const decoded: DecodedZipEntry[] = [];
  for (const record of records) {
    assertRange(
      record.localHeaderOffset,
      30,
      directoryOffset,
      "storage.import.local-entry-truncated",
    );
    if (
      bytesView.getUint32(record.localHeaderOffset, true) !==
      LOCAL_FILE_SIGNATURE
    ) {
      throw persistenceFailure(
        "storage.import.local-signature-invalid",
        "import",
        `local ZIP header is invalid for ${record.path}`,
      );
    }
    const localFlags = bytesView.getUint16(record.localHeaderOffset + 6, true);
    const localMethod = bytesView.getUint16(record.localHeaderOffset + 8, true);
    const nameByteLength = bytesView.getUint16(
      record.localHeaderOffset + 26,
      true,
    );
    const extraByteLength = bytesView.getUint16(
      record.localHeaderOffset + 28,
      true,
    );
    const nameStart = record.localHeaderOffset + 30;
    const dataStart = nameStart + nameByteLength + extraByteLength;
    assertRange(
      record.localHeaderOffset,
      30 + nameByteLength + extraByteLength + record.compressedByteLength,
      directoryOffset,
      "storage.import.local-entry-truncated",
    );
    const localPath = decodeUtf8(
      bytes.subarray(nameStart, nameStart + nameByteLength),
      "import",
    );
    if (
      localPath !== record.path ||
      localFlags !== record.flags ||
      localMethod !== record.compressionMethod
    ) {
      throw persistenceFailure(
        "storage.import.header-mismatch",
        "import",
        `local and central ZIP headers disagree for ${record.path}`,
      );
    }
    const compressed = bytes.subarray(
      dataStart,
      dataStart + record.compressedByteLength,
    );
    const entryBytes =
      record.compressionMethod === STORE_METHOD
        ? cloneBytes(compressed)
        : await inflateRaw(compressed, record.uncompressedByteLength);
    if (entryBytes.byteLength !== record.uncompressedByteLength) {
      throw persistenceFailure(
        "storage.import.size-mismatch",
        "import",
        `entry length does not match for ${record.path}`,
      );
    }
    if (crc32(entryBytes) !== record.checksum) {
      throw persistenceFailure(
        "storage.import.crc-mismatch",
        "import",
        `CRC-32 verification failed for ${record.path}`,
      );
    }
    decoded.push({
      path: record.path,
      bytes: entryBytes,
      crc32: record.checksum,
      compressionMethod: record.compressionMethod,
    });
  }
  return decoded;
}

// Kept as a named import to preserve a typed distinction in inflateRaw's catch.
import { ProjectPersistenceError } from "./errors";
