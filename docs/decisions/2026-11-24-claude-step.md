# Claude の step の組み方(段階4)

## 背景

仕様書の骨子は `anthropics/claude-code-action@v1` に `claude_code_oauth_token`・`prompt`・`claude_args` を渡す形だった。
一方で、エージェントには「Bash、git、秘密情報は持たせない。Read はリポジトリ配下に限定する」という条件がある。
公式の `action.yml` と docs、CLI の `--help` を 2026-11-24 に読んで、次のことが分かった。

- `claude-code-action@v1` 本体は、Claude に GitHub を操作させる前提の action。Claude の GitHub App(`id-token: write` が必要)か、`github_token` の入力のどちらかが要る。どちらも「git と秘密情報を持たせない」に反する。
- 同じリポジトリの `base-action` は、Claude Code を入れて `prompt` と `claude_args` で実行するだけの薄い action。GitHub のトークンを受け取らない。
- `base-action` は内部で `actions/setup-node` を呼び、`env.NODE_VERSION` が無いと Node.js 18 を入れる。そのままだと後ろの `tools/*.ts`(22.18 以上が必要)が動かなくなる。
- CLI に `--restricted` がある(2.1.248 以上)。コマンドを実行する道具を外し、ファイルの読み書きを作業ディレクトリの中に閉じ込め、user / project / local の設定ファイルを読まない(`--settings` で渡したものは読む)。
- `actions/checkout` は既定で push 用の認証を残す。Claude の step はリポジトリの中を読めるので、残っていると読める場所に認証があることになる。
- 権限ルールのパスは、`/` 始まりだと「設定ファイルのある場所」が基準になる。`--settings ops/agent/settings.json` に `Edit(/drafts/**)` と書くと `ops/agent/drafts/` を指す。

## 判断

- `anthropics/claude-code-action/base-action@v1` を使う。GitHub のトークンは渡さない。
- `claude_args` に `--restricted`、`--tools "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch"`、`--settings ops/agent/settings.json`、`--strict-mcp-config` を付ける。
- 書ける場所は `ops/agent/settings.json` の allow で `./drafts/**` と `./journal/**` だけにする。許可の無い書き込みは、確認する人がいないので拒否される。
- それとは別に、step の後で `tools/guard.ts` が `git status` を見て、許可した場所の外に変更があれば job を失敗させる(二重の検査)。
- wake の記録は、Claude の step の前に commit して push する。理由は2つ。
  - guard が「いま見えている変更はすべてエージェントのもの」と言えるようにするため。
  - Claude の step や guard が失敗しても、起床と起動回数が残るようにするため(残らないと、次の起床でまた起動して1日12回の上限が効かない)。
- checkout は `persist-credentials: false` にし、push 用のトークンは commit の step の `env` にだけ渡す(`tools/commit.ts` が、その実行の間だけ git に持たせる)。
- job の `env` に `NODE_VERSION: "24"` を置く。
- エージェントへの指示は `ops/agent/prompt.md` に置く。ワークフローの `prompt` には「それを読め」と日付だけを書く。日付は wake が計算した値で、外部のテキストは入れない。
- 動かすかどうかは Repository variable `MOKUMOKU_AGENT` で切り替える(`on` のときだけ動く)。トークンを入れる前に step が失敗し続けないようにするため。
- 下書きの形式は、仕様書の提案(front matter に title / date / sources / terms、本文は「読んだ記事」「感じたこと」「知らなかったワード」「相談」)をそのまま採った。

手元の `claude`(2.1.326)で、リポジトリの複製に対して同じ引数で確かめたこと:

- リポジトリの外(`../`・`/etc/hosts`)と `.git/config` は読めない。
- `drafts/`・`journal/` には書ける。`tools/`・`RULES.md`・`SOUL.md`・`ops/agent/settings.json`・リポジトリの外には書けない。
- 使える道具は指定した7つだけ。リポジトリの CLAUDE.md(開発用)は読み込まれない。
- 実際の指示で1回動かすと、約40秒・11ターンで、journal への追記と下書きの作成まで行った。

## 再検討するとき

- `claude-code-action` 本体が GitHub のトークンなしで動くようになったら、骨子どおりに戻せる。
- `--restricted` の仕様が変わったら(公式ドキュメントの記述は少ない)、手元の確認をやり直す。
- 段階5で書ける場所を増やすときは、`ops/agent/settings.json` と `tools/lib/guard.ts` の両方を直す。
