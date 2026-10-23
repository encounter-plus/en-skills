# en-skills

Before changing shipped tools, runtime, skills or knowledge, or preparing a build for installation/publication, read [VERSIONING.md](VERSIONING.md). Classify the version impact and apply the required bump before distributing changed artifacts.

Read README.md for supported capabilities and commands. Preserve the distinction between a skill workflow and an installed tool. Remote adapters are provided by the npm package; credentials, user identity, durable journals and token storage belong to the host. A separate Telegram bot can consume this package.

Knowledge lives in knowledge/. Source skills/*/SKILL.md link to ../../knowledge/*.md. Reference copies exist only in dist/skills (and host bundles); npm run build:skills discovers skill directories and follows transitive Markdown dependencies. Edit authoring-guide.md and code-marking.md directly: they are the canonical rule sources. This command compiles their rules into dist/knowledge/authoring-rules.json for the CLI without rewriting source Markdown. Preserve stable rule IDs, scope comments and indented table continuations. Never edit generated dist files. Rebuild and run npm run check. Keep every installed skill self-contained; validate links from the packaged directory, not only from this checkout.

Code/answer strings are lossless. Photo evidence, expected document values and accepted engine answers remain separate. Visual variants such as конь6 → кон66 are proposals to add an answer, never automatic normalization or replacement.

Use knowledge/solyanka-formats.md for puzzle mechanics. Preserve qualified definitions and ask for the exact rule when a format has multiple variants.

Use synthetic fixtures. Do not make real game mutations or call external author scripts in tests. Commit, push, publish and installation into user skill directories require an explicit user request.

## Commit contents

Commit maintained source, skills/knowledge, tests and synthetic fixtures, eval definitions/tooling, configuration, lock-files and user/developer documentation. Keep research notes, implementation diaries, generated eval results, model/tool traces, logs, screenshots from test runs, temporary workspaces, caches, builds, release archives, verification manifests, credentials and host state out of commits. Preserve the tracked vendored SDK archive required by the lock-file; do not ignore JSON/JSONL fixtures or maintained instructions as a class.

Store scratch work under `.local/` or `.tmp-*/`. Keep retained research and run evidence under ignored `release-output/evidence/`, and final release logs/manifests under `release-output/verification/`. Summarize relevant outcomes in maintained release documentation without links to local-only files. Follow [.gitignore](.gitignore); do not force-add excluded artifacts.

Before an authorized commit, inspect `git status --short`, `git diff --cached --name-status` and the staged diff. Stage explicit intended paths and verify that no run output, research or secrets are included. Ignore rules do not untrack existing files: report any tracked artifacts needing removal; do not rewrite Git history without an explicit request.
