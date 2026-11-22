#!/bin/bash
# ダブルクリックでハヤトを起動します（Mac）。動いている間はMacがスリープしないようにします。
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
caffeinate -i npm start
