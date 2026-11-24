---
paths:
  - ".github/workflows/heartbeat.yml"
  - "tools/**/*.ts"
---
# heartbeat と tools

- `on:` に schedule / workflow_dispatch 以外を足さない(他人の入力で起動させない)。
- 秘密情報は使う step の `env:` にだけ渡す。job 全体の `env:` に置かない。権限(`permissions`)は job ごとに付け、ワークフロー全体には足さない。
- tools は Node.js の型除去でそのまま実行する。`enum`・`namespace`・引数プロパティは使えない。型だけの import は `import type`、相対 import は `.ts` まで書く。
- 外部依存を足さない(`npm install` の工程を作らない)。
- 詳細: [docs/technical-notes.md](../../docs/technical-notes.md)
