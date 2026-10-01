/**
 * A small RFC 4180 CSV reader for exports: quoted fields, doubled quotes,
 * newlines inside fields, a leading BOM, CRLF, and a comma, semicolon or tab
 * delimiter picked from the header line.
 */

export type CsvTable = {
  headers: string[];
  rows: string[][];
  delimiter: string;
};

const DELIMITERS = [",", ";", "\t"] as const;

/** The delimiter that splits the first line into the most cells (outside quotes). */
export function detectDelimiter(text: string): string {
  const firstLine = firstRecord(text);
  let best = ",";
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function firstRecord(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) return text.slice(0, index);
  }
  return text;
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const separator = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    // A blank line is a record with one empty cell: skip it.
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === separator) {
      endField();
    } else if (char === "\n") {
      endRecord();
    } else if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      endRecord();
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (field !== "" || record.length > 0 || fieldStarted) endRecord();
  return records;
}

/** Parses text and treats the first record as the header row. */
export function parseCsvTable(text: string): CsvTable {
  const delimiter = detectDelimiter(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const records = parseCsv(text, delimiter);
  const headers = (records[0] ?? []).map((header) => header.trim());
  return { headers, rows: records.slice(1), delimiter };
}

/** Lower-cased, accent-free header for tolerant matching ("Échéance" -> "echeance"). */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Index of the first header equal to one of the (normalized) names, or -1. */
export function findColumn(headers: readonly string[], names: readonly string[]): number {
  const wanted = names.map(normalizeHeader);
  const normalized = headers.map(normalizeHeader);
  for (const name of wanted) {
    const index = normalized.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

export function cell(row: readonly string[], index: number): string {
  return index >= 0 && index < row.length ? row[index].trim() : "";
}
