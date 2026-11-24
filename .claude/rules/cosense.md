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
- cosense-sync は失敗しても終了コード 0 で終わる(日記や行動ログの commit を止めない)。
- `cosense/pages/`・`cosense/append/` はエージェントが書く場所。手元で試したファイルを commit しない。
- 詳細: [docs/technical-notes.md](../../docs/technical-notes.md)、[docs/decisions/2026-11-24-cosense.md](../../docs/decisions/2026-11-24-cosense.md)
