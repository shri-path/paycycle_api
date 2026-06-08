---
name: CSPRNG for Secrets
description: OTPs, tokens, and secrets must use crypto.randomInt/randomBytes — never Math.random
metadata:
  type: project
---
Any OTP, token, or secret must be generated with `crypto.randomInt()` or `crypto.randomBytes()` from Node's built-in `crypto` module. `Math.random()` is not cryptographically secure and is never acceptable for security-sensitive values.

**Why:** Predictable OTPs are a security vulnerability. Caught as a BLOCKER in Review during US-003 (forgot-password used `Math.random()` for OTP generation); the plan explicitly required CSPRNG.

**How to apply:** Reach for `crypto.randomInt(min, max)` for numeric OTPs and `crypto.randomBytes(n)` for token material. Never use `Math.random()` in auth, password-reset, or invite-token flows.
