/* Hardware light-test results, exported from the same archive as the active paper. */
(function () {
  var host = document.getElementById('latencyBars');
  if (!host) return;

  /* stage name → [colour, what it is] */
  var STAGE = {
    capture:['var(--blue)','Camera exposure, readout and upstream capture latency. Inferred as the light-test total minus the downstream stages.'],
    encode:['var(--rust)','Measured H.264 encoding time on the robot.'],
    transport:['var(--hi)','Measured frame transport over this connection.'],
    decode:['var(--green)','Measured decoding time in the operator browser.'],
    present:['var(--gold)','Measured browser presentation contribution; no fixed headset-refresh allowance is added.']
  };
  fetch('assets/data/latency.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error('latency data');return r.json();}).then(function(DATA){
  var PATHS=DATA.paths;
  var MAX=Math.max.apply(null,PATHS.map(function(p){return p.total;}));
  var html = '<div class="lb-head"><span class="lb-title">Glass to glass</span>' +
    '<span class="lb-sub">camera photon → operator pixel · hardware light tests · 27 Oct 2026</span></div>' +
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
    html += '</div><div class="lb-total">' + p.label + '</div></div>';
  });
  html += '</div><div class="lb-key">';
  Object.keys(STAGE).forEach(function (s) {
    html += '<span class="lb-k"><i style="background:' + STAGE[s][0] + '"></i>' + s + '</span>';
  });
  html += '</div><p class="lb-foot">Hover a block for what it is and what it cost. ' +
    'Mean ± s.d. of trial medians: 3 × 20 s for hotspot/LAN, 4 × 20 s for Tailscale. The relay total is partly derived. <a href="assets/data/latency.json">Measured data ↗</a> · <a href="index.html#cite">Paper ↗</a>.</p>' +
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
      '<span class="lb-tip-share">' + share.toFixed(0) + '% of this path’s ' + p.label + '</span>' +
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

  window.__latencyBars = { paths: PATHS, data:DATA,show: show, hide: hide };
  }).catch(function(){host.innerHTML='<p>Latency data could not load. <a href="index.html#cite">See the paper.</a></p>';});
})();
