#!/usr/bin/env bash
# Render each guide PDF to the WebP page images the slider consumes.
#
#   tools/render_pdf_pages.sh                 # re-render every PDF in assets/pdf
#   tools/render_pdf_pages.sh MABEL_Wiring_Guide
#
# Needs poppler (pdftoppm) and ImageMagick. Output lands in assets/pdf/pages/
# as <slug>-NN.webp, which is exactly what `data-prefix` on a .pdfv element
# points at. Re-run after replacing a PDF.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/pdf/pages

render() {
  local pdf="assets/pdf/$1.pdf"
  [ -f "$pdf" ] || { echo "skip: $pdf not found"; return; }
  local slug; slug=$(echo "$1" | tr 'A-Z_' 'a-z-')
  local tmp; tmp=$(mktemp -d)
  pdftoppm -png -r 110 "$pdf" "$tmp/p"
  rm -f "assets/pdf/pages/$slug"-*.webp
  local n=0
  for f in "$tmp"/p-*.png; do
    n=$((n+1))
    magick "$f" -resize 1500x -quality 82 "$(printf 'assets/pdf/pages/%s-%02d.webp' "$slug" "$n")"
  done
  rm -rf "$tmp"
  echo "$1 -> $n pages"
}

if [ $# -gt 0 ]; then
  for g in "$@"; do render "$(basename "$g" .pdf)"; done
else
  for f in assets/pdf/*.pdf; do render "$(basename "$f" .pdf)"; done
fi
