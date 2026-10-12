"""Reads a developer sheet (.xlsx) with the standard library only, and prints it as JSON.

    python3 -I read_xlsx.py <file.xlsx>                 the workbook's sheet names, in order
    python3 -I read_xlsx.py <file.xlsx> <sheet>         one sheet's rows: [[row, {col: value}], ...]

<sheet> is a name or a 1-based position. Columns are 1-based, like the spreadsheet's own letters
(A = 1). Values are as stored: a number typed into a cell comes back as text such as "103.0", which
the skill normalises, not this reader. Run it with -I and pass the path as an argument: the sheet is
untrusted input and this file must not import anything from its directory.
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"


def text_of(node):
    return "".join(t.text or "" for t in node.iter(f"{{{M}}}t"))


def column(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(ch) - 64
    return n


def main(argv):
    if len(argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    book = zipfile.ZipFile(argv[1])
    names = book.namelist()
    strings = []
    if "xl/sharedStrings.xml" in names:
        root = ET.fromstring(book.read("xl/sharedStrings.xml"))
        strings = [text_of(si) for si in root.findall(f"{{{M}}}si")]
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    sheets = [
        (s.get("name"), s.get(f"{{{R}}}id"))
        for s in workbook.find(f"{{{M}}}sheets")
    ]
    if len(argv) == 2:
        json.dump([name for name, _ in sheets], sys.stdout, ensure_ascii=False)
        print()
        return 0

    wanted = argv[2]
    if wanted.isdigit():
        name, rel = sheets[int(wanted) - 1]
    else:
        matches = [s for s in sheets if s[0] == wanted]
        if not matches:
            print(f"no sheet named {wanted}", file=sys.stderr)
            return 2
        name, rel = matches[0]
    rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    target = next(r.get("Target") for r in rels.findall(f"{{{P}}}Relationship") if r.get("Id") == rel)
    path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"

    rows = []
    for row in ET.fromstring(book.read(path)).iter(f"{{{M}}}row"):
        values = {}
        for cell in row.findall(f"{{{M}}}c"):
            v = cell.find(f"{{{M}}}v")
            if v is not None:
                value = strings[int(v.text)] if cell.get("t") == "s" else v.text
            else:
                inline = cell.find(f"{{{M}}}is")
                value = text_of(inline) if inline is not None else None
            if value not in (None, ""):
                values[column(cell.get("r"))] = value
        if values:
            rows.append([int(row.get("r")), values])
    json.dump(rows, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
