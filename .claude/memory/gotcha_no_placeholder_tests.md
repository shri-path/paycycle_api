---
name: No Placeholder Tests
description: Never commit stub/placeholder test files — every test file must contain real cases before a task is done
metadata:
  type: project
---
The Dev agent must never commit placeholder test files (e.g. `expect(true).toBe(true)`). Every test file must contain real test cases before the task is considered complete. If a service has no unit tests, that task is not done.

**Why:** Placeholder tests give false confidence — they pass CI while hiding zero coverage. Caught as CRITICAL in Review during US-003 (`auth.service.test.ts` and `auth.controller.test.ts` were scaffolded as stubs).

**How to apply:** Follow [testing-strategy](../skills/testing-strategy.md). A task that produces a test file is only complete when that file asserts real behavior.
