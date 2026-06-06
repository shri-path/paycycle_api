# Contributing & Commit Strategy

This document defines how work flows into the PayCycle API repository: branching,
commit conventions, and the automated quality gate that runs on every commit.

---

## 1. Branching Model — Feature branch per User Story

`main` is always releasable. All work happens on short-lived branches off `main`.

| Branch type | Pattern                          | Example                        |
| ----------- | -------------------------------- | ------------------------------ |
| Feature     | `feat/us-<id>-<short-slug>`      | `feat/us-101-vendor-onboarding`|
| Bugfix      | `fix/<short-slug>`               | `fix/login-token-expiry`       |
| Chore/infra | `chore/<short-slug>`             | `chore/husky-pre-commit`       |
| Refactor    | `refactor/<short-slug>`          | `refactor/query-builder`       |

Workflow:

1. **Before starting a User Story**, move it to 🟡 *In Progress* in
   `../project_documents/vendor_app/PROGRESS_TRACKER.md` and create a branch off `main`.
2. Commit in **small, atomic increments** — each commit should build and lint clean.
3. Open a **Pull Request to `main`** when the story is complete.
4. **After merge**, move the User Story to 🟢 *Completed* in the tracker (record branch + PR link).
5. Delete the merged branch.

> One User Story = one branch = one PR. Keep PRs focused and reviewable.

---

## 2. Commit Messages — Conventional Commits

Every commit message MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Use for                                                        |
| ---------- | -------------------------------------------------------------- |
| `feat`     | A new feature / endpoint / capability                          |
| `fix`      | A bug fix                                                      |
| `refactor` | Code change that neither fixes a bug nor adds a feature        |
| `perf`     | A performance improvement                                      |
| `test`     | Adding or correcting tests                                     |
| `docs`     | Documentation only                                            |
| `build`    | Build system, dependencies, Prisma schema/migrations           |
| `ci`       | CI/CD and tooling (husky, lint config, etc.)                   |
| `chore`    | Maintenance that doesn't touch src or tests                    |
| `style`    | Formatting only (no logic change)                              |

### Scope

The module or area touched — e.g. `auth`, `user`, `vendor`, `query-builder`,
`prisma`, `config`. Optional but encouraged.

### Rules

- **Subject**: imperative mood, lower-case, no trailing period, ≤ 72 chars
  (e.g. `add refresh-token rotation`, not `Added refresh token rotation.`).
- **Body** (optional): explain *what* and *why*, not *how*. Wrap at ~72 chars.
- **Breaking changes**: add a `!` after type/scope **and** a `BREAKING CHANGE:` footer.

### Examples

```
feat(auth): add refresh-token rotation
fix(user): prevent soft-deleted users from logging in
refactor(query-builder): extract filter parsing into helper
build(prisma): add Vendor model and initial migration
ci: enforce lint + build via husky pre-commit hook
feat(api)!: change list response envelope to { data, meta }

BREAKING CHANGE: clients must read records from `data` instead of the root array.
```

---

## 3. Quality Gate — Husky pre-commit hook

A `pre-commit` hook (`.husky/pre-commit`) runs automatically on `git commit`.
**A commit is only created if both steps pass:**

1. **Lint** — `npm run lint` (ESLint over all source chunks).
2. **Build** — `npm run build` (`tsc` full type-check + compile). Skipped only
   while `src/` contains no `.ts` files yet (fresh project).

If lint or build fails, the commit is **aborted** with the failing output.

- Fix lint issues fast: `npm run lint:fix`
- Re-run the gate manually any time: `npm run lint && npm run build`
- The hook is intentionally **not** bypassed in normal work. Only use
  `git commit --no-verify` for genuine emergencies, and never to land broken code.

---

## 4. Pull Requests

- Title follows the same Conventional Commits format as commits.
- Link the User Story and include testing notes.
- Ensure lint + build pass locally (the hook guarantees this per-commit).
- Squash-or-rebase merge to keep `main` history linear and readable.
