---
name: Strict Zod Field Coverage
description: A .strict() Zod schema must declare every field the controller/service reads from req.body
metadata:
  type: project
---
Before using `.strict()` on a Zod schema, verify the schema declares every field the controller or service will read from `req.body`. In strict mode, unknown fields are rejected with a 400 — so a field the controller reads but the schema omits will fail the request at runtime.

**Why:** Caught as a MEDIUM QA bug in US-003 — `loginSchema` was `.strict()` but the controller also read `deviceId` from the body, so valid logins with a device id were rejected.

**How to apply:** Declare non-required body fields as `z.string().optional()` (or appropriate optional type) rather than leaving them out. Cross-check the schema against every `req.body.*` access in the controller/service. See [validation-schemas](../skills/validation-schemas.md).
