import type { CsvTable } from "./csv";
import { normalizeHeader } from "./csv";
import { detectMapping, parseTable } from "./generic";
import type { ParseOptions } from "./todoist";
import type { ImportBatch } from "./types";

/** Notion writes these on every database export; a plain spreadsheet does not. */
const NOTION_COLUMNS = ["created time", "last edited time", "created by", "last edited by"];

/** True for a Notion database export, by file name (`Tasks 1a2b….csv`) or by its system columns. */
export function isNotionTable(table: CsvTable, fileName?: string): boolean {
  if (fileName && /\s[0-9a-f]{32}(?:_all)?\.csv$/i.test(fileName.split(/[\\/]/).pop() ?? "")) return true;
  const headers = table.headers.map(normalizeHeader);
  return NOTION_COLUMNS.some((name) => headers.includes(name));
}

/**
 * Notion database CSV ("Markdown & CSV" export). Column names are matched in
 * five languages, relation cells ("Name (https://www.notion.so/…)") keep only
 * the name, date ranges keep their end, and the database name (without its
 * 32-character id) is the project unless the table has a Project column.
 */
export function parseNotion(table: CsvTable, options: ParseOptions = {}): ImportBatch {
  return parseTable(table, detectMapping(table.headers), options, "notion");
}
