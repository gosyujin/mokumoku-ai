#!/bin/zsh
# Mac から heartbeat を起こす(毎時7分・37分に launchd が呼ぶ)。
# 置き場所: ~/bin/mokumoku-ping.sh   登録手順: docs/setup.md
h=$(date +%H)
(( 10#$h < 7 )) && exit 0   # 7時より前は呼ばない(23:30 以降は wake 側が何もせず終わる)
export GH_TOKEN=$(security find-generic-password -s mokumoku-pinger -w)
/opt/homebrew/bin/gh workflow run heartbeat.yml \
  --repo gosyujin/mokumoku-ai --ref main
