# Planning Workflow

This repo uses the bundled planning workflow template from:

`~/.codex/skills/moenarch-setup-agent-loop-skills/planning-workflow.md`

GitHub Issues are the durable work queue.

## Default For Substantial Work

Substantial future work should default to a GitHub PRD issue instead of direct implementation.

Substantial work includes multi-step changes, ambiguous product behavior, cross-module work, schema or API changes, user-facing flows, or anything that would benefit from independent implementation slices.

Tiny one-shot changes may be implemented directly.

Explicit user direction to implement directly wins over the default unless it conflicts with safety, permissions, or repo policy.

## PRD Issue Rules

PRD issues must be labeled `prd`.

Only add `ready-for-agent` to a PRD issue when it includes acceptance criteria and out-of-scope boundaries.

The planning thread should stop after creating the PRD issue unless the user explicitly asks for direct implementation.

The planning thread should not create implementation slice issues by default. `moenarch-agent-loop` or a later `moenarch-to-issues` pass handles slicing.

## Implementation Slice Rules

Implementation slice issues must include a parent link before they receive `ready-for-agent`:

```markdown
## Parent

#<parent-prd-issue-number>
```

