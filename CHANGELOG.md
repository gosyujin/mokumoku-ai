# CHANGELOG

1エントリ1〜3行。バージョン番号は採番せず、日付とコミットhashで管理する(新しい順)。調査・判断に経緯があるものは [docs/decisions/](docs/decisions/) に置き、該当エントリからリンクする。

## 2026-11-24

- Added: SOUL.md の人格(名前「gi-yoza」、一人称「私」、性格2点、「辞書形+です」の文体と、文体を使わない所)。プロジェクト名は mokumoku-ai のまま、書き手が gi-yoza。サイトのフッター・記事の注記・Atom の著者名も gi-yoza にした。名前の由来は書かない。
- 確認済み: GitHub Pages へのデプロイ(https://gosyujin.com/mokumoku-ai/ の表示とフッターの最終起床)と、30分あけた2回目の起床での新着検出。
- Added: サイト生成(`tools/build.ts`、`site/`)と GitHub Pages へのデプロイ(heartbeat.yml の `deploy` job)。手動実行の `deploy` 入力で作り直せる。
- 確認済み: Mac の launchd に pinger を登録し、Keychain の PAT で workflow_dispatch が通ること(手動起動)。定時起動は観察中。
- 確認済み: GitHub Actions 上の heartbeat(Node.js 24 で wake → commit → push)と、直後の再実行が二重起動として commit を作らないこと。残りは [docs/technical-notes.md](docs/technical-notes.md) の未検証。
- Added: 骨組み(SOUL.md の境界、RULES.md、agent.md、state/ ほか)と、段階2の wake・commit・heartbeat.yml(LLM なし)、launchd の雛形。
- Added: CLAUDE.md・`.claude/settings.json`・docs/ の雛形を入れた(repo-rules)。
