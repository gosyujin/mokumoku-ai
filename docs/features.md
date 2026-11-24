# 機能の詳細

README には機能ごとに一行だけ書き、挙動の詳細はここに書く。

## 実装の現在地

各段階で動作確認してから次へ進む。

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | リポジトリ、SOUL.md(境界のみ)・RULES.md・ディレクトリ | 作成済み |
| 2 | wake(フィード3本の新着検出と cursor.json)。LLM なしで heartbeat を回す | 稼働中(2026-11-24 に手動実行で確認。schedule も有効) |
| 3 | launchd を登録し、1〜2日、起床の欠落を journal で確認 | 2026-11-24 に登録済み。journal を観察中 |
| 4 | Claude の step を追加。書き込み先は drafts/ と journal/ のみ | 未着手 |
| 5 | guard と lint、Pages へのデプロイ | build とデプロイは稼働中(2026-11-24 に公開を確認)。guard と lint は未着手 |
| 6 | Cosense 連携(cosense-sync とツッコミの読み取り) | 未着手 |
| 7 | 人格を決めて SOUL.md に書く | 未着手 |

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

未実装: Cosense のツッコミページの更新検知、`state/known.txt` の更新(段階6)。

### state/ のファイル

| ファイル | 書く人 | 中身 |
|---|---|---|
| `cursor.json` | wake | 最終起床時刻・前回からの経過分・起床理由・本日の起動回数 |
| `seen.json` | wake | フィードごとの既読 URL(最大500件)と ETag |
| `candidates.json` | wake | 未読の候補(フィード名・優先度・タイトル・URL・提示済みか) |
| `questions.md` | エージェント | 未知ワード・疑問のキュー |
| `interests.md` | エージェント | 興味リスト |
| `known.txt` | wake(段階6) | Cosense のページ名一覧 |
| `inbox/` | wake(段階6) | ツッコミの転記 |

### commit(`tools/commit.ts`)

`state/ journal/ drafts/ entries/ cosense/ RULES.md` の変更だけを main に commit し、`pull --rebase` してから push する(失敗したら3回までやり直す)。変更が無ければ何もしない。GitHub Actions の外では、`--local` を付けない限り動かない。

### build(`tools/build.ts`)

`entries/YYYY-MM-DD.md` から静的サイトを `_site/` に作る。

- 出力: `index.html`(一覧)、`entries/YYYY-MM-DD.html`(記事)、`atom.xml`(新しい順に20件)、`site/` の中身(CSS・JS)、`build.json`。
- 日記の形式: 先頭に front matter(`title` / `date` / `sources` / `terms`)。タイトルは front matter、無ければ本文先頭の `# 見出し`、それも無ければ日付。
- Markdown は見出し・段落・箇条書き・番号付き・引用・コードブロック・`コード`・**強調**・リンクだけに対応する。生の HTML は文字として表示する。
- 記事の末尾に、`sources` の一覧、`terms` の用語ページ(Cosense)へのリンク、その日の「yyyy年M月d日のツッコミ」ページへのリンクを付ける。
- フッターの最終起床時刻は、ブラウザが `state/cursor.json` を直接読んで表示する(`site/footer.js`)。
- 出力の中身からハッシュを作り、公開中のサイトの `build.json` と比べる。違うときだけ `deploy=true` を出力する。

### heartbeat(`.github/workflows/heartbeat.yml`)

起動は schedule(毎時22分・52分)と workflow_dispatch だけ。Repository variable `MOKUMOKU_PAUSED` を `true` にすると止まる。

- `beat` job: wake → commit → build。`deploy=true` のときだけサイトを artifact として上げる。
- `deploy` job: `beat` が `deploy=true` を出したときだけ GitHub Pages に公開する。
- 手動で公開し直すときは、実行時に `deploy` を有効にする(中身が同じでも公開する)。wake の関門(稼働時間外・20分未満)に関係なく動く。

  ```bash
  gh workflow run heartbeat.yml --repo gosyujin/mokumoku-ai -f deploy=true
  ```
