# Roadmap / open items

Tracks decisions and follow-ups that are noted but deliberately not acted on yet,
per the build brief's phasing. See the build brief §11 for the authoritative build
order — the checklist below just tracks progress against it.

## Build order progress (build brief §11)

**Now, on personal accounts, no CD data:**

- [x] 1. Analysis pipeline, headless — stage-1 library, structured outputs, inline PDF
- [ ] 2. Eval harness against a synthetic answer key — **deferred at request**, revisit
      once the library/UI are further along
- [x] 3. Scaffold — Next.js, Supabase schema, own auth layer, and GitHub repo
      ([horanshea-ops/CD-Contract-Reviewer-Pro](https://github.com/horanshea-ops/CD-Contract-Reviewer-Pro))
      all done; **Vercel deploy not started**, still local-only (`npm run dev`). Note
      for later: real deploys need Vercel Pro ($20/mo) — Hobby's 60s function limit
      is under our 300s analysis budget.
- [x] 4. Upload and analysis flow — async job via `after()`, status polling, real
      failure states (upload validation, malformed-model-output retry-then-fail)
- [x] 4a. DOCX/DOC upload (added to scope, competitor parity) — converted
      server-side to PDF (text extracted and re-flowed, not a pixel-faithful
      copy — the UI says so) and fed through the same pipeline unchanged. The
      original file is kept in storage either way, so the redline work below
      isn't foreclosed by this approach.
- [x] 5. Findings review UI — document alongside findings, accept/edit/dismiss
- [x] 6. Audit logging — wired into login, upload, analysis complete/failed, every
      finding action
- [x] 7. Standards library admin screen — admin-only (enforced server-side, not just
      hidden nav), provenance visible and editable with a validation stamp
- [x] 8. Requested-revisions memo export (v1, PDF) — only accepted/edited findings
      are included (dismissed and undecided ones are excluded), sorted by severity
- [x] 9. Analysis history — folded into the dashboard's recent-analyses table rather
      than a separate screen; revisit if that's not enough once there's real volume

**When redacted contracts arrive, on CD's Anthropic org:** 10-12 not started — blocked
on the open items below (CD's Anthropic org, confidentiality review, named associates).

**After the accuracy gate:** 13-15 not started, correctly blocked on 10-12.

**Roadmap, not v1:** 16-18 deferred by design, see open items below — except item 18
(tracked-changes DOCX), whose priority just changed; see below.

## Open items

- **Redlined/tracked-changes export (both PDF and DOCX)** — requested explicitly
  (competitor parity). DOCX/DOC upload + analysis (the prerequisite) is now done —
  see build order item 4a below. What's left is the genuinely hard part:
     the build brief explicitly scoped both out of v1 for this reason (§9):
     - *Marked-up PDF*: strikethrough + margin callouts on the original document.
       Needs mapping quoted finding text back to exact page coordinates
       (positional text extraction). Estimated 20-30 hours.
     - *Tracked-changes DOCX*: real Word `w:ins`/`w:del` revision marks. The
       common Python/JS libraries don't produce these natively — it means
       hand-writing OOXML. Also estimated 20-30 hours, and it's a distinct
       effort from the PDF version, not a shared one.
     The build brief's original recommendation was to defer this until associates
     ask for it during the pilot; a named competitor already having it is a
     reasonable reason to move it up, but it should still be scoped as its own
     initiative once DOCX upload exists under it, not folded into the same pass.

- **Standards library breadth vs. depth.** The library now covers 19 clause types:
  the 11 named in the build brief §1, plus 8 more drafted from general industry
  practice (insurance & indemnification, damage/security deposit, exclusivity/outside
  vendor restrictions, termination for convenience vs. cause, assignment/subcontracting,
  brand/ownership change, named-storm/hurricane language, attendee data handling).
  Every entry is `provenance: industry_default` — generic best practice, not CD's
  actual negotiated position. Breadth (which categories exist) is done for v1;
  depth (is each entry actually right, and what does CD concede first / where does
  it walk) still requires a senior associate and cannot be shortcut. Revisit
  alongside library validation (build brief §10.2, §15 item 3) — that is the gate,
  not more categories.

- **Real answer key** (build brief §10.2) — blocking for pilot. Needs a senior
  associate to review 25-30 of CD's past executed contracts cold and record what
  they'd flag, before seeing any tool output.

- **CD's Anthropic organization** (build brief §4.1, §15 item 1) — needs to be
  opened before the first real (even redacted) CD contract is processed.

- **Client confidentiality review** (build brief §15 item 2) — determines whether
  redaction is required before CD's executed contracts can be used to build the
  stage-2/3 library.

- **Named senior associates for library validation and the answer key**
  (build brief §15 item 3) — the resource ask that gates stage 2/3 of the library
  and the real accuracy gate.

- **CD security environment integration** (build brief §4.2, §15 item 4) — SSO/IdP,
  hosting requirements, review process. Deferred by design; not needed for the pilot.

- **Who owns this after handoff** (build brief §15 item 5) — named maintainer,
  time allocated.

- **Platform benefit vs. sold product** (build brief §15 item 6) — CD's call with
  counsel/insurance; affects "not legal advice" framing if it changes.
