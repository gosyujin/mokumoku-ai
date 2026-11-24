---
paths:
  - ".github/workflows/heartbeat.yml"
  - "tools/**/*.ts"
  - "ops/agent/**"
---
# heartbeat と tools

- `on:` に schedule / workflow_dispatch 以外を足さない(他人の入力で起動させない)。
- 秘密情報は使う step の `env:` にだけ渡す。job 全体の `env:` に置かない。権限(`permissions`)は job ごとに付け、ワークフロー全体には足さない。
- tools は Node.js の型除去でそのまま実行する。`enum`・`namespace`・引数プロパティは使えない。型だけの import は `import type`、相対 import は `.ts` まで書く。
- 外部依存を足さない(`npm install` の工程を作らない)。
- Claude の step の `--restricted`・`--tools`・`--settings`、checkout の `persist-credentials: false`、job の `NODE_VERSION` を外さない。GitHub のトークンを Claude の step に渡さない。
- step の順番(wake → commit → エージェント → guard → lint → commit)を変えない。guard は、直前の commit で作業ツリーがきれいになっている前提で動く。
- `entries/` に書くのは `tools/lint.ts` だけ(同じ日付は上書きしない)。lint の step に秘密情報を渡さない。
- エージェントが書ける場所は `ops/agent/settings.json`(パスは `./` 始まり)と `tools/lib/guard.ts` の両方にある。片方だけ直さない。
- 詳細: [docs/technical-notes.md](../../docs/technical-notes.md)
