# CHANGELOG

1エントリ1〜3行。バージョン番号は採番せず、日付とコミットhashで管理する(新しい順)。調査・判断に経緯があるものは [docs/decisions/](docs/decisions/) に置き、該当エントリからリンクする。

## 2026-11-25

- Added: heartbeat の手動実行に `sync` の指定を足した(起床の関門に関係なく cosense-sync を動かす)。最初の用語ページ(eBPF)を、人間の指示で手動で送る。

## 2026-11-24

- Added: Cosense 連携(段階6)。wake がページ名の一覧(known.txt)とツッコミの転記(inbox/)を作り、cosense-sync がエージェントの書いた用語ページと返信を送る。読み取りは実際の Cosense で確認。書き込みは、送らずに表示するモードでだけ確認(実際の送信は未検証)。経緯: [docs/decisions/2026-11-24-cosense.md](docs/decisions/2026-11-24-cosense.md)
- Added: 公開済みの日記への追記。`kind: addendum` を付けた下書きを、lint が日記の末尾に「追記(日時)」として足す(元の文面は変えない)。公開後に読んだ別の記事は、翌日の下書きに書かせる。Atom の `updated` は最後の追記に合わせる。手元で確認済み、Actions 上は未検証。
- 確認済み: 最初の日記の公開(2026-11-24 付け)。人間の指示で下書きに印を付け、lint を手元から実行して entries/ に移した。その後の起床(手動指定なし)で、日記の追加を検出して自動でデプロイされた。lint の Actions 上での実行は未検証のまま。
- Added: lint(段階5)。エージェントが `status: ready` を付けた下書きだけを検査し、合格したものを entries/ に移す。不合格の理由は journal に書く。手元で確認済み、Actions 上は未検証。経緯: [docs/decisions/2026-11-24-lint-publish.md](docs/decisions/2026-11-24-lint-publish.md)
- 確認済み: `--model opus` と直した下書きの指示の Actions 上での動作(22:07 の起床)。claude-opus-5-5 で動き、エージェントが前回の挨拶の行を自分で直した。
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
