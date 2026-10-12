---
number: 214
title: Flat markings a developer sheet carries — garden flat, sukkah balcony
status: open
labels: [needs-triage]
assignee:
blocked_by: []
parent:
created: 2026-10-12
closed:
---

## Problem

The Beit Shemesh sheet (BSM-MSK) marks flats in free text: `5 גן` in the rooms column (a garden flat,
9 flats) and `סוכה מחדר הורים` (a sukkah balcony off the main bedroom, 6 flats). For a garden flat the
"balcony area" column holds the garden area (up to 224.74 m²). The seed of 12 Oct 2026 put `גן` in
`unit.flat_type` as a stopgap, dropped the sukkah, and wrote the garden area as balcony area.

These are what a tenant asks for and what a lease prices, and Dona Dom shows them.

## What it should do

The spec decides whether these are named facts on the Unit (garden flat with its garden area; sukkah
balcony) or a short controlled list of markings, and keeps `flat_type` for the developer's type code.
The building plan file and `building-sheet-to-plan` take them, the flat tile and page show them, and
BSM-MSK is refilled with `--update` — garden area moved off `balcony_sqm`.
