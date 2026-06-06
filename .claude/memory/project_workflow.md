---
name: Agent Workflow Pipeline
description: Mandatory 4-agent workflow for all feature development - architect, dev, review, qa
metadata:
  type: project
---
All feature development follows a strict 4-agent pipeline: Architect -> Dev -> Review -> QA.

**Why:** Ensures quality, separation of concerns, and prevents ad-hoc implementation without planning.

**How to apply:**
1. Never skip steps — every feature must go through all 4 agents in order
2. Architect produces FEATURE_PLAN.md + FEATURE_TASKS.md before any code is written
3. Dev implements strictly from the plan — no freelancing
4. Review gates quality before QA — Critical/Major findings loop back to Dev
5. QA tests against the plan — Critical bugs loop back to Dev
6. Each agent reads memory and product docs before starting
7. Full agent definitions are in `.claude/agents/` directory (see also AGENTS.md)
