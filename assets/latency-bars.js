/* Where the video latency actually goes.
 *
 * Every number here is a stage mean from the paper's own harness —
 * experiments/glass_to_glass/results/summary.json, 5 trials of 301 frames per
 * transport, frame ids recovered from the DECODED image so a frame only counts
 * if it survived the whole chain. Nothing is apportioned by eye.
 *
 *   g2g = capture + pipeline + present,  pipeline = encode + transport + decode
 *
 * `present` is the one declared term: 1.5 refresh intervals at 90 Hz on the
 * visionOS compositor. It is labelled as declared in the tooltip, because
 * quietly mixing a modelled number into measured ones is how latency charts
 * lie.
 *
 * Hover (or tap, or tab to) a segment and it names itself with its own
 * milliseconds and its share of that path.
 */
(function () {
  var host = document.getElementById('latencyBars');
  if (!host) return;

  /* stage name → [colour, what it is] */
  var STAGE = {
    capture:   ['#23577E', 'Sensor exposure and readout on the robot. Identical on ' +
                           'every path — the camera does not care where you are.'],
    encode:    ['#C6301A', 'Turning the frame into bytes.'],
    transport: ['#F0762E', 'On the wire: propagation, jitter and serialisation, ' +
                           'shaped from a link measured by linkprobe.py.'],
    decode:    ['#2E7D4F', 'Bytes back into pixels on the operator’s machine.'],
    present:   ['#D9A13F', 'Waiting for the display to show it. DECLARED, not ' +
                           'measured: 1.5 refresh intervals at 90 Hz.']
  };

  var PATHS = [
    { key: 'local', name: 'Same host', total: 48.5,
      sub: 'the robot’s own screen · UDP/JPEG 960×720',
      stages: { capture: 26.479, encode: 2.034, transport: 1.457,
                decode: 1.867, present: 16.7 },
      note: 'Nothing but the pipeline. The camera itself is now the biggest ' +
            'single cost on the path.' },
    { key: 'lan', name: 'Over the LAN', total: 82.3,
      sub: 'headset on the same Wi-Fi · UDP/JPEG 960×720',
      stages: { capture: 26.479, encode: 2.122, transport: 35.001,
                decode: 2.034, present: 16.7 },
      note: 'The wire costs 35 ms and everything else is unchanged. This is ' +
            'the number the paper quotes for a working session.' },
    { key: 'relay', name: 'Public relay', total: 362.3,
      sub: 'other side of the planet · TCP/H.264 640×480',
      stages: { capture: 26.479, encode: 214.015, transport: 104.087,
                decode: 1.005, present: 16.7 },
      note: 'The relay is NOT mostly distance. 214 ms of it is the hardware ' +
            'H.264 encoder buffering frames — swap in libx264 -tune ' +
            'zerolatency over the same link and the whole path drops to 150 ms.' }
  ];

  var MAX = 362.3;

  var html = '<div class="lb-head"><span class="lb-title">Glass to glass</span>' +
    '<span class="lb-sub">camera photon → operator’s pixel, 5 × 301 frames per path</span></div>' +
    '<div class="lb-rows">';
  PATHS.forEach(function (p) {
    html += '<div class="lb-row" data-path="' + p.key + '">' +
      '<div class="lb-label"><b>' + p.name + '</b><i>' + p.sub + '</i></div>' +
      '<div class="lb-track">';
    Object.keys(p.stages).forEach(function (s) {
      var ms = p.stages[s];
      var pct = (ms / MAX) * 100;
      html += '<button class="lb-seg" type="button" data-stage="' + s + '" ' +
        'data-path="' + p.key + '" style="width:' + pct.toFixed(3) + '%;' +
        'background:' + STAGE[s][0] + '" ' +
        'aria-label="' + p.name + ', ' + s + ', ' + ms.toFixed(1) + ' milliseconds">' +
        '<span>' + (pct > 7 ? s : '') + '</span></button>';
    });
    html += '</div><div class="lb-total">' + p.total.toFixed(0) + ' ms</div></div>';
  });
  html += '</div><div class="lb-key">';
  Object.keys(STAGE).forEach(function (s) {
    html += '<span class="lb-k"><i style="background:' + STAGE[s][0] + '"></i>' + s + '</span>';
  });
  html += '</div><p class="lb-foot">Hover a block for what it is and what it cost. ' +
    'Source: <code>experiments/glass_to_glass/results/summary.json</code>.</p>' +
    '<div class="lb-tip" hidden></div>';
  host.innerHTML = html;

  var tip = host.querySelector('.lb-tip');

  function show(btn) {
    var s = btn.dataset.stage;
    var p = PATHS.filter(function (x) { return x.key === btn.dataset.path; })[0];
    var ms = p.stages[s];
    var share = (ms / p.total) * 100;
    tip.innerHTML =
      '<span class="lb-tip-path">' + p.name + '</span>' +
      '<span class="lb-tip-stage" style="color:' + STAGE[s][0] + '">' + s + '</span>' +
      '<span class="lb-tip-ms">' + ms.toFixed(1) + ' ms</span>' +
      '<span class="lb-tip-share">' + share.toFixed(0) + '% of this path’s ' +
        p.total.toFixed(0) + ' ms</span>' +
      '<span class="lb-tip-what">' + STAGE[s][1] + '</span>' +
      (s === 'encode' || s === 'transport'
        ? '<span class="lb-tip-note">' + p.note + '</span>' : '');
    tip.hidden = false;
    /* park it above the segment, kept inside the widget */
    var hb = host.getBoundingClientRect(), b = btn.getBoundingClientRect();
    var w = tip.offsetWidth;
    var x = b.left - hb.left + b.width / 2 - w / 2;
    tip.style.left = Math.max(6, Math.min(hb.width - w - 6, x)) + 'px';
    tip.style.top = (b.top - hb.top - tip.offsetHeight - 12) + 'px';
    host.querySelectorAll('.lb-seg').forEach(function (o) {
      o.classList.toggle('dim', o !== btn);
    });
  }
  function hide() {
    tip.hidden = true;
    host.querySelectorAll('.lb-seg').forEach(function (o) { o.classList.remove('dim'); });
  }

  host.addEventListener('pointerover', function (e) {
    var b = e.target.closest('.lb-seg');
    if (b) show(b);
  });
  host.addEventListener('pointerleave', hide);
  host.addEventListener('focusin', function (e) {
    var b = e.target.closest('.lb-seg');
    if (b) show(b);
  });
  host.addEventListener('focusout', hide);
  /* touch: a tap holds the readout until the next tap elsewhere */
  host.addEventListener('click', function (e) {
    var b = e.target.closest('.lb-seg');
    if (b) show(b); else hide();
  });

  window.__latencyBars = { paths: PATHS, show: show, hide: hide };
})();
