import { parseCsvTable, type CsvTable } from "./csv";
import type { DayOrder } from "./dates";
import { detectMapping, hasKnownTitleColumn, parseTable, type ColumnMapping } from "./generic";
import { isLinearTable, parseLinear } from "./linear";
import { isNotionTable, parseNotion } from "./notion";
import { parseTextList } from "./text";
import { isTodoistTable, parseTodoist } from "./todoist";
import { mergeBatches, emptyBatch, type ImportBatch, type ImportFile, type ImportSource } from "./types";

/** What one file turned out to be. "text" is a plain list; "table" any other CSV. */
export type FileKind = "todoist" | "linear" | "notion" | "table" | "text";

export type AnalyzedFile = {
  file: ImportFile;
  kind: FileKind;
  table: CsvTable | null;
  /** Column mapping for "table" and "notion" files; the wizard may change it. */
  mapping: ColumnMapping | null;
  /** The table has no recognisable title column: worth sending to the AI. */
  unrecognised: boolean;
};

export type ParseSettings = {
  order?: DayOrder;
  today?: Date;
  lang?: string;
};

const TEXT_EXTENSION = /\.(txt|md|markdown|text)$/i;

/** A real .csv may be empty; pasted text needs at least one row under the header to count as a table. */
function looksTabular(table: CsvTable, fileName: string): boolean {
  return table.headers.length >= 2 && (table.rows.length >= 1 || /\.csv$/i.test(fileName));
}

/** Decides what a file is from its headers (and name), never from the source card the user picked. */
export function analyzeFile(file: ImportFile): AnalyzedFile {
  const plainText = TEXT_EXTENSION.test(file.name);
  const table = parseCsvTable(file.text);
  if (!plainText && looksTabular(table, file.name)) {
    if (isTodoistTable(table)) return { file, kind: "todoist", table, mapping: null, unrecognised: false };
    if (isLinearTable(table)) return { file, kind: "linear", table, mapping: null, unrecognised: false };
    if (isNotionTable(table, file.name)) return { file, kind: "notion", table, mapping: detectMapping(table.headers), unrecognised: false };
    const known = hasKnownTitleColumn(table.headers);
    // A pasted or .txt list that merely contains commas is not a table.
    if (known || /\.csv$/i.test(file.name)) return { file, kind: "table", table, mapping: detectMapping(table.headers), unrecognised: !known };
  }
  return { file, kind: "text", table: null, mapping: null, unrecognised: true };
}

export function analyzeFiles(files: readonly ImportFile[]): AnalyzedFile[] {
  return files.filter((file) => file.text.trim() !== "").map(analyzeFile);
}

/** Parses one analyzed file with the deterministic reader for its kind. */
export function parseAnalyzed(item: AnalyzedFile, settings: ParseSettings = {}): ImportBatch {
  const options = { fileName: item.file.name, order: settings.order, today: settings.today };
  switch (item.kind) {
    case "todoist":
      return parseTodoist(item.table as CsvTable, options);
    case "linear":
      return parseLinear(item.table as CsvTable, options);
    case "notion":
      return item.table && item.mapping ? parseTable(item.table, item.mapping, options, "notion") : parseNotion(item.table as CsvTable, options);
    case "table":
      return parseTable(item.table as CsvTable, item.mapping ?? detectMapping((item.table as CsvTable).headers), options, "csv");
    default:
      return parseTextList(item.file.text, { today: settings.today, lang: settings.lang });
  }
}

/** One batch from every file, without AI. */
export function parseAll(items: readonly AnalyzedFile[], settings: ParseSettings = {}): ImportBatch {
  const batches = items.map((item) => parseAnalyzed(item, settings));
  if (batches.length === 0) return emptyBatch("csv");
  const merged = mergeBatches(batches);
  merged.source = dominantSource(items);
  return merged;
}

function dominantSource(items: readonly AnalyzedFile[]): ImportSource {
  const first = items[0];
  if (!first) return "csv";
  if (first.kind === "table") return "csv";
  return first.kind;
}
