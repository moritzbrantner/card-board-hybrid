Agent profile: slice-implementer
Model policy: slice-implementation / gpt-5.5 / medium
Escalation: repair-worker after concrete failure

Use $moenarch-implement for this agent-loop task.

Implement the ready slice described by the context pack.

Context pack: .agent-loop/context/issue-2-worker-pack.md

Read budget:
- Read the context pack first.
- Read only the required docs listed in the pack.
- Inspect files under Expected Write Scope before broad exploration.
- Use `rg` before opening broad files.
- Do not paste long file contents or command output in the final report.

Work rules:
- Stay inside the slice scope.
- Do not revert unrelated edits.
- Run focused checks first, then final checks from the pack.
- Open or update the linked PR if implementation changes are made.
- Do not merge.
- After the PR is open and all local changes are committed or stashed, switch the local checkout back to `main` before the final report. If the worktree is not clean or `main` is unavailable, report the exact blocker instead of leaving silently on the work branch.

Return only this report shape plus concise notes when needed:

```json
{
  "schemaVersion": 1,
  "workerKind": "slice",
  "status": "ready-to-merge",
  "parentPrd": null,
  "sliceIssue": null,
  "pr": null,
  "branch": null,
  "concurrencyGroup": null,
  "startedAt": null,
  "finishedAt": null,
  "filesChanged": [],
  "checks": [],
  "risks": [],
  "blockedOn": [],
  "failureCategory": null,
  "reworkNeeded": false,
  "confidence": "medium"
}
```
