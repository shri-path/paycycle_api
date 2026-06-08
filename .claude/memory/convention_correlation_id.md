---
name: CorrelationId on All Errors
description: Every HTTP error response (including notFoundHandler) must include a correlationId
metadata:
  type: project
---
Every HTTP error response in this codebase must include a `correlationId`. Pattern:

```ts
const correlationId = (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID();
```

Apply this to `errorHandler` **and** `notFoundHandler` — and any other path that emits an error body.

**Why:** Consistent correlationId across all error paths enables end-to-end request tracing. Caught in US-003 QA where `errorHandler` had it in 4 branches but `notFoundHandler` was missed.

**How to apply:** When adding any error-emitting middleware or handler, wire the correlationId from the request header (falling back to a generated UUID) into the response.
