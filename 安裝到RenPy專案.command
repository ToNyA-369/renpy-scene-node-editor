#!/bin/zsh

set -e

PACKAGE_DIR="${0:A:h}"

TARGET="$(osascript -e 'POSIX path of (choose folder with prompt "選擇 Ren’Py 專案資料夾，或其中的 game 資料夾")' 2>/dev/null)" || exit 0

python3 "$PACKAGE_DIR/tools/install.py" "$TARGET" --launch

echo ""
echo "安裝完成，已開啟專案專屬的 Scene Node Editor。"
sleep 2
