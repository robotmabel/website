#!/usr/bin/env bash
# Every check for the site, in one command. Serve first:
#   python3 -m http.server 8741   (from website/)
set -u
B="${1:-http://localhost:8741}"
cd "$(dirname "$0")/.."
pass=0; fail=0
run () {
  printf '── %-18s ' "$1"; shift
  out=$("$@" 2>&1)
  if grep -q "RESULT: PASS" <<<"$out"; then echo "PASS"; pass=$((pass+1))
  elif grep -qE "TOTAL (OVERLAPS|SCROLLING TABLES): 0" <<<"$out"; then echo "PASS"; pass=$((pass+1))
  else echo "FAIL"; fail=$((fail+1)); sed 's/^/      /' <<<"$out" | tail -6; fi
}
P=python3
run structure   $P scripts/structure.py $B/index.html $B/build.html $B/software.html \
                   $B/teleop.html $B/connect.html $B/hardware.html $B/autonomy.html \
                   $B/anatomy.html $B/simulator.html
run tables      $P scripts/tablescroll.py $B/index.html $B/build.html $B/software.html \
                   $B/teleop.html $B/autonomy.html $B/hardware.html $B/connect.html
run stickers    $P scripts/stickers.py $B/index.html $B/build.html $B/software.html \
                   $B/teleop.html $B/connect.html $B/autonomy.html
run popups      $P scripts/poptest.py $B/index.html $B/build.html
run bom-hover   $P scripts/hovertest.py $B/build.html
run bom-groups  $P scripts/bomgroup.py $B/build.html
run films       $P scripts/filmtest.py $B/connect.html
run palm-track  $P scripts/tracktest.py $B/software.html
run lab-table   $P scripts/labtable.py $B/software.html
run globe       $P scripts/globecentre.py $B/teleop.html
run webcam      $P scripts/camtest.py $B/software.html
run figures     $P scripts/figscale.py $B/index.html
run panels      $P scripts/panels.py $B/build.html
echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
