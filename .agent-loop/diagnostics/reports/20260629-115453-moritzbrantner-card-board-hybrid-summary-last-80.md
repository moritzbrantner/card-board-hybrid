# Agent Loop Diagnostics Summary: 20260629-115453-moritzbrantner-card-board-hybrid

- Scope: last 80 events

- Repo: `moritzbrantner/card-board-hybrid`
- Total events: 14
- Total cycles: 1
- Worker spawns: 1
- Worker reports: 1
- Blocked events: 1
- Failed events: 0
- Merge completions: 0
- Average worker duration: unknown ms

## Outcomes

- `claimed-after-slicing`: 1
- `ready-for-agent`: 1
- `slicing-approved`: 1

## Statuses

- `blocked`: 1

## Most Common Blockers

- `external-ci-billing`: 1

## Failed Commands

- None recorded

## No Required Checks

- Observations: 0

## Diagnostics Completeness

- No missing lifecycle fields recorded

## Token Estimates

- Estimates logged: 2
- Estimated tokens observed: 291
- Baseline estimated tokens: 319
- Estimated savings: 28 tokens
- Estimated savings percent: 8.78%

## Token Estimates By Artifact

- `queue-snapshot`: count=2, current=291, baseline=319, saved=28, confidence=high

## Model Policy

- Model policy events: 1

### By Task Class

- `slice-implementation`: 1

### By Model

- `gpt-5.5`: 1

### Escalations

- None recorded

### Failures

- None recorded

### Low Confidence Or Malformed

- None recorded

## Context Checkpoints

- None recorded

## Merge Throughput

- Merge attempts: 0
- Merge completions: 0
- Ready-to-merge detections: 0

## Prompt Or Skill Improvement Candidates

- Review blocker handling for `external-ci-billing` (1 occurrence(s)).
