import { unzipSync } from "fflate";
import type { ImportFile, ImportWarning } from "./types";

/** Largest single file or archive entry read (exports are far smaller). */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CSV_FILES = 200;
const MAX_ZIP_DEPTH = 2;

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
}

/** UTF-8, falling back to Windows-1252 for CSV saved by a spreadsheet. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Entries worth reading: CSV files, not macOS metadata, not Notion's `_all.csv` duplicates. */
function wanted(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.includes("__macosx/") || baseName(lower).startsWith("._")) return false;
  if (lower.endsWith("_all.csv")) return false;
  return lower.endsWith(".csv") || lower.endsWith(".zip");
}

function readZip(bytes: Uint8Array, depth: number, out: ImportFile[], warnings: ImportWarning[], archive: string): void {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (entry) => entry.originalSize <= MAX_IMPORT_FILE_BYTES && wanted(entry.name) });
  } catch {
    warnings.push({ code: "archive", file: archive });
    return;
  }
  for (const [path, content] of Object.entries(entries).sort(([left], [right]) => left.localeCompare(right))) {
    if (path.toLowerCase().endsWith(".zip")) {
      // Notion nests its export in a second archive.
      if (depth < MAX_ZIP_DEPTH) readZip(content, depth + 1, out, warnings, archive);
      continue;
    }
    if (out.length >= MAX_CSV_FILES) {
      warnings.push({ code: "archiveLimit", count: MAX_CSV_FILES, file: archive });
      return;
    }
    out.push({ name: baseName(path), text: decodeText(content) });
  }
}

/** Turns the bytes of one dropped file into text files (a .zip yields the .csv files inside). */
export function readImportBytes(name: string, bytes: Uint8Array): { files: ImportFile[]; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  if (bytes.length > MAX_IMPORT_FILE_BYTES) return { files: [], warnings: [{ code: "tooLarge", file: name }] };
  if (isZipBytes(bytes)) {
    const files: ImportFile[] = [];
    readZip(bytes, 0, files, warnings, name);
    if (files.length === 0 && warnings.length === 0) warnings.push({ code: "noCsv", file: name });
    return { files, warnings };
  }
  return { files: [{ name: baseName(name), text: decodeText(bytes) }], warnings };
}

/** Reads dropped or picked files (CSV, text or ZIP). */
export async function readImportFiles(files: readonly File[]): Promise<{ files: ImportFile[]; warnings: ImportWarning[] }> {
  const result: ImportFile[] = [];
  const warnings: ImportWarning[] = [];
  for (const file of files) {
    const read = readImportBytes(file.name, new Uint8Array(await file.arrayBuffer()));
    result.push(...read.files);
    warnings.push(...read.warnings);
  }
  return { files: result, warnings };
}
