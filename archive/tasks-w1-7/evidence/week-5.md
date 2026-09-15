# Evidence — Week 5 · Paper becomes truth

**Closed:** 2026-09-13 · **Planned window:** Sun 4 – Thu 8 Oct 2026 · **Started:** 9 Sep 2026.
The planned dates are never rewritten; this gap is the measurement. The project entered week 6
roughly three and a half calendar weeks ahead of its plan.

**Demo kind, as declared: SOFTWARE.** The roadmap said *Real data* and was deliberately not
rewritten. Every document filed this week was a tier-1 authored specimen and the 1,500-unit register
is generated. F3 did not burn, so the declaration was never upgradeable.

## What closed

| Slice | What it left behind |
|---|---|
| 5.0-cut | −176 production lines, −220 test lines, 29 → 27 tables |
| 5.1 / 5.1b / 5.1c | The session. Google holds the credential; `staff_session` holds `token_hash` |
| 5.2 / 5.2b / 5.2c / 5.2d | Every route behind the session, CSRF derived, per-caller cap, ops rail as a phone drawer |
| 5.3 | The remaining ops destinations |
| 5.4 | `uploaded_by`, 15-minute signed reads; `superseded_by` re-asked and still omitted |
| 5.5 | Promotion at scale; the unit change log |
| 5.6 | A tenancy ends because a date passed, actor `system`, no paper |
| 5.7 | Obligation and ObligationType, with `responsible_party` snapshotted |
| 5.8 | The settings screen — A9 |

**At close:** **518** code + **41** hooks + **54** policy tests, **0 failed**. 4 grep guards, 0
violations. 0 policy cases pending. `typecheck` · `lint` · `guards` green. `evals` skips 2 of 3
locally with no key and runs them in CI, which is the shape SPEC.md specifies.

**Migrations:** `0025_tenancy_event_terminated.sql`, `0026_obligation.sql`. 28 tables.

## The sentence that survived

*Every screen shows a state and a count and never a tenant's name.* Kept at 5.2, and again at 5.4,
5.5, 5.6 and 5.8 — five separate slices that were each entitled to lift it and each wrote down that
they had not.

## One defect, found at merge

5.6–5.8 were written but never merged: three slices sat uncommitted on `main` while `todo.md` ticked
them closed. The tree was also red — `src/settings.test.ts` held a second copy of the never-a-phone
guard asserted against a live response, failing 4 runs in 20 on the CSRF token's own hex. Removed
rather than widened; 40/40 after. **The lesson is the ticking, not the flake:** a slice is closed
when it is merged, and `todo.md` was allowed to say otherwise for three of them.

## Carried forward, each with an owner

- **Week 6 is the two core journeys**, not `src/policy/` — director's decision, 13 Sep. See
  [todo.md](todo.md).
- **The downstream renumber and M2's week are the director's** and are written up in
  [roadmap.md](roadmap.md) § "What week 6 displaces". Nothing was silently renumbered.
- Staging `staff:add` for a second operator, and the 5.6 clock-end click on staging.
- `config_settings` / secret-name editor; `DocumentTypeField` on the settings screen.
- `work.ts` and its unearned durability claim — after the console walk-through slice.
- F6 unchanged and still blocking tier 2. F1 to be asked on 18 Sep.
