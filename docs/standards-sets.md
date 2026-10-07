# Standards sets

CD has pre-negotiated standard contracts with some hotel brands. A review
compares a contract with the standards for its brand (CLAUDE.md deviation 10).

## The model

- A **set** is one complete library of standards. A review reads one set and
  nothing from any other.
- **Independent** is the default set. It holds every standard that existed
  before sets, and it is what a review reads when its brand has no set.
- A set is read only once an admin **switches it on**. New sets start off.
- A **negotiation** carries its set, so every round reads the same one.
- A **review** records the set it read. When that isn't the set its
  negotiation asked for, it also records which was asked for and why, and the
  review screen says so.

| Set | Key | Starts |
|---|---|---|
| Independent | `independent` | On, default, 34 standards |
| Hilton | `hilton` | Off, empty |
| Hyatt | `hyatt` | Off, empty |

## When a review falls back to Independent

| The negotiation asks for a set that | The review reads | It says |
|---|---|---|
| is on and holds a standard | That set | Nothing |
| is switched off | Independent | "Hilton's standards are switched off, so this review used Independent." |
| holds no standard in use | Independent | "Hilton has no standards yet, so this review used Independent." |
| doesn't exist | Independent | "There is no standards set called …" |

## Where it lives

| What | Where |
|---|---|
| Tables and columns | `supabase/migrations/015_standard_sets.sql` |
| Loading a set, and the fallback | `loadStandardsLibrary(setKey)` in `lib/standards/load.ts` |
| Which set a review reads | `lib/analysis-pipeline.ts`, from `negotiation_threads.standards_set` |
| Switching a set on or off, copying from Independent | `app/api/admin/standard-sets/[key]/route.ts` |
| The picker | `app/(app)/admin/standards/standards-set-bar.tsx` |

## Rules worth knowing

- **The fingerprint covers a set's standards, not its name.** Independent's
  fingerprint is what it was before sets, so the evaluation baselines hold.
- **Independent can't be switched off or emptied.** Everything falls back to it.
- **An empty set can't be switched on.**
- **A copy from Independent carries no validation stamp.** Nobody has checked
  those standards against the brand's contract.
- **Apply migration 015 before deploying this code.** A review can't save
  without its columns, and the pipeline stops before the model call if they
  are missing.
- **Add no brand standard until this code is live.** The older loader reads
  every row whatever its set.

## Adding a set

Insert a row in `standard_sets` with a key, a name and the brand names that
mean it. No schema change is needed. There is no screen for this yet.

## Choosing the set at upload

When an associate picks a file, `POST /api/analyses/read` reads the property
name and the brand off it by local rules (`lib/intake/read.ts`). No model is
called and nothing is stored. The form fills the name, shows the wording it
came from, and preselects the brand's set for the associate to confirm.

- The Hotel brand field is always on the form and lists every brand.
- A brand is recorded on the negotiation even while its standards are off.
  The form and the review screen both say the review uses Independent's.
  Later rounds read the brand's standards once an admin switches them on.
- A contract naming two brands, or one only in a comparison, gets Independent.
- Upload refuses a brand that isn't in the list (`confirmedSet` in `lib/standards/usable.ts`).

## Not built yet
- Hilton's and Hyatt's terms, which come from CD's documents.
- Which sub-brands count as Hilton or Hyatt. The seeded brand names are
  "Hilton" and "Hyatt" alone.
