---
name: Entity Invariants
description: Entities must freeze getProps() output and call validate() in both create() and reconstitute()
metadata:
  type: project
---
Two mandatory DDD entity patterns in this codebase:

1. **`getProps()` must return a frozen object:** `Object.freeze({ ...this._props, id: this._id, createdAt: this._createdAt, updatedAt: this._updatedAt })`. This is not optional — mutable prop objects let callers corrupt entity state and break the aggregate boundary. (Caught as CRITICAL in Review during US-003.)

2. **Both `create()` and `reconstitute()` must call `this.validate()`** before returning the entity. Invariants must be enforced whether the entity comes from user input or the database — a corrupt DB record can otherwise produce an invalid in-memory entity. (Caught as a LOW QA bug in US-003 where `reconstitute()` skipped validation.)

**How to apply:** See the auth/user entities for the reference shape. Every new aggregate root follows both rules.
