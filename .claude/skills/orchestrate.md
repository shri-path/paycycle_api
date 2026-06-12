---
name: orchestrate
description: Start the full cross-project feature pipeline — picks next user story from the progress tracker, runs backend and frontend architects in parallel, then chains dev → review → QA in both repos automatically. Only pauses for open questions from the architects. Use when asked to start a new feature, run the orchestrator, or build the next user story.
---

# /orchestrate

Spawn the **orchestrator agent** to run the full end-to-end feature pipeline.

```
Agent({
  subagent_type: "orchestrator",
  description: "Full cross-project feature pipeline",
  prompt: "Run the full feature pipeline. Read .claude/skills/orchestration-protocol.md for the cross-project protocol. Start from Phase 0 (feature selection from PROGRESS_TRACKER.md) and run all phases through to PRs opened. Only pause for genuine open questions from architects — never ask for plan approval or pipeline confirmation."
})
```

That is the entire skill. One Agent call, zero configuration, zero arguments.

The orchestrator handles everything: feature selection, architect planning, open-questions gate,
parallel dev workstreams, review, QA, commit, push, and PR creation in both repos.
