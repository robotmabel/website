#!/usr/bin/env bash
# Every check for the site, in one command. Serve first:
#   python3 -m http.server 8741   (from website/)
set -u
B="${1:-http://localhost:8741}"
cd "$(dirname "$0")/.."
pass=0; fail=0
ok () {
  grep -q "RESULT: PASS" <<<"$1" || grep -qE "TOTAL (OVERLAPS|SCROLLING TABLES): 0" <<<"$1"
}
# ONE RETRY, and it is not papering over anything. Every check drives its own
# headless Chrome, and back to back a launch occasionally loses the race for a
# debugging port or a profile lock — the failure then reads "the widget never
# initialised" or "list index out of range", never anything about the site.
# Four checks failed that way in one run and all four passed alone. A real
# failure fails twice.
run () {
  printf '── %-14s ' "$1"; shift
  out=$("$@" 2>&1)
  if ok "$out"; then echo "PASS"; pass=$((pass+1)); return; fi
  sleep 2
  out=$("$@" 2>&1)
  if ok "$out"; then echo "PASS (on retry)"; pass=$((pass+1)); return; fi
  echo "FAIL"; fail=$((fail+1)); sed 's/^/      /' <<<"$out" | tail -8
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
run lab-rig     $P scripts/labrig.py $B/software.html
run globe       $P scripts/globecentre.py $B/teleop.html
run webcam      $P scripts/camtest.py $B/software.html
run gestures    node scripts/gesturetest.mjs
run retargeter  $P scripts/sync_bodyteleop.py --check
run hardware    $P scripts/hwtest.py $B/hardware.html
run curation    $P scripts/curtest.py $B/autonomy.html
run scenes      $P scripts/scenetest.py $B/software.html
run figures     $P scripts/figscale.py $B/index.html
run panels      $P scripts/panels.py $B/build.html
run css         $P scripts/csscheck.py
run page-weight $P scripts/loadtest.py
run platforms   $P scripts/pttest.py $B/index.html
run stack-map   $P scripts/smtest.py $B/index.html
run accuracy    $P scripts/acctest.py $B/hardware.html
run retarget-tv $P scripts/rktest.py $B/software.html
echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
