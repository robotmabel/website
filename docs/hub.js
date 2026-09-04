/* The community hub — the shelf, the challenges, and the boot readout.
 *
 * Everything visible here comes from docs/data/community.json, because the
 * contribution path has to be ONE FILE and a pull request. The moment it takes
 * a build step, an account or an invitation, the people most worth hearing
 * from stop bothering.
 *
 * NOTHING IS INVENTED. The registry ships with the reference build's own
 * entries, each flagged `ours: true`, and the page says out loud that no
 * outside entry has arrived yet. A shelf padded with fictional makers to look
 * busy is the one thing that would make a real one impossible.
 */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ── the boot readout ────────────────────────────────────────────────
     A power-on self-test, typed out. It is a joke with a job: the checks it
     prints are the real inventory of what this manual covers, so by the time
     it finishes a reader knows the scope without having read a sentence. */
  var BOOT = [
    ['MABEL BIOS v1.0', null, 0],
    ['', null, 0],
    ['BILL OF MATERIALS', '$8,722 · 100%', 1],
    ['PRINTED PARTS', 'READY', 1],
    ['SWERVE BASE', '3 MODULES', 1],
    ['ARMS / HANDS', '2×7 + 2×17 DOF', 1],
    ['FIRMWARE', 'TEENSY · PICO · CAN', 1],
    ['ROS 2 JAZZY', 'PRESENT', 1],
    ['MUJOCO SCENES', '40 LOADED', 1],
    ['POLICIES', 'ACT · DiT · π₀', 1],
    ['MANUAL', '10 CHAPTERS', 1],
    ['', null, 0],
    ['CONTRIBUTORS', 'AWAITING INPUT', 2],
  ];
  function boot(el) {
    var i = 0, line = '';
    (function step() {
      if (i >= BOOT.length) {
        el.innerHTML += '\n<span class="bl">READY.</span> <span class="cur">█</span>';
        return;
      }
      var row = BOOT[i++];
      var dots = row[1] ? ' ' + new Array(Math.max(2, 26 - row[0].length))
        .join('.') + ' ' : '';
      line = row[1]
        ? esc(row[0]) + dots + '<span class="v' + row[2] + '">' + esc(row[1]) + '</span>'
        : '<span class="hd">' + esc(row[0]) + '</span>';
      el.innerHTML += (i > 1 ? '\n' : '') + line;
      setTimeout(step, row[0] ? 95 : 40);
    })();
  }
  var bootEl = document.getElementById('boot');
  if (bootEl) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bootEl.innerHTML = BOOT.map(function (r) {
        return r[1] ? esc(r[0]) + ' … ' + esc(r[1]) : esc(r[0]);
      }).join('\n') + '\nREADY.';
    } else {
      boot(bootEl);
    }
  }

  /* ── the four kinds ─────────────────────────────────────────────────── */
  var KINDS = [
    ['build', 'Builds', 'A whole robot, or the half of one you have so far.',
     'A photograph of a chassis that does not work yet is worth more to the ' +
     'next builder than a finished one.'],
    ['scene', 'Scenes', 'A room, a shop, a street — as MJCF.',
     'One XML file. Forty scenes is not a lot of world.'],
    ['skill', 'Skills', 'A policy, a dataset, a behaviour it did not have.',
     'Fifty clean demonstrations of one task is a real contribution.'],
    ['part', 'Parts', 'A gripper, a mount, a swap that was cheaper.',
     'Print it, measure it, tell us what it replaced.'],
  ];

  var STAGES = { planning: 'planning', printing: 'printing', wiring: 'wiring',
                 running: 'running', shipped: 'shipped' };

  fetch('data/community.json')
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function (e) {
      var s = document.getElementById('shelf');
      if (s) s.innerHTML = '<p class="faint">Could not load the registry.</p>';
      console.error('[hub]', e);
    });

  function build(D) {
    /* the four kinds */
    var kinds = document.getElementById('kinds');
    if (kinds) {
      kinds.innerHTML = KINDS.map(function (k) {
        var n = D.entries.filter(function (e) { return e.kind === k[0]; }).length;
        return '<a class="kind k-' + k[0] + '" href="#shelf" data-k="' + k[0] + '">' +
          '<b>' + esc(k[1]) + '</b><span class="kn">' + n + '</span>' +
          '<p>' + esc(k[2]) + '</p><em>' + esc(k[3]) + '</em></a>';
      }).join('');
    }

    /* ── the shelf ─────────────────────────────────────────────────── */
    var shelf = document.getElementById('shelf');
    var note = document.getElementById('shelfNote');
    var filters = document.getElementById('shelfFilters');
    var pick = 'all';

    if (filters) {
      filters.innerHTML = ['all'].concat(KINDS.map(function (k) { return k[0]; }))
        .map(function (k) {
          return '<button type="button" class="sf" data-f="' + k + '">' +
            (k === 'all' ? 'everything' : k) + '</button>';
        }).join('');
    }

    function card(e) {
      var shot = e.shot
        ? '<div class="sh-img"><img src="' + esc(e.shot) + '" alt="" loading="lazy"/></div>'
        : '<div class="sh-img sh-none"><span>' + esc(e.kind) + '</span></div>';
      return '<a class="sh k-' + esc(e.kind) + (e.ours ? ' ours' : '') + '" href="' +
        esc(e.url) + '"' + (/^https?:/.test(e.url) ? ' target="_blank" rel="noopener"' : '') + '>' +
        shot +
        '<div class="sh-body">' +
          '<span class="sh-kind">' + esc(e.kind) + '</span>' +
          (e.stage ? '<span class="sh-stage st-' + esc(e.stage) + '">' +
            esc(STAGES[e.stage] || e.stage) + '</span>' : '') +
          '<b>' + esc(e.title) + '</b>' +
          '<p>' + esc(e.blurb) + '</p>' +
          '<span class="sh-who">' + esc(e.who) +
            (e.ours ? ' <i>· reference build</i>' : '') + '</span>' +
          (e.tags ? '<span class="sh-tags">' + e.tags.map(function (t) {
            return '<i>' + esc(t) + '</i>'; }).join('') + '</span>' : '') +
        '</div></a>';
    }

    /* THE EMPTY SLOT IS THE POINT. It is the last card at every filter, it
       says plainly that nobody outside the project has posted yet, and it is
       a link to the file you would edit. */
    function slot() {
      return '<a class="sh sh-add" href="#contribute">' +
        '<div class="sh-img sh-none"><span>+</span></div>' +
        '<div class="sh-body"><span class="sh-kind">yours</span>' +
        '<b>This slot is empty</b>' +
        '<p>No one outside the project has posted yet. One object in one JSON ' +
        'file and a pull request puts you here first.</p>' +
        '<span class="sh-who">how &rarr;</span></div></a>';
    }

    function render() {
      var rows = D.entries.filter(function (e) {
        return pick === 'all' || e.kind === pick;
      });
      shelf.innerHTML = rows.map(card).join('') + slot();
      var outside = D.entries.filter(function (e) { return !e.ours; }).length;
      note.innerHTML = outside
        ? '<b>' + outside + '</b> of ' + D.entries.length + ' entries are from ' +
          'outside the project.'
        : 'Everything on the shelf so far is the reference build, and it is ' +
          'labelled as such. <b>There are no outside entries yet</b> — this page ' +
          'would rather say that than pad the grid with people who do not exist.';
      if (filters) {
        filters.querySelectorAll('.sf').forEach(function (b) {
          b.classList.toggle('on', b.dataset.f === pick);
        });
      }
    }

    if (filters) {
      filters.addEventListener('click', function (ev) {
        var b = ev.target.closest('.sf');
        if (!b) return;
        pick = b.dataset.f;
        render();
      });
    }
    if (kinds) {
      kinds.addEventListener('click', function (ev) {
        var a = ev.target.closest('[data-k]');
        if (!a) return;
        pick = a.dataset.k;
        render();
      });
    }
    render();

    /* ── challenges ────────────────────────────────────────────────── */
    var chal = document.getElementById('chal');
    if (chal) {
      chal.innerHTML = (D.challenges || []).map(function (c, i) {
        return '<div class="ch"><span class="ch-n">' +
          String(i + 1).padStart(2, '0') + '</span>' +
          '<b>' + esc(c.title) + '</b>' +
          '<p class="ch-goal">' + esc(c.goal) + '</p>' +
          '<p class="ch-why">' + esc(c.why) + '</p>' +
          '<a href="' + esc(c.chapter) + '">the chapter for it &rarr;</a></div>';
      }).join('');
    }

    window.__hub = {
      data: D, pick: function () { return pick; },
      setFilter: function (k) { pick = k; render(); },
      cards: function () { return shelf.querySelectorAll('.sh').length; },
      outside: function () {
        return D.entries.filter(function (e) { return !e.ours; }).length;
      }
    };
  }

  /* ── the chapter list ──────────────────────────────────────────────── */
  var CH = [
    ['overview.html', '00', 'Overview', 'What you are building, and what will stop you.'],
    ['bom.html', '01', 'Bill of materials', 'Every part, every price, every gap.'],
    ['assembly.html', '02', 'Mechanical assembly', 'Print, bolt, tension. Base up.'],
    ['electronics.html', '03', 'Electronics & wiring', 'CAN, TTL, USB, power. The PCBs.'],
    ['firmware.html', '04', 'Firmware', 'Five subsystems, each its own folder.'],
    ['software.html', '05', 'Software install', 'ROS 2 on the robot, the sim on your laptop.'],
    ['bringup.html', '06', 'Bring-up & calibration', 'First power-on. Zeros, limits, CoM.'],
    ['operate.html', '07', 'Operating the robot', 'Teleop from a browser, a phone, a headset.'],
    ['learning.html', '08', 'Data & learning', 'Record, curate, train, deploy.'],
    ['troubleshoot.html', '09', 'Troubleshooting', 'What usually goes wrong, and why.'],
  ];
  var chapters = document.getElementById('chapters');
  if (chapters) {
    chapters.innerHTML = CH.map(function (c) {
      return '<a class="chap" href="' + c[0] + '"><span class="cn">' + c[1] +
        '</span><b>' + esc(c[2]) + '</b><p>' + esc(c[3]) + '</p></a>';
    }).join('');
  }
})();
