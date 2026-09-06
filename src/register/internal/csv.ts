// The register file's parser. Slice 2.4.
//
// **Written rather than installed.** AGENTS.md asks for a stated reason before a runtime dependency,
// and this is the whole of what a spreadsheet export produces: quoted fields, embedded commas,
// embedded newlines inside quotes, doubled quotes as an escape, CRLF, and a UTF-8 BOM. Four rules
// and an encoding artefact. A CSV library is the right answer for a product that must accept every
// dialect anyone has ever written; this accepts the one a register is exported in, and says so.
//
// **The line number is the product.** A record's `line` is the physical line of the file it *starts*
// on, so a field carrying two newlines inside its quotes advances the counter by two and the next
// record's number is still the number an administrator sees in their spreadsheet. Counting records
// instead would be an index that drifts from the file the moment a single address contains a line
// break — which is exactly the sort of row that also turns out to be malformed.
import { KernelError } from '../../kernel/errors.ts';

export interface CsvRecord {
  /** 1-based physical line of the file this record starts on. */
  line: number;
  fields: string[];
}

const BOM = '﻿';

/**
 * Splits a register file into records.
 *
 * Throws only for a defect of the *file* rather than of a row — an unterminated quoted field, which
 * has swallowed everything after it and leaves no row boundary to report against. Every other
 * problem is a row's, and a row's problems are reported with a line number rather than raised.
 */
export function parseCsv(text: string): CsvRecord[] {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let started = false;

  const beginField = (): void => {
    if (!started) {
      startLine = line;
      started = true;
    }
  };
  const endRecord = (): void => {
    fields.push(field);
    records.push({ line: startLine, fields });
    fields = [];
    field = '';
    started = false;
  };

  for (let at = 0; at < source.length; at += 1) {
    const char = source[at] as string;
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote; a single one closes it.
        if (source[at + 1] === '"') {
          field += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      beginField();
      quoted = true;
    } else if (char === ',') {
      beginField();
      fields.push(field);
      field = '';
    } else if (char === '\r') {
      // CRLF and a bare CR both end the line; the LF that usually follows is consumed with it.
      beginField();
      if (source[at + 1] === '\n') at += 1;
      endRecord();
      line += 1;
    } else if (char === '\n') {
      beginField();
      endRecord();
      line += 1;
    } else {
      beginField();
      field += char;
    }
  }
  if (quoted) {
    throw new KernelError(
      'invalid',
      'the register file has an unclosed quote',
      {
        fromLine: startLine,
      },
    );
  }
  // A file that does not end in a newline still has a last record; one that does must not gain an
  // empty one.
  if (started) endRecord();
  return records;
}

/** True for a record that is blank — no fields, or every field empty. A spreadsheet emits these. */
export function isBlank(record: CsvRecord): boolean {
  return record.fields.every((value) => value.trim() === '');
}
