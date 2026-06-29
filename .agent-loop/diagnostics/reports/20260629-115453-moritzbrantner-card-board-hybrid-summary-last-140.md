# Agent Loop Diagnostics Summary: 20260629-115453-moritzbrantner-card-board-hybrid

- Scope: last 140 events

- Repo: `moritzbrantner/card-board-hybrid`
- Total events: 42
- Total cycles: 2
- Worker spawns: 2
- Worker reports: 3
- Blocked events: 1
- Failed events: 0
- Merge completions: 2
- Average worker duration: unknown ms

## Outcomes

- `blocked`: 2
- `claimed-after-slicing`: 1
- `completed`: 1
- `merged`: 2
- `no-required-checks`: 2
- `not-finished`: 1
- `ready-for-agent`: 1
- `ready-to-merge`: 2
- `slicing-approved`: 1

## Statuses

- `blocked`: 1
- `ready-to-merge`: 4

## Most Common Blockers

- `external-ci-billing`: 1

## Failed Commands

- None recorded

## No Required Checks

- Observations: 2

## Diagnostics Completeness

- No missing lifecycle fields recorded

## Token Estimates

- Estimates logged: 5
- Estimated tokens observed: 900
- Baseline estimated tokens: 1012
- Estimated savings: 112 tokens
- Estimated savings percent: 11.07%

## Token Estimates By Artifact

- `queue-snapshot`: count=5, current=900, baseline=1012, saved=112, confidence=high

## Model Policy

- Model policy events: 4

### By Task Class

- `merge-decision`: 2
- `slice-implementation`: 2

### By Model

- `gpt-5.5`: 4

### Escalations

- None recorded

### Failures

- None recorded

### Low Confidence Or Malformed

- None recorded

## Context Checkpoints

- 2026-06-29T17:13:09Z: /tmp/card-board-hybrid-agent-loop-checkpoint-20260629-1715.md

## Merge Throughput

- Merge attempts: 2
- Merge completions: 2
- Ready-to-merge detections: 2

## Prompt Or Skill Improvement Candidates

- Review blocker handling for `external-ci-billing` (1 occurrence(s)).
- Review master context usage and checkpoint cadence.
