# Project Memory

**Every agent (Architect, Dev, Review, QA) MUST read this file first**, before
reading the feature plan, skills, or any source code. It records standing
decisions, conventions, gotchas, and corrections that are **not derivable** from
the code, the skills, or `claude.md` — and that **override defaults** when they
apply.

This is the project's shared, durable memory. Skills define *how* to build;
memory records *what we've decided* for this codebase specifically and *why*.

---

## How agents use memory

- **Read first.** Load this file at the start of every task. Treat applicable
  entries as binding instructions that take precedence over generic skill defaults.
- **Write when something durable is learned.** Append an entry when you make or
  discover a decision that future agents must respect — e.g. an architectural
  ruling, a naming convention, a recurring bug class, a deliberate deviation from
  a skill, or an explicit user instruction about how work should be done.
- **Don't record the ephemeral.** No task-specific chatter, no facts already
  captured by the code, git history, skills, `AGENTS.md`, or `claude.md`. If it
  only matters for the current feature, it belongs in that feature's
  `docs/features/<name>/` artifacts, not here.
- **Correct, don't duplicate.** If an entry becomes wrong, update or remove it
  rather than adding a contradicting one.

## How to add an entry

Append to the matching section below using this format:

```
### <short title>
- **Date:** YYYY-MM-DD
- **Type:** decision | convention | gotcha | deviation | user-instruction
- **Context:** what prompted this
- **Rule:** the binding takeaway (what future agents must do)
- **Why:** the reasoning, so it can be revisited later
```

Keep entries short and specific. Cite the relevant skill or file when applicable.

---

## Architectural decisions

_None yet._

## Conventions

_None yet._

## Gotchas & recurring issues

_None yet._

## Deliberate deviations from skills

_None yet._

## Standing user instructions

_None yet._
