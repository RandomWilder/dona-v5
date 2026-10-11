# ADR-0014 — A Lead is not a Party

- **Date:** 2026-10-11
- **Status:** accepted
- **Context:** [#199](../../issues/0199-party-directory.md)

## The decision

A Lead is not a Party. It lives in the leasing funnel, outside the party directory and outside the isolation join. It becomes a Party when a lease is drafted for it, through `upsertParty` keyed on the ת.ז., so a former tenant is reattached rather than duplicated. Until that draft, the directory does not list it, and a phone that exists only on a lead resolves to no unit.

## Why not one list

Most CRMs keep a lead and a customer in one table and filter. That one list is the thing this refuses. A lead has no tenancy, no role, and no contact the isolation join is allowed to trust. Putting one on `party` would make every directory row, every name search and every inbound number ask whether this is a tenant yet, and a wrong answer is a stranger's message reaching a flat. The cost of the split is a second noun, and a handover written once in the leasing spec, rather than a flag on every party read.

The split is hard to reverse. The directory, the join and the identifier key all assume a party is someone the office already has a reason to know.

## What this does not decide

The leasing funnel, the screens a lead is worked on, and any handover beyond the constraint already in SPEC-parties: conversion is `upsertParty` on the ת.ז.
