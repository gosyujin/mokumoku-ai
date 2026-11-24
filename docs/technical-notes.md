# 技術的な注意点・不変条件・既知の制限

触ると壊れる箇所と、その理由。経緯の長いものは [decisions/](decisions/) に1件1ファイルで置く。
ここに書いたら、`.claude/rules/` の該当ファイル(`paths` に対象ファイルを書く)にも1行で要約する。

## 技術的な注意点

- **tools は Node.js の型除去(type stripping)で実行する。** ビルド工程を作らないため。Node.js 22.18 以上が必要で、ワークフローでは `actions/setup-node` で 24 を入れている。
  消すだけで済む構文しか使えない。`enum`・`namespace`・コンストラクタの引数プロパティは実行時エラーになる。型だけの import は `import type`、相対 import は拡張子 `.ts` まで書く。
- **heartbeat.yml の起動条件を増やさない。** issue_comment や pull_request_target を足すと、他人の入力でエージェントが起動する。
- **wake の関門(稼働時間外・20分未満)では何も書かない。** ここで cursor.json を更新すると、何もしない回にも commit が発生し、`lastBeat` が進んで次の正規の起床を二重起動と誤判定する。
- **起動回数は wake が `act=true` を出した時点で数える。** Claude の step が失敗しても1回と数える(上限を確実に守る側に倒している)。段階2〜3では LLM は動かないが、同じ数え方で上限の空回しになる。
- **journal の wake の行にフィードのタイトルを入れない。** 外部テキストを行動ログに混ぜないため。タイトルは `state/candidates.json` にだけ入る(エージェントはデータとして読む)。
- **フィードの取得には User-Agent で名前とリポジトリの URL を名乗っている**(`tools/lib/feed.ts` の `USER_AGENT`)。

## 段階4以降で決めること

- guard は `state/` 全体を許可すると、エージェントが `cursor.json` の起動回数や `seen.json` を書き換えられる。`cursor.json` `seen.json` `known.txt` `inbox/` は禁止側に入れる想定。
- リポジトリ直下の CLAUDE.md(開発用)を、ランナー上のエージェントも読み込む可能性がある。読み込まれて困る内容を書かない。挙動は段階4で確かめる。
- はてブは入れ替わりが速い。新着があるたびに `act=true` になるので、午前中に12回を使い切る可能性がある。段階3の journal で実際の頻度を見てから、はてブ単独では起こさない等の調整を決める。
- 疑問キューが残っている間は毎回 `act=true` になる。掘るのは1日2語までなので、キュー残だけを理由にする回数は絞る余地がある。

## 未検証

実機確認が必要で、まだ確かめていないもの。確認できたら消し、CHANGELOG に「確認済み」と1行残す。

- 単体テスト(`node --test`)の Node.js での実行。手元の Node.js は 20 のため、Deno 1.41 で代用した。
- schedule(cron)からの起動。手動実行(workflow_dispatch)だけ確認した。
- 30分以上あけた2回目以降の起床(304 の扱い、新着の検出、`⚠間隔超過`)の Actions 上での挙動。
- launchd からの workflow_dispatch(fine-grained PAT の権限、スリープ明けの挙動)。
- schedule の遅延の大きさ(遅れ方によっては launchd の起床と20分以上離れ、両方が動く)。
