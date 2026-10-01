import { describe, expect, it } from "vitest";
import { detectDelimiter, findColumn, normalizeHeader, parseCsv, parseCsvTable } from "./csv";

describe("parseCsv", () => {
  it("reads quotes, escaped quotes and newlines inside fields", () => {
    expect(parseCsv('a,"b, c","say ""hi""","line 1\nline 2"\n1,2,3,4\n')).toEqual([
      ["a", "b, c", 'say "hi"', "line 1\nline 2"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("handles CRLF, a BOM, blank lines and a missing final newline", () => {
    expect(parseCsv("﻿name,age\r\nAda,36\r\n\r\nLin,41")).toEqual([
      ["name", "age"],
      ["Ada", "36"],
      ["Lin", "41"],
    ]);
  });

  it("keeps empty cells, including a trailing one", () => {
    expect(parseCsv("a,,c,\n,,,")).toEqual([
      ["a", "", "c", ""],
      ["", "", "", ""],
    ]);
  });

  it("detects semicolon and tab delimiters from the header line", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a;b",c,d')).toBe(",");
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("does not treat a quote in the middle of a field as a quoted field", () => {
    expect(parseCsv('5" pipe,ok')).toEqual([['5" pipe', "ok"]]);
  });
});

describe("tables and headers", () => {
  it("splits headers from rows", () => {
    const table = parseCsvTable("Name , Due\nCall,Monday\n");
    expect(table.headers).toEqual(["Name", "Due"]);
    expect(table.rows).toEqual([["Call", "Monday"]]);
  });

  it("matches headers regardless of case, accents and punctuation", () => {
    expect(normalizeHeader("Échéance")).toBe("echeance");
    expect(normalizeHeader("Due_Date ")).toBe("due date");
    expect(findColumn(["Nom", "Date d'échéance"], ["due", "date d echeance"])).toBe(1);
    expect(findColumn(["a"], ["b"])).toBe(-1);
  });
});
