# セットアップ

## 1. GitHub(段階2: LLM なしで heartbeat を回す)

1. リポジトリ `gosyujin/mokumoku-ai` を公開で作り、main に push する。
2. Actions タブで heartbeat を手動実行する(Run workflow)。稼働時間は JST 7:00〜23:30。
3. 確認すること:
   - `state/cursor.json` `state/seen.json` `state/candidates.json` と `journal/今日.md` が commit される。
   - 20分以内にもう一度実行すると、commit が増えない(ログに「二重起動とみなして何もしない」)。
   - 30分以上あけて実行すると、journal に1行増える。

止めたいときは、Settings → Secrets and variables → Actions → Variables で `MOKUMOKU_PAUSED` を `true` にする。

## 2. GitHub Pages

1. Settings → Pages → Build and deployment の Source を「GitHub Actions」にする。
2. heartbeat を、`deploy` を有効にして手動実行する。

   ```bash
   gh workflow run heartbeat.yml --repo gosyujin/mokumoku-ai -f deploy=true
   ```

3. https://gosyujin.com/mokumoku-ai/ を開き、フッターの「最終起床」に時刻が出ることを確かめる。

以後は、日記(entries/)かサイト雛形(site/・tools/build.ts)が変わった次の起床で自動的に公開される。

## 3. Mac の pinger(段階3)

1. fine-grained PAT を発行する。対象リポジトリは mokumoku-ai の1つだけ、権限は Actions: Read and write。
2. Keychain に入れる(値は対話で入力する。コマンド履歴に残さない)。

   ```bash
   security add-generic-password -s mokumoku-pinger -a "$USER" -w
   ```

3. スクリプトを置く。

   ```bash
   mkdir -p ~/bin && cp ops/launchd/mokumoku-ping.sh ~/bin/ && chmod +x ~/bin/mokumoku-ping.sh
   ```

4. plist の `/Users/ユーザー名/` を自分のホームに書き換えて置く。

   ```bash
   sed "s|/Users/ユーザー名/|$HOME/|" ops/launchd/com.gosyujin.mokumoku-ping.plist > ~/Library/LaunchAgents/com.gosyujin.mokumoku-ping.plist
   ```

5. 登録する。

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gosyujin.mokumoku-ping.plist
   ```

6. 1〜2日おいて journal を見る。`dispatch` の行が30分おきに並び、`⚠間隔超過` が無ければ欠落なし。
   `schedule` の行が出ている時間帯は、Mac が寝ていて保険が動いた回。
   失敗の原因は `/tmp/mokumoku-ping.err` に出る。

解除:

```bash
launchctl bootout gui/$(id -u)/com.gosyujin.mokumoku-ping
```

## 4. エージェント(段階4: Claude の step)

1. 手元のターミナルで、Claude のトークンを発行する(ブラウザで承認すると、長いトークンが表示される)。

   ```bash
   claude setup-token
   ```

2. GitHub の Secret に入れる(値は対話で貼り付ける。コマンド履歴やチャットに残さない)。

   ```bash
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo gosyujin/mokumoku-ai
   ```

3. エージェントを有効にする。

   ```bash
   gh variable set MOKUMOKU_AGENT --body on --repo gosyujin/mokumoku-ai
   ```

4. 次に `act=true` になった起床で、確認すること:
   - Actions のログで、エージェントの step と guard が成功している。
   - `agent: …` という commit が増え、journal の wake の行の下に「行動」「理由」が書かれている。
   - 書いた回は `drafts/YYYY-MM-DD.md` ができている(「何もしない」を選んだ回は journal だけ)。

エージェントだけ止めるときは、変数を `off` にする(wake と記録は続く)。

```bash
gh variable set MOKUMOKU_AGENT --body off --repo gosyujin/mokumoku-ai
```

## 5. Cosense(段階6)

前提: Cosense のプロジェクト `mokumoku-ai`(公開)に、人間のアカウント(gosyujin)とエージェント用のアカウント(satoca)がメンバーとして入っている。

1. エージェント用のアカウント(satoca)で発行したトークンを、GitHub の Secret に入れる(クリップボード経由。チャットやコマンド履歴に残さない)。

   ```bash
   pbpaste | tr -d '\n ' | gh secret set COSENSE_PAT --repo gosyujin/mokumoku-ai
   ```

2. 署名のアイコンを出したい場合は、Cosense に `gi-yoza` というページを作り、画像を貼る(無くても動くが、`[gi-yoza.icon]` が絵にならない)。
3. 確認すること:
   - エージェントが語を掘った回のあと、journal に `- HH:MM cosense cosense/pages/語.txt → 作成した(URL)` の行が出て、Cosense にページができている。
   - 日記の末尾のリンクから「yyyy年M月d日のツッコミ」のページを作って何か書くと、次の起床の理由に「ツッコミ 新着1」が出て、`state/inbox/` に転記される。エージェントが返信すると、同じページの末尾に `[gi-yoza.icon]` つきの行が足される。

トークンを入れるまでは、cosense-sync は何も送らない(送るつもりの内容をログに出すだけ)。

メンバーを変えたときは、`tools/lib/cosense.ts` の `HUMAN_USER_IDS`・`AGENT_USER_ID`・`RESERVED_TITLES` を直す。userId は次で分かる。

```bash
curl -s https://scrapbox.io/api/projects/mokumoku-ai/users
```
