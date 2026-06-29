# Worker Context Pack: issue #2

Repository: moritzbrantner/card-board-hybrid
Parent PRD: #1 https://github.com/moritzbrantner/card-board-hybrid/issues/1
Slice issue: #2 https://github.com/moritzbrantner/card-board-hybrid/issues/2
Concurrency group: ci-validation

## Goal

Add the repository's initial GitHub Actions validation caller using `moritzbrantner/reusable-workflows/.github/workflows/fast-validation.yml@workflow-standard-v1.3`. The completed slice should give pull requests, pushes to `main`, and manual runs one clear fast validation job that runs the existing root build and test contracts without adding unsupported lifecycle workflows.

The caller should use narrow job permissions, avoid inherited secrets, enable Bun and Cargo caching from the repository lockfiles, and make the Rust 1.85 / Rust 2024 toolchain expectation explicit enough for GitHub-hosted runners.

## Acceptance Criteria

- [ ] A GitHub Actions validation caller exists for this repository.
- [ ] The workflow runs on pull request events, pushes to `main`, and manual dispatch.
- [ ] The workflow calls `moritzbrantner/reusable-workflows/.github/workflows/fast-validation.yml@workflow-standard-v1.3` at the job level.
- [ ] The workflow grants only validation permissions, including `contents: read` and `packages: read`.
- [ ] The workflow does not use `secrets: inherit`.
- [ ] The reusable workflow receives `build_command: bun run build`.
- [ ] The reusable workflow receives `unit_test_command: bun run test` or the reusable workflow's equivalent test input.
- [ ] Bun dependency caching is enabled against `bun.lock`.
- [ ] Cargo dependency caching is enabled against `Cargo.lock`.
- [ ] The Rust toolchain requirement is explicit for Rust 2024 / rust-version 1.85.
- [ ] No unsupported lifecycle workflows are added for e2e, Storybook, link validation, performance validation, Pages deployment, external pull, package publish, release, stage validation, or branch promotion.
- [ ] Workflow syntax is checked with actionlint or an equivalent GitHub Actions linter when available.
- [ ] `bun run test` is run locally
...[truncated]

## Expected Write Scope

- `.github/workflows/validate.yml` or an equivalent validation caller workflow file
- PR notes only for the branch protection recommendation, unless a repository doc is clearly the better existing location

## Verification

None

## Required Reading

- AGENTS.md

## Blockers

None

## Recent Relevant Comments

None

## Notes

Keep implementation limited to this slice. Read more files only when the pack and required docs are insufficient.
