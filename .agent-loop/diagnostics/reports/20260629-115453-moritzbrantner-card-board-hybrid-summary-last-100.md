# Agent Loop Diagnostics Summary: 20260629-115453-moritzbrantner-card-board-hybrid

- Scope: last 100 events

- Repo: `moritzbrantner/card-board-hybrid`
- Total events: 33
- Total cycles: 1
- Worker spawns: 2
- Worker reports: 3
- Blocked events: 1
- Failed events: 0
- Merge completions: 2
- Average worker duration: unknown ms

## Outcomes

- `claimed-after-slicing`: 1
- `completed`: 1
- `merged`: 2
- `no-required-checks`: 2
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

- Estimates logged: 4
- Estimated tokens observed: 752
- Baseline estimated tokens: 850
- Estimated savings: 98 tokens
- Estimated savings percent: 11.53%

## Token Estimates By Artifact

- `queue-snapshot`: count=4, current=752, baseline=850, saved=98, confidence=high

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

- None recorded

## Merge Throughput

- Merge attempts: 2
- Merge completions: 2
- Ready-to-merge detections: 2

## Prompt Or Skill Improvement Candidates

- Review blocker handling for `external-ci-billing` (1 occurrence(s)).
