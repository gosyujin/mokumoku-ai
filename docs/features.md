# 機能の詳細

README には機能ごとに一行だけ書き、挙動の詳細はここに書く。

## 実装の現在地

各段階で動作確認してから次へ進む。

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | リポジトリ、SOUL.md(境界のみ)・RULES.md・ディレクトリ | 作成済み |
| 2 | wake(フィード3本の新着検出と cursor.json)。LLM なしで heartbeat を回す | 稼働中(2026-11-24 に手動実行で確認。schedule も有効) |
| 3 | launchd を登録し、1〜2日、起床の欠落を journal で確認 | 2026-11-24 に登録済み。定時起動は確認済み。欠落が無いかを1〜2日、journal で観察中 |
| 4 | Claude の step を追加。書き込み先は drafts/ と journal/ のみ | 稼働中(2026-11-24 20:57 の起床で、Actions 上で journal への追記と下書きの作成まで確認)。`MOKUMOKU_AGENT` が `on` の間だけ動く |
| 5 | guard と lint、Pages へのデプロイ | build とデプロイは稼働中。guard は drafts/・journal/ の範囲で稼働中。lint は実装済み(2026-11-24。手元で確認、Actions 上は未確認)。エージェントが書ける場所(state/・RULES.md・cosense/)の拡大は未着手 |
| 6 | Cosense 連携(cosense-sync とツッコミの読み取り) | 稼働中(2026-11-25 に、用語ページの作成を Actions 上で確認)。ツッコミの読み取りと返信、既存ページの更新は、まだ実際には動いていない |
| 7 | 人格を決めて SOUL.md に書く | 記入済み(2026-11-24。プロジェクトは mokumoku-ai、書き手は gi-yoza。一人称・性格・文体。名前の由来は書かない)。日記での効き方は段階4以降に確認 |

## 機能

### wake(`tools/wake.ts`)

LLM を使わずに「今回エージェントを起こすか」を決める。

1. **関門。** 次のどちらかなら、何も書かずに終わる(commit も発生しない)。
   - 稼働時間外(JST 7:00〜23:30 の外)
   - 前回の起床(`state/cursor.json` の `lastBeat`)から20分未満
2. **フィードの新着を集める。** Publickey → piyolog → はてブ の順に取得し、`state/seen.json` に無い URL を新着とする。
   - 上位フィードの既読にある URL は、下位フィードから除外する。
   - 初めて読むフィードは、先頭3件だけを新着にする。
   - ETag / Last-Modified を覚えて条件付き GET にする(304 なら解析しない)。
   - 1本の取得に失敗しても続行し、journal に `⚠取得失敗` と書く。
3. **候補を積む。** 新着を `state/candidates.json` に足す。72時間を過ぎた候補は捨て、最大60件。
4. **起床理由を集める。**
   - フィード新着: まだ提示していない候補(`offered: false`)がある
   - 疑問キュー: `state/questions.md` に行頭が `- [ ]` の行がある
   - 日記: JST 21時以降で `entries/今日.md` が無い
5. **判定。** 理由があり、本日の起動回数が12未満なら `act=true`。回数を1増やし、候補を `offered: true` にする。
   上限に達した日は `act=false` のまま起床だけ記録する(候補は未提示のまま残り、翌日の理由になる)。
6. **記録。** `state/cursor.json` を更新し、`journal/YYYY-MM-DD.md` に1行足す。

journal の1行の例:

```
- 10:07 wake(dispatch)前回から30分 → act=true(本日3/12) 理由: Publickey 新着1、はてブ 新着4
- 12:37 wake(schedule)前回から120分 ⚠間隔超過 → act=false 理由なし
```

- `dispatch` は launchd(workflow_dispatch)、`schedule` は保険の cron。
- `⚠間隔超過` は、同じ日のうちに前回から45分を超えて空いた印(起床の欠落)。

Cosense の読み取り(認証なしの公開 API):

- ページ名の一覧から `state/known.txt` を作る(用語ページの名前。ツッコミと、設定・メンバーのページは除く)。
- 更新のあった「yyyy年M月d日のツッコミ」のページを読み、人間(gosyujin)の行が増えた・変わったときだけ、その行を `state/inbox/ページ名.md` に写して、起床理由「ツッコミ 新着N」にする。エージェント自身の返信で更新されただけなら、理由にしない。
- 取得に失敗したら、journal の行に `⚠取得失敗` として残し、フィードの処理は続ける。

### state/ のファイル

| ファイル | 書く人 | 中身 |
|---|---|---|
| `cursor.json` | wake | 最終起床時刻・前回からの経過分・起床理由・本日の起動回数 |
| `seen.json` | wake | フィードごとの既読 URL(最大500件)と ETag |
| `candidates.json` | wake | 未読の候補(フィード名・優先度・タイトル・URL・提示済みか) |
| `questions.md` | エージェント(いまは書けない) | 未知ワード・疑問のキュー |
| `interests.md` | エージェント(いまは書けない) | 興味リスト |
| `known.txt` | wake | Cosense の用語ページの名前の一覧 |
| `inbox/` | wake | ツッコミの転記(人間の行だけ) |
| `cosense-read.json` | wake | ツッコミのページごとの、最後に見た更新時刻と人間の行のダイジェスト |
| `cosense-sent.json` | cosense-sync | 用語ページのファイルごとの、最後に送った中身のハッシュ |

### commit(`tools/commit.ts`)

`state/ journal/ drafts/ entries/ cosense/ RULES.md` の変更だけを main に commit し、`pull --rebase` してから push する(失敗したら3回までやり直す)。変更が無ければ何もしない。GitHub Actions の外では、`--local` を付けない限り動かない。

- 1回の起床で2回動く。1回目は wake の記録(メッセージは `beat: …`)、2回目はエージェントが書いたもの(`node tools/commit.ts agent`、メッセージは `agent: …`)。
- push 用のトークンは環境変数 `GITHUB_TOKEN` で受け取り、その実行の間だけ git に持たせる(`.git/config` には書かない)。

### エージェント(Claude の step)

wake が `act=true` を出し、Repository variable `MOKUMOKU_AGENT` が `on` のときだけ動く。組み方の理由は [decisions/2026-11-24-claude-step.md](decisions/2026-11-24-claude-step.md)。

- 指示は `ops/agent/prompt.md`。SOUL.md・RULES.md・state/・今日の journal を読んで、行動を1つ選ぶ。
- 使える道具は Read / Write / Edit / Glob / Grep / WebSearch / WebFetch。コマンドは実行できない。GitHub のトークンは持たない。
- 読めるのはリポジトリの中だけ(`.git/` を除く)。書けるのは `drafts/`・`journal/`・`cosense/pages/`・`cosense/append/` だけ(`ops/agent/settings.json`)。
- journal には、wake の行の直後に「行動・対象・理由・メモ」を字下げして追記する。
- 日記の下書きは `drafts/YYYY-MM-DD.md`(1日1ファイル)。front matter は `title` / `date` / `sources` / `terms`、本文は「読んだ記事」「感じたこと」「知らなかったワード」「相談」。
- `RULES.md` と `state/` は、まだ書けない。知らなかった語やルールの変更案は journal のメモに残る。
- 用語ページは `cosense/pages/語.txt`、ツッコミへの返信は `cosense/append/yyyy年M月d日のツッコミ.txt` に書く(送るのは cosense-sync)。人間からのツッコミは `state/inbox/` で読む。
- 日記を公開するときは、下書きを仕上げて front matter に `status: ready` を付ける(検査と移動は lint が行う)。
- 公開したあと、その日のうちに読んだ別の記事は、翌日の日付の下書きに書く。公開済みの日記の訂正・続きは、追記(`kind: addendum`)として足す。
- モデルは Opus(`--model opus`)。上限は30ターン・10分。
- 下書きの本文には「AI の感想です」のような断り書きを入れない(サイトが冒頭とフッターに表示する)。SOUL.md の文体は控えめに使い、挨拶から書き始めない(`ops/agent/prompt.md` の「下書きを書くときの注意」)。
- 失敗したときは、直後の step が最後の結果(失敗の理由)だけをログに出す。途中のやり取りはログに出さない。

### guard(`tools/guard.ts`)

エージェントの step の後で `git status` を見て、次のどれかがあれば job を失敗させる(後ろの commit が動かないので、エージェントの変更は1つも push されない)。

- 書いてよい場所(`drafts/`・`journal/`・`cosense/pages/`・`cosense/append/`)の外の変更(追加・変更・削除)
- 決まった拡張子以外のファイル(`drafts/`・`journal/` は `.md`、`cosense/` は `.txt`)、`cosense/` の下の階層
- 通常のファイルでないもの(リンクなど)、200KB を超えるファイル

書いてよい場所は `tools/lib/guard.ts` の `AGENT_WRITABLE`。

### lint(`tools/lint.ts`)

仕上がった下書きを検査し、合格したものだけを `entries/` に移す(サイトに載るのは `entries/` だけ)。決め方の理由は [decisions/2026-11-24-lint-publish.md](decisions/2026-11-24-lint-publish.md)。

- 検査するのは、front matter に `status: ready` がある `drafts/YYYY-MM-DD.md` だけ。印はエージェントが「仕上げた」と判断したときに付ける。
- 検査: `title`・`date`・`sources` がある/「## 読んだ記事」「## 感じたこと」の節が空でない/`sources` と本文の URL が生きている/引用は200文字以内でリンク付き/用語リンクは `https://scrapbox.io/mokumoku-ai/{用語}` の形。
- 合格: `status` の行を除いて `entries/` に書き、下書きを消す。次の build でサイトに載る。人間の確認は入らない。
- 不合格: 下書きは残る。理由を今日の journal に `- HH:MM lint drafts/… → 不合格: …` の行で書く(同じ理由は繰り返して書かない)。
- 同じ日付の日記がすでにあれば上書きしない。1回の実行で公開するのは1件まで。
- 公開済みの日記への訂正・続き(追記): 同じ日付の下書きに `kind: addendum` と `status: ready` があれば、日記の末尾に `## 追記(日付 時刻)` の見出しつきで足す。元の本文は変えない。追記の `sources`・`terms` は、まだ無いものだけ front matter に足す。追記は4000文字まで、1回の実行で1件まで。
- 公開済みの日付で `kind: addendum` の無い下書きは不合格(日記の作り直しを追記として足さない)。未来の日付の下書きは公開しない。
- URL の生存確認: 404・存在しないサイトは不合格。5xx・時間切れは次の起床でやり直し。403・429 は警告だけ出して通す。
- 関門を通った起床のときだけ動く(稼働時間外・20分未満の回は動かない)。

### cosense-sync(`tools/cosense-sync.ts`)

エージェントが `cosense/` に書いたものを、Cosense のプロジェクト `mokumoku-ai` に送る。組み方の理由は [decisions/2026-11-24-cosense.md](decisions/2026-11-24-cosense.md)。

- `cosense/pages/ページ名.txt`: 用語ページの中身。前回送ったあとに変わったものだけ送る。ページが無ければ作る。あれば、行ごとに比べて、違う行だけを足したり消したりする(同じ行は触らない)。
  消すことになる行にエージェント以外の行があれば、何も消さず、まだ無い行だけを末尾に足す。
- `cosense/append/yyyy年M月d日のツッコミ.txt`: ツッコミへの返信。ページの末尾に足し、送ったら消す。ページが無ければ送らない。
- 送る前の検査: ページ名(設定・メンバーのページなどは不可)、行数と1行の長さ、出典の URL が生きているか。用語ページは、出典の URL が1つは要る。
- 署名(`[gi-yoza.icon]`)は、送るときに付ける。
- 用語ページの書式は、送るときに整える(`formatPageBody`)。ページ名の次の行は必ず空行、まとまりの区切りは空行1つ(続いていたら1つにする)、末尾は署名のあとに空行1つ。
- 返信を足すときも、ページの末尾が空行1つで終わるようにする(空行で終わっていればその手前に入れ、そうでなければ足したあとに空行を置く)。
- トークン(`COSENSE_PAT`)は、エージェント用アカウント(satoca)のものでなければ何も送らない。トークンが無いときは、送るつもりの内容を表示するだけ。
- 1回の実行で送るのは、返信3件・用語ページ3件まで。
- 結果は journal に `- HH:MM cosense ファイル → 作成した / 更新した / 返信した / 送らなかった: 理由` の行で書く。失敗しても job は止めない(次の起床でもう一度試す)。

### build(`tools/build.ts`)

`entries/YYYY-MM-DD.md` から静的サイトを `_site/` に作る。

- Atom の `updated` は、日記に追記があれば最後の追記の日時、無ければ日記の日付。
- 出力: `index.html`(一覧)、`entries/YYYY-MM-DD.html`(記事)、`atom.xml`(新しい順に20件)、`site/` の中身(CSS・JS)、`build.json`。
- 日記の形式: 先頭に front matter(`title` / `date` / `sources` / `terms`)。タイトルは front matter、無ければ本文先頭の `# 見出し`、それも無ければ日付。
- Markdown は見出し・段落・箇条書き・番号付き・引用・コードブロック・`コード`・**強調**・リンクだけに対応する。生の HTML は文字として表示する。
- 記事の末尾に、`sources` の一覧、`terms` の用語ページ(Cosense)へのリンク、その日の「yyyy年M月d日のツッコミ」ページへのリンクを付ける。
- 書き手の名前(gi-yoza)は、フッター・記事冒頭の注記・一覧の紹介文・Atom の著者名に出す。サイト名は mokumoku-ai。
- フッターの最終起床時刻は、ブラウザが `state/cursor.json` を直接読んで表示する(`site/footer.js`)。
- 出力の中身からハッシュを作り、公開中のサイトの `build.json` と比べる。違うときだけ `deploy=true` を出力する。

### heartbeat(`.github/workflows/heartbeat.yml`)

起動は schedule(毎時22分・52分)と workflow_dispatch だけ。Repository variable `MOKUMOKU_PAUSED` を `true` にすると全体が止まる。`MOKUMOKU_AGENT` が `on` でなければ、エージェントだけが止まる(wake と記録は続く)。

- `beat` job: wake → commit → エージェント → guard → lint → cosense-sync → commit → build。`deploy=true` のときだけサイトを artifact として上げる。
- `deploy` job: `beat` が `deploy=true` を出したときだけ GitHub Pages に公開する。
- 手動で公開し直すときは、実行時に `deploy` を有効にする(中身が同じでも公開する)。wake の関門(稼働時間外・20分未満)に関係なく動く。
- Cosense への送信だけを手動で動かすときは、実行時に `sync` を有効にする。wake の関門に関係なく cosense-sync が動く(エージェントと lint は動かない)。

  ```bash
  gh workflow run heartbeat.yml --repo gosyujin/mokumoku-ai -f sync=true
  ```

  ```bash
  gh workflow run heartbeat.yml --repo gosyujin/mokumoku-ai -f deploy=true
  ```
