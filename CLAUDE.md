# mokumoku-ai

公開のテクノロジー記事を自分で選んで読み、日記と用語ページを公開する自律エージェント。本体は GitHub Actions(`heartbeat.yml`)で動き、`tools/*.ts` を Node.js 24 でビルドなしに実行する。概要・セットアップは README.md、詳細は docs/ を参照。
この CLAUDE.md は開発用。エージェント自身の決まりは SOUL.md(人間のみ編集)と RULES.md(エージェントが書き換える)にある。
ファイル別の「触ると壊れる箇所」は `.claude/rules/` にあり、Read / Edit ツールで該当ファイルを開くと自動で読み込まれる。Bash(`cat` / `sed` / `grep` など)で読み書きするときは自動では読み込まれないので、先に該当する `.claude/rules/*.md` を読む。

## ドキュメント運用ルール
- **最低ライン: 必ず読む文書(CLAUDE.md・README の概要・`.claude/rules/`)は簡潔に保つ。それ以外の文書は docs/ の下に置く。** 以下はその内訳。
- 作業開始時は CLAUDE.md と README の概要だけ読む。docs/ は `.claude/rules/` の指示に従い、該当作業のときだけ読む。CHANGELOG は全文を読まず直近のエントリだけ見る。
- README に経緯・実装ログ・機能の詳細を書かない。機能を追加したら README には一行、詳細は docs/features.md に書く。
- 実装完了時は CHANGELOG に1〜3行で追記する。調査や判断に経緯がある場合は docs/decisions/ に書き、CHANGELOG からリンクする。
- 触ると壊れる箇所・変更禁止の理由は docs/technical-notes.md に書き、`.claude/rules/` の該当ファイル(`paths` に対象ファイルを書く)に1行で要約する。特定のファイルに結びつかない注意(操作・運用・会話の場面で要るもの)だけ CLAUDE.md に書く。
- 実機確認が必要で未確認の項目は technical-notes.md の「未検証」に書く。確認できたら削除し、CHANGELOG に「確認済み」と1行残す。
- README が150行、CLAUDE.md が200行を超えたら、追記せず分割を提案する。

## 進め方
- 承認(「ok」「プッシュして」等)があるまでコミット・push しない。push の前に `git fetch` して `origin/main` を見る。
- チャットごとに worktree で並行している。自分の変更だけをコミットし、他のチャットの未コミット変更を混ぜない。
- 実装は段階ごとに動作確認してから次へ進む(段階の一覧と現在地は docs/features.md)。実機で未確認のものを「確認済み」と書かない。
- リポジトリ・Actions のログ・state/ はすべて公開される。秘密情報や非公開の情報を書かない。
- `state/` `journal/` はランナー上の wake が書いて push する。手元で試すときは `MOKUMOKU_ROOT` で別の場所に書かせ、試した結果をコミットしない。
- 保留・不要と言われた事項は、本人から話題が出るまで再提案しない(言われたらここに1行足す)。定期実行・監視の自動化は、頼まれない限り提案しない。
- 不可逆なコマンドを足したら、`.claude/settings.json` の ask / deny と、ユーザー設定 `~/.claude/settings.json` の両方に入れる(前者は、そのブランチの checkout にしか効かない)。
