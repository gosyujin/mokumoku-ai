# CHANGELOG

1エントリ1〜3行。バージョン番号は採番せず、日付とコミットhashで管理する(新しい順)。調査・判断に経緯があるものは [docs/decisions/](docs/decisions/) に置き、該当エントリからリンクする。

## 2026-11-24

- Changed: エージェントのモデルを Opus に固定(`--model opus`)。下書きの指示を直した(本文に AI の断り書きを入れない、SOUL.md の文体は控えめに、挨拶から始めない)。手元の `claude` で確認済み、Actions 上は未検証。
- 確認済み: Claude の step の Actions 上での動作(20:57 の起床)。エージェントが記事を1本読み、journal への追記と `drafts/2026-11-24.md` の作成を行い、guard・`agent:` の commit・build まで通った。action の後も Node.js は 24 のまま。初回(20:37)の失敗は、登録したトークンが途中で切れていたため。
- Added: エージェントの step が失敗したとき、失敗の理由だけをログに出す step。初回(20:37)は API の最初の要求で失敗し、理由がログに出なかったため。
- 確認済み: 認証を残さない checkout と `GITHUB_TOKEN` での push(20:37 の `beat:` の commit)。エージェントの step が失敗しても、起床と起動回数が残ることも同じ回で確認。
- 確認済み: 手動指定なしの自動デプロイ。中身が同じ回は `deploy` job が飛ばされ(19:07・19:37)、サイト雛形を変えた次の起床(20:07)で自動的に公開された。日記の追加でも同じ経路を通る。
- 確認済み: launchd の定時起動。18:37 から 20:07 まで、毎時7分・37分に4回続けて `wake(dispatch)` が記録された。スリープ明けの挙動は未検証のまま。
- Added: Claude の step(段階4)。`base-action` を `--restricted` で動かし、書けるのは drafts/ と journal/ だけ。`tools/guard.ts` で二重に検査する。`MOKUMOKU_AGENT` が `on` のときだけ動く。手元の `claude` で確認済み、Actions 上は未検証。経緯: [docs/decisions/2026-11-24-claude-step.md](docs/decisions/2026-11-24-claude-step.md)
- Changed: checkout に認証を残さず、push 用のトークンを commit の step にだけ渡す。wake の記録を先に commit する(1回の起床で commit が2つになりうる)。
- Added: SOUL.md の人格(名前「gi-yoza」、一人称「私」、性格2点、「辞書形+です」の文体と、文体を使わない所)。プロジェクト名は mokumoku-ai のまま、書き手が gi-yoza。サイトのフッター・記事の注記・Atom の著者名も gi-yoza にした。名前の由来は書かない。
- 確認済み: GitHub Pages へのデプロイ(https://gosyujin.com/mokumoku-ai/ の表示とフッターの最終起床)と、30分あけた2回目の起床での新着検出。
- Added: サイト生成(`tools/build.ts`、`site/`)と GitHub Pages へのデプロイ(heartbeat.yml の `deploy` job)。手動実行の `deploy` 入力で作り直せる。
- 確認済み: Mac の launchd に pinger を登録し、Keychain の PAT で workflow_dispatch が通ること(手動起動)。定時起動は観察中。
- 確認済み: GitHub Actions 上の heartbeat(Node.js 24 で wake → commit → push)と、直後の再実行が二重起動として commit を作らないこと。残りは [docs/technical-notes.md](docs/technical-notes.md) の未検証。
- Added: 骨組み(SOUL.md の境界、RULES.md、agent.md、state/ ほか)と、段階2の wake・commit・heartbeat.yml(LLM なし)、launchd の雛形。
- Added: CLAUDE.md・`.claude/settings.json`・docs/ の雛形を入れた(repo-rules)。
