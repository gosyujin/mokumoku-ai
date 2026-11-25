---
paths:
  - "tools/cosense-sync.ts"
  - "tools/lib/cosense*.ts"
  - "cosense/**"
---
# Cosense 連携

- 書き込む URL は `COSENSE_ORIGIN` と `COSENSE_PROJECT`(定数)からしか作らない。トークンは流用のアカウントのもので、ほかのプロジェクトにも書けるため。
- `COSENSE_PAT` は cosense-sync の step にだけ渡す。トークンを付けた要求は redirect を追わない。ログや journal にトークンを出さない。
- ツッコミとして採用するのは `HUMAN_USER_IDS` の行だけ(許可リスト)。「エージェント以外」に広げない。
- エージェント以外の行を消す・書き換える変更を作らない。`RESERVED_TITLES` のページには書かない。
- 用語ページの書式(`formatPageBody`: ページ名の次は空行、区切りは空行1つ、末尾は空行1つ。`tidyLines`: 1行1文、全角記号は半角)を変えたら、`PAGE_FORMAT` の数を上げる(上げないと送り直されない)。
- 送るときの整形は、人間が書いた行に当てない(当てると、その行を消して書き直す変更になる)。
- cosense-sync は失敗しても終了コード 0 で終わる(日記や行動ログの commit を止めない)。
- `cosense/pages/`・`cosense/append/` はエージェントが書く場所。手元で試したファイルを commit しない。
- 詳細: [docs/technical-notes.md](../../docs/technical-notes.md)、[docs/decisions/2026-11-24-cosense.md](../../docs/decisions/2026-11-24-cosense.md)
