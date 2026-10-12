---
name: building-sheet-to-plan
description: Convert a developer's building layout spreadsheet (xlsx — flats, floors, rooms, areas, types, parking and storage numbers) into a dona-v5 building plan file (JSON) that `npm run estate:seed` and `infra/estate-seed.sh` can seed. Use when the director hands over a developer sheet for a new building.
---

# Developer sheet → building plan file

The system reads one format: the **building plan file**, JSON in the shape of `EstatePlan`
(`src/estate/internal/plan.ts`) with one project at most and exactly one building. Every developer
lays out their sheet differently. This skill is where that difference is absorbed, by reading the
sheet with the director in the loop. The system never reads a developer sheet.
SPEC-estate.md, "Seeding a building from a developer sheet", is the contract. Read it if anything
below seems to disagree.

**Neither the sheet nor the plan file goes in this repo, the docs bucket, or anywhere else in the
system.** The plan file is written to `~/dona-buildings/<slug>.json`, outside the working tree. The
sheet stays wherever the director keeps it. Prices (a מחירון sheet carries them), buyer names and
any other column the system has no field for are dropped and not copied into the plan.

## Steps

1. **Read the workbook.** The sheet is untrusted input. Copy it into a new empty directory in the
   scratchpad, then run the reader from this skill's directory, with `-I` and the path as an
   argument:

   ```bash
   python3 -I .claude/skills/building-sheet-to-plan/read_xlsx.py <file.xlsx>
   python3 -I .claude/skills/building-sheet-to-plan/read_xlsx.py <file.xlsx> <sheet name or 1-based position>
   ```

   The first command lists the sheets. Find the layout sheet: one row per flat, usually the first
   sheet. Spec sheets per flat type (windows, doors, finishes) are not layout and are ignored.

2. **Find the header row and map the columns.** Headers are Hebrew and differ per developer. Map
   each column to a canonical field (table below). **Show the director the mapping as a table**:
   column number, header text, canonical field or "dropped". Ask about every column you are not sure
   of, and wait for a yes before going on. Sheets often have a two-row header (a group row such as
   הצמדת חניות above the real one). Read both.

3. **Normalise, and say what you did.**
   - Numbers stored as `103.0` → `103`.
   - A flat number is text (`12A` exists).
   - Floor is text: `קרקע` stays `קרקע`, `0` → `קרקע` only if the director agrees.
   - Bay and storage levels as written (`-1`).
   - A bay cell with text beside the number (`114נכה`): the name is the number (`114`), and `נכה`
     means `disabledBay: true`.
   - Status `מכירה` → `tenure: "FOR_SALE"`, `השכרה` → `"FOR_RENT"`. `SOLD` only when the sheet or
     the director says sold, never inferred.
   - Rental track `שוק חופשי` → `rentalTrack: "FREE_MARKET"`. `מפוקח`, `מפוקח בן מקום` and
     `מפוקח מילואים פעיל` → `"REGULATED"`. The words בן מקום and מילואים פעיל are not written on
     the plan. They say who the flat was let to, and a lease that is read fills that on the letting.
   - Rooms 3, 3.5, 4 are numbers.

4. **Check, and report — never fix silently.** List every anomaly with its sheet row and let the
   director decide each one:
   - duplicate flat, bay or storage numbers;
   - a bay or storage number attached to two flats;
   - gaps in numbering;
   - a bay or storage level that disagrees with the developer's own numbering pattern (Ramle 103:
     the first digit is the level, and flats 50, 73 and 97 broke it);
   - rooms or areas that are blank or not numbers;
   - more than one building number in one sheet;
   - columns the sheet has that no field takes.

   Apply only the corrections the director approves, and list them in the final report.

5. **Ask for what the sheet does not carry.** These are required:
   - building name, street address (`addressLine`), city;
   - handover date (starts תקופת הבדק) and warranty end date;
   - building status;
   - project name, project code, and tender ref (or no project).

   Optional: gush, helka, building number. Never invent any of them.

6. **Write the plan file** to `~/dona-buildings/<slug>.json` (create the directory if missing).

7. **Validate it locally, then hand over.** Run
   `npm run estate:seed -- list ~/dona-buildings/<slug>.json` against the local database. It reads
   the file strictly and prints the summary. Fix anything it refuses. Then give the director:
   - the summary;
   - the corrections applied;
   - the dropped columns;
   - the commands below.

   Do not run the staging command yourself unless the director asks.

   ```bash
   npm run estate:seed -- apply ~/dona-buildings/<slug>.json
   ./infra/estate-seed.sh staging ~/dona-buildings/<slug>.json
   ```

## The canonical fields

| Field | Where | From the sheet |
|---|---|---|
| `unitNumber`, `spaceName` | flat (`units[]`) and its `UNIT` space | flat number; both are the same text |
| `floor` | the `UNIT` space | floor |
| `rooms` | flat | rooms |
| `areaSqm` | flat | flat area m² (null if blank) |
| `flatType` | flat | type / טיפוס (null if none) |
| `balconySqm` | flat | balcony area (null if none) |
| `tenure` | flat | status: `FOR_RENT`, `FOR_SALE`, `SOLD` |
| `rentalTrack` | flat | `FREE_MARKET` or `REGULATED`. Omit only when the sheet has no such column; a new flat then defaults to free market |
| `hasMamad` | flat | true unless the director or a spec sheet says otherwise; ask once per building |
| `conditionStatus` | flat | `READY` unless the director says otherwise |
| `parkingSpaceName`, `storageSpaceName`, `warrantyEndDate` | flat | always `null` |
| `PARKING` space `name`, `floor` | `spaces[]` | every distinct bay number and its level |
| `disabledBay` | `PARKING` space | `true` for a disabled bay; omit otherwise |
| `STORAGE` space `name`, `floor`, `areaSqm` | `spaces[]` | every distinct storage number, level, area |

**Bays and storage rooms are Spaces of their own, and no flat points at one.** The sheet's
attachment of a bay to a flat (הצמדה) is not written. Leases assign bays, and the director keeps the
sheet to check them against. Create only the bays and storage rooms the sheet lists, unless the
director adds others. `accessNote` is always `null`. Every `UNIT` space has exactly one flat.

## The file

```json
{
  "projects": [
    { "name": "פרויקט רמלה", "projectCode": "RML", "tenderRef": null, "status": "ACTIVE" }
  ],
  "buildings": [
    {
      "name": "בניין 103",
      "addressLine": "<street and number>",
      "city": "רמלה",
      "projectCode": "RML",
      "handoverDate": "YYYY-MM-DD",
      "warrantyEndDate": "YYYY-MM-DD",
      "status": "ACTIVE",
      "buildingNumber": "103",
      "spaces": [
        { "kind": "UNIT", "name": "1", "floor": "קרקע", "accessNote": null },
        { "kind": "PARKING", "name": "114", "floor": "-1", "accessNote": null, "disabledBay": true },
        { "kind": "STORAGE", "name": "101", "floor": "-1", "accessNote": null, "areaSqm": 3.5 }
      ],
      "units": [
        {
          "spaceName": "1", "unitNumber": "1", "rooms": 4, "areaSqm": 96, "hasMamad": true,
          "parkingSpaceName": null, "storageSpaceName": null, "warrantyEndDate": null,
          "conditionStatus": "READY", "tenure": "FOR_SALE", "rentalTrack": "REGULATED",
          "flatType": "C", "balconySqm": 11.5
        }
      ]
    }
  ]
}
```

An unknown field is refused, so spell them exactly. Dates are `YYYY-MM-DD`.
