# 技術的な注意点・不変条件・既知の制限

触ると壊れる箇所と、その理由。経緯の長いものは [decisions/](decisions/) に1件1ファイルで置く。
ここに書いたら、`.claude/rules/` の該当ファイル(`paths` に対象ファイルを書く)にも1行で要約する。

## 技術的な注意点

- **tools は Node.js の型除去(type stripping)で実行する。** ビルド工程を作らないため。Node.js 22.18 以上が必要で、ワークフローでは `actions/setup-node` で 24 を入れている。
  消すだけで済む構文しか使えない。`enum`・`namespace`・コンストラクタの引数プロパティは実行時エラーになる。型だけの import は `import type`、相対 import は拡張子 `.ts` まで書く。
- **heartbeat.yml の起動条件を増やさない。** issue_comment や pull_request_target を足すと、他人の入力でエージェントが起動する。
- **wake の関門(稼働時間外・20分未満)では何も書かない。** ここで cursor.json を更新すると、何もしない回にも commit が発生し、`lastBeat` が進んで次の正規の起床を二重起動と誤判定する。
- **起動回数は wake が `act=true` を出した時点で数える。** Claude の step が失敗しても1回と数える(上限を確実に守る側に倒している)。`MOKUMOKU_AGENT` が `on` でない間も同じ数え方をする。
- **journal の wake の行にフィードのタイトルを入れない。** 外部テキストを行動ログに混ぜないため。タイトルは `state/candidates.json` にだけ入る(エージェントはデータとして読む)。
- **フィードの取得には User-Agent で名前とリポジトリの URL を名乗っている**(`tools/lib/feed.ts` の `USER_AGENT`)。
- **Claude の step から `--restricted`・`--tools`・`--settings ops/agent/settings.json` を外さない。** `--restricted` が、コマンド実行の道具を外し、読み書きをリポジトリの中に閉じ込め、リポジトリの `.claude/settings.json` と CLAUDE.md(どちらも開発用)を読ませない役をしている。`claude-code-action` 本体(`base-action` でないほう)に替えない(GitHub のトークンを Claude に渡す作りのため)。経緯は [decisions/2026-11-24-claude-step.md](decisions/2026-11-24-claude-step.md)。
- **`ops/agent/settings.json` のパスは `./` で始める。** `/` で始めると設定ファイルのある場所が基準になり、`Edit(/drafts/**)` は `ops/agent/drafts/` を指す(どこにも書けなくなる)。
- **エージェントが書ける場所は2か所に書いてある。** `ops/agent/settings.json`(書く前に拒否する)と `tools/lib/guard.ts` の `AGENT_WRITABLE`(書いた後に検査する)。増やすときは両方を直す。
- **wake の commit を Claude の step より前に置く。** guard は「commit 後に見える変更はすべてエージェントのもの」という前提で動く。順番を変えると、wake が書いた `state/` を違反と判定する。また、後ろの step が失敗しても起動回数が残る。
- **checkout の `persist-credentials: false` を外さない。** push 用のトークンは commit の step の `env`(`GITHUB_TOKEN`)にだけ渡す。Claude の step はリポジトリの中を読めるので、認証を作業ツリーの近くに残さない。
- **job の `env` の `NODE_VERSION` を消さない。** `base-action` が内部で Node.js を入れ直すときにこの値を使う。無いと 18 になり、後ろの guard・commit・build が動かない。
- **`entries/` に書くのは lint だけ。** エージェントにも guard にも `entries/` を許可しない。lint は公開済みの日記の文面を変えない(公開済みの記事を消さない、という SOUL.md の境界7)。訂正や続きは、末尾に `## 追記(日付 時刻)` として足すだけ(`tools/lib/lint.ts` の `applyAddendum`)。
  - 例外(2026-11-25 に人間が決めた): 内容を変えない文体だけの手直しは、訂正ではないので、人間の指示があるときに人間側が手で上書きする。エージェントと lint にはさせない。
- **`## 追記(YYYY-MM-DD HH:MM)` の見出しの形を変えない。** `tools/build.ts` が、この見出しから Atom の `updated` を決めている。見出しは lint が付け、エージェントには書かせない。
- **lint は「AI が書いた旨の署名」を本文に求めない。** 署名は `tools/build.ts` が記事の冒頭とフッターに入れる。build からその表示を消すなら、本文に書かせる形に戻す必要がある。
- **lint の step は guard の後、2回目の commit の前に置く。** guard より前に置くと、lint が書いた `entries/` を guard が違反と判定する。lint の step に秘密情報を渡さない(下書きに書かれた URL を取りに行くため)。
- **lint は、公開の Web の URL だけを取りに行く。** IP アドレス直書き・localhost・ユーザー名付きの URL は、取りに行かずに不合格にする(`tools/lib/lint.ts` の `isPublicWebUrl`)。
- **Cosense に書き込む URL は、`tools/lib/cosense.ts` の `COSENSE_ORIGIN` と `COSENSE_PROJECT` からしか作らない。** トークンは流用しているアカウントのもので、ほかのプロジェクトにも書ける。ページ名やプロジェクト名を、エージェントが書いた文字列から URL に組み立てない(ページ名は本文の1行目として送るだけ)。
- **`COSENSE_PAT` は cosense-sync の step の `env` にだけ渡す。** トークンは `x-personal-access-token` ヘッダーで送り、転送(redirect)は追わない(別の場所にトークンが付いていかないようにする)。
- **ツッコミとして採用するのは、`HUMAN_USER_IDS` の行だけ。** 「エージェント以外」ではなく、人間のアカウントの許可リストで絞る。inbox の中身はエージェントへの指摘として扱われるので、ここが信頼の境目になる。
- **cosense-sync は、エージェント以外の行を消さない・書き換えない。** 差し替える範囲に他人の行があれば、末尾に足すだけにする(`planPage`)。設定・メンバーのページ(`RESERVED_TITLES`)には書かない。
- **用語ページの書式(`formatPageBody`)を変えたら、`PAGE_FORMAT` の数を上げる。** 上げないと、送信済みのページは古い書式のまま残る(ファイルが変わったときにしか送らないため)。上げると、次の起床で全部の用語ページが1回だけ送り直される。
- **cosense-sync は失敗しても終了コードを 0 にする。** 止めると、同じ起床の日記や行動ログが commit されない。失敗は journal の `cosense` の行で分かる。
- **Claude の step のモデルは `--model opus` で Opus に固定している。** 外すと契約の既定(2026-11-24 時点では claude-sonnet-5-5)になる。`opus` は別名で、新しい Opus が出るとそちらに切り替わる(2026-11-24 時点では claude-opus-5-5)。版まで固定するなら、モデルの正式な名前を書く。
- **権限は job ごとに付ける。** エージェントが動く `beat` job は `contents: write` だけ、`deploy` job は `pages: write` と `id-token: write` だけ。ワークフロー全体の `permissions` に足さない。
- **デプロイするかどうかは「公開中のサイトの `build.json` と、今回の出力のハッシュが違うか」で決める。** コミットの差分で決めると、人間が push したサイト雛形の変更を拾えないため。`build.json` の `builtAt` はハッシュに含めない(含めると毎回デプロイになる)。Atom の日時も日記の日付から作り、ビルド時刻を使わない。
- **サイトは日記の中の生の HTML を通さない。** 日記は AI が外部の記事を読んで書くので、`tools/lib/markdown.ts` は全体をエスケープしてから、http(s) のリンクと強調だけをタグにする。HTML を通す機能を足さない。
- **公開先は `https://gosyujin.com/mokumoku-ai/`。** ユーザーサイト(gosyujin.github.io)に独自ドメインがあるため。`tools/build.ts` の `DEFAULT_SITE_URL` に書いてあり、Atom の URL と `build.json` の取得に使う。HTML 内のリンクは相対パスなので、ドメインが変わっても表示は壊れない。

## 段階4以降で決めること

- `[gi-yoza.icon]` を表示するには、Cosense のプロジェクトに、画像つきの `gi-yoza` ページが要る(人間が用意する。エージェントには書かせていない)。無くても送れるが、アイコンは出ない。
- エージェントは `RULES.md` を書けないので、「ツッコミで直されたらルールに反映する」(RULES.md)は、まだ返信と journal のメモまで。
- guard の禁止側に `site/` を入れる(サイト雛形をエージェントに書き換えさせない)。
- guard は `state/` 全体を許可すると、エージェントが `cursor.json` の起動回数や `seen.json` を書き換えられる。`cursor.json` `seen.json` `known.txt` `inbox/` は禁止側に入れる想定。
- エージェントは、いまは `state/` を書けない。`questions.md` に語を足せないので、疑問キューを理由にした起床はまだ起きない。`candidates.json` の「読んだかどうか」も更新できず、既読は journal から読み取っている。
- 21時以降の「今日の日記が未作成」は `entries/` を見ている。エージェントが印を付けない日は、21時以降の起床が毎回 `act=true` になる。
- はてブは入れ替わりが速い。新着があるたびに `act=true` になるので、午前中に12回を使い切る可能性がある。段階3の journal で実際の頻度を見てから、はてブ単独では起こさない等の調整を決める。
- 疑問キューが残っている間は毎回 `act=true` になる。掘るのは1日2語までなので、キュー残だけを理由にする回数は絞る余地がある。

## 未検証

実機確認が必要で、まだ確かめていないもの。確認できたら消し、CHANGELOG に「確認済み」と1行残す。

- Claude の step の制限が、Actions 上でも拒否として働くこと。20:57 の回は成功したが、許可の外に触れようとする場面が無かった(拒否0件)。手元の `claude` では同じ引数で拒否を確認済みで、すり抜けた場合は guard が止める。
- `claude setup-token` のトークンで WebSearch が使えること(公式ドキュメントに記載なし。20:57 の回は記事の取得だけで足りたらしく、検索を使ったかはログから分からない)。
- 1日の利用枠への影響。1回の起動は、claude-sonnet-5-5 で12ターン・約35秒・概算 0.10 ドル相当(Actions)、claude-opus-5-5 で16ターン・約70秒・概算 0.34 ドル相当(Actions)だった。契約の枠が1日でどれだけ減るかは見ていない。
- lint の Actions 上での動作と、エージェント自身による公開。最初の日記(2026-11-24 付け)は、人間が印を付けて lint を手元から実行した。`entries/` が増えたあとの build とデプロイは Actions 上で確認済み。エージェントが `status: ready` を付ける → Actions 上の lint が合格させる、という部分はまだ動いていない。
- 追記(`kind: addendum`)と、公開後に翌日の下書きへ書く動き。lint の追記は手元で確かめたが、エージェントが指示どおりに書き分けるかは見ていない。
- Cosense への書き込みのうち、人間の行と重なったときの追記と、ツッコミへの返信。新しい用語ページの作成、既存ページの更新(行を足す)、トークンの持ち主の確認は、2026-11-25 に Actions 上で確かめた。行を消す更新は、まだ実際には動いていない。
- 文体の指示(自分のことを書く文・用語ページ・journal の理由とメモは、丁寧語で終える)の効き方。2026-11-25 に指示書を直したが、直したあとにエージェントが書いたものはまだ無い(既存の日記・用語ページ・journal は人間側で直した)。
- 実際のツッコミのページの読み取り。プロジェクトにまだツッコミのページが無い。ページ一覧と `known.txt` は、実際の Cosense で確かめた。
- 単体テスト(`node --test`)の Node.js での実行。手元の Node.js は 20 のため、Deno 1.41 で代用した。
- schedule(cron)からの起動。手動実行(workflow_dispatch)だけ確認した。
- `⚠間隔超過` が Actions 上の journal に出ること(まだ45分を超える空きが起きていない)。
- Mac のスリープ明けの launchd の挙動(寝ている間の起床が、明けたあとにどう扱われるか)。起きている間の定時起動は確認済み。
- schedule の遅延の大きさ(遅れ方によっては launchd の起床と20分以上離れ、両方が動く)。
