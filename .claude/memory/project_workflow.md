---
name: Agent Workflow Pipeline
description: Dual-track pipeline — backend and frontend run in parallel once FEATURE_PLAN + API spec are ready; frontend architect is triggered immediately at that point
metadata:
  type: project
---
All feature development follows a dual-track pipeline. Backend and frontend share a common Architect phase start, then run independently in parallel.

**Why:** Ensures quality and separation of concerns while eliminating the bottleneck of waiting for the full backend pipeline before frontend work begins.

**How to apply:**

1. **Backend Architect** reads the User Story and produces `FEATURE_PLAN.md`, `DOMAIN_MODEL.md`, `FEATURE_TASKS.md`, and `API_SPEC.md` in `docs/features/<slug>/`.
2. **Trigger immediately** — as soon as `FEATURE_PLAN.md` + `API_SPEC.md` exist, the orchestrator launches the **Frontend Architect** on `paycycle_vendor` in parallel with the backend Dev phase. Do NOT wait for backend Dev/Review/QA.
3. **Backend track**: Dev → Review (Critical/Major findings loop back to Dev) → QA (Critical bugs loop back to Dev) → PR.
4. **Frontend track**: Architect → Dev → Review → QA → PR (same loop rules).
5. Each agent reads `.claude/memory/MEMORY.md` and product docs before starting.
6. Story moves 🟢 in `PROGRESS_TRACKER.md` only when PRs are open on **both** repos.
7. Full agent definitions are in `.claude/agents/` directory (see also AGENTS.md).
