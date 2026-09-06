// The parser, and the one thing it exists to get right: **a line number that is the line of the
// file.** Slice 2.4.
//
// Every other property here is ordinary CSV. This one is the acceptance bar's — "a malformed row is
// reported with its line number" — and it is the property a records-are-lines parser silently breaks
// the first time an address contains a line break.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsv } from './contract.ts';

describe('register · the parser', () => {
  it('reads the four rules a spreadsheet export uses', () => {
    const records = parseCsv('a,b\n1,"two, with a comma"\n');
    assert.deepEqual(records[0]?.fields, ['a', 'b']);
    assert.deepEqual(records[1]?.fields, ['1', 'two, with a comma']);
  });

  it('reads a doubled quote as one quote', () => {
    const records = parseCsv('name\n"אלפא בע""מ"\n');
    assert.equal(records[1]?.fields[0], 'אלפא בע"מ');
  });

  it('strips a UTF-8 BOM rather than growing a column named by it', () => {
    const records = parseCsv('﻿project_code,city\nA,B\n');
    assert.deepEqual(records[0]?.fields, ['project_code', 'city']);
  });

  it('reads CRLF and a file with no trailing newline', () => {
    const records = parseCsv('a,b\r\n1,2\r\n3,4');
    assert.equal(records.length, 3);
    assert.deepEqual(records[2]?.fields, ['3', '4']);
    assert.deepEqual(
      records.map((r) => r.line),
      [1, 2, 3],
    );
  });

  // The one that matters. A field carrying two newlines inside its quotes advances the file by two
  // lines, and the record after it must still name the line an administrator sees in their
  // spreadsheet. Counting records would have said 3.
  it('counts the lines a quoted field swallowed', () => {
    const records = parseCsv('a\n"one\ntwo\nthree"\nlast\n');
    assert.deepEqual(
      records.map((r) => r.line),
      [1, 2, 5],
    );
    assert.equal(records[1]?.fields[0], 'one\ntwo\nthree');
    assert.equal(records[2]?.fields[0], 'last');
  });

  // A defect of the file and not of a row: everything after the opening quote has been swallowed,
  // so there is no row boundary left to report a line number against.
  it('refuses a file with an unclosed quote', () => {
    assert.throws(
      () => parseCsv('a\n"never closed\n'),
      (error: { code?: string }) => error.code === 'invalid',
    );
  });
});
