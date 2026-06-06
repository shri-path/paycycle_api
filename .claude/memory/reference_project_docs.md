---
name: project-document-paths
description: Absolute paths to all product documents agents must read before implementation — features, wireframes, user stories, DB design, and progress tracker
metadata:
  type: reference
---

All agents must read relevant documents from these locations before starting any implementation.

## Document Paths

| Document Type | Path |
|---|---|
| Features | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\features\` |
| Wireframes | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\wireframes\` |
| User Stories | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\user_stories\` |
| DB Design | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\db-design\` |
| Progress Tracker | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\PROGRESS_TRACKER.md` |

## Usage Rules

- **Before any implementation**, agents must read the relevant user story file and DB design for the story being worked on
- **DB Design** is the source of truth for schema decisions — Prisma schema must match it
- **Progress Tracker** must be updated by each agent at the start and end of their work:
  - Backend agents update the `Backend (paycycle_api)` section
  - Architect updates the summary table status
  - QA adds testing notes after validation
- Do NOT invent API contracts — all endpoints must be grounded in the user story and feature docs
