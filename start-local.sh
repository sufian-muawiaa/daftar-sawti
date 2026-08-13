#!/usr/bin/env bash
# دفتر الديون الصوتي — تشغيل خادم محلي فوري (ماك / لينكس)
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "  دفتر الديون الصوتي - جاري تشغيل الخادم المحلي..."
echo "=================================================="

if command -v python3 &>/dev/null; then
    python3 serve.py
elif command -v python &>/dev/null; then
    python serve.py
elif command -v node &>/dev/null; then
    npx --yes serve . -l 5173
else
    echo ""
    echo "لم يتم العثور على Python أو Node.js على جهازك."
    echo "ثبّت أحدهما ثم أعد المحاولة، أو انشر المجلد مباشرة على https://app.netlify.com"
    exit 1
fi
