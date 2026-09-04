/* Assembly panels, drawn.
 *
 * Every step in an `ol.asm-steps` gets a comic panel figure: the picture
 * leads, the imperative becomes the caption lettering, and the explanation
 * sits under it as secondary text. The illustration is chosen from what the
 * step actually says (mount an actuator, route a cable, close a cover…), so
 * new steps get art automatically.
 *
 * Everything is drawn here rather than photographed: flat shapes, heavy ink
 * outlines, halftone, motion arcs, and the site's own palette.
 */
(function () {
  'use strict';
  var lists = document.querySelectorAll('ol.asm-steps');
  if (!lists.length) return;

  var INK = '#151820', OR = '#F0762E', YEL = '#F2C94C', BLUE = '#23577E',
      GRN = '#2E7D4F', RUST = '#C6301A', PAPER = '#FDF6E2', STEEL = '#B9B2A0',
      DARK = '#8E8778';

  /* ── shared drawing bits ─────────────────────────────────────────────── */
  function svg(inner, bg) {
    return '<svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<defs><pattern id="ah" width="6" height="6" patternUnits="userSpaceOnUse">' +
      '<circle cx="1.6" cy="1.6" r="1.3" fill="rgba(21,24,32,0.13)"/></pattern></defs>' +
      '<rect x="0" y="0" width="240" height="150" fill="' + (bg || '#F3E7C7') + '"/>' +
      '<rect x="0" y="0" width="240" height="150" fill="url(#ah)"/>' + inner + '</svg>';
  }
  /* a bolt arrow: where the part goes */
  function drop(x, y, len, color) {
    color = color || RUST;
    return '<path d="M' + x + ' ' + (y - len) + ' V' + (y - 8) +
      ' M' + (x - 7) + ' ' + (y - 15) + ' L' + x + ' ' + (y - 5) + ' L' + (x + 7) + ' ' + (y - 15) + '" ' +
      'stroke="' + color + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  /* a rotation arc: this thing turns */
  function arc(cx, cy, r, color) {
    color = color || GRN;
    return '<path d="M' + (cx - r) + ' ' + cy + ' A' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy + '" ' +
      'stroke="' + color + '" stroke-width="3.5" fill="none" stroke-dasharray="7 5" stroke-linecap="round"/>' +
      '<path d="M' + (cx + r - 7) + ' ' + (cy - 8) + ' L' + (cx + r) + ' ' + cy + ' L' + (cx + r - 10) + ' ' + (cy + 3) + '" ' +
      'stroke="' + color + '" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  function plate(x, y, w, h, fill) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5" fill="' +
      (fill || STEEL) + '" stroke="' + INK + '" stroke-width="3.5"/>';
  }
  function motor(cx, cy, r, face) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + STEEL +
      '" stroke="' + INK + '" stroke-width="3.5"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.55) + '" fill="' + (face || PAPER) +
      '" stroke="' + INK + '" stroke-width="3"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.2) + '" fill="' + OR + '"/>';
  }
  function word(x, y, t, color, size) {
    return '<text x="' + x + '" y="' + y + '" font-family="Bangers, Impact, sans-serif" ' +
      'font-size="' + (size || 19) + '" fill="' + (color || RUST) + '" text-anchor="middle" ' +
      'letter-spacing="1" transform="rotate(-7 ' + x + ' ' + y + ')">' + t + '</text>';
  }

  /* ── the panel figures ───────────────────────────────────────────────── */
  var ART = {
    /* a big actuator coming down onto a mounting plate */
    actuator: function () {
      return svg(plate(46, 96, 148, 26) + motor(120, 66, 30) +
        drop(120, 92, 34) + word(196, 40, 'CLUNK!', RUST, 17));
    },
    /* a bolt threading into a shaft */
    bolt: function () {
      return svg(plate(78, 82, 84, 44, PAPER) +
        '<rect x="112" y="26" width="16" height="52" fill="' + STEEL + '" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<path d="M104 22 h32 l-6 12 h-20 z" fill="' + INK + '"/>' +
        '<path d="M106 40h28M106 50h28M106 60h28" stroke="' + INK + '" stroke-width="2"/>' +
        arc(120, 24, 34, GRN) + drop(120, 80, 22));
    },
    /* two small smart servos dropping into a block */
    servo: function () {
      var s = function (x) {
        return '<rect x="' + x + '" y="70" width="40" height="46" rx="4" fill="' + INK + '"/>' +
          '<rect x="' + (x + 5) + '" y="75" width="30" height="20" rx="2" fill="' + STEEL + '"/>' +
          '<circle cx="' + (x + 20) + '" cy="106" r="8" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="3"/>';
      };
      return svg(plate(38, 116, 164, 18) + s(58) + s(142) +
        drop(78, 66, 30) + drop(162, 66, 30) + word(120, 44, 'x2', BLUE, 22));
    },
    /* a bracket meeting a block */
    mount: function () {
      return svg(plate(40, 84, 90, 42) +
        '<path d="M148 60 h54 v18 h-36 v48 h-18 z" fill="' + PAPER + '" stroke="' + INK +
        '" stroke-width="3.5" stroke-linejoin="round"/>' +
        '<path d="M136 92 h-6" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M142 96 L132 96" stroke="' + RUST + '" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M132 88 L124 96 L132 104" stroke="' + RUST + '" stroke-width="4" fill="none" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>');
    },
    /* a stereo camera seating into its mount */
    camera: function () {
      return svg(plate(52, 100, 136, 28) +
        '<rect x="66" y="52" width="108" height="42" rx="9" fill="' + INK + '"/>' +
        '<circle cx="94" cy="73" r="13" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="94" cy="73" r="6" fill="' + BLUE + '"/>' +
        '<circle cx="146" cy="73" r="13" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="146" cy="73" r="6" fill="' + BLUE + '"/>' +
        drop(120, 48, 26) + word(206, 128, 'SNAP!', GRN, 16));
    },
    /* a cable routed with a slack loop */
    cable: function () {
      return svg(
        '<rect x="96" y="16" width="48" height="118" rx="8" fill="' + DARK + '" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<path d="M120 24 C120 54 62 58 62 84 C62 110 120 108 120 132" stroke="' + INK +
        '" stroke-width="8" fill="none" stroke-linecap="round"/>' +
        '<path d="M120 24 C120 54 62 58 62 84 C62 110 120 108 120 132" stroke="' + OR +
        '" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
        arc(62, 84, 26, GRN) + word(190, 44, 'SLACK!', GRN, 16));
    },
    /* a shell closing over an assembly */
    cover: function () {
      return svg(plate(64, 92, 112, 40, PAPER) +
        '<path d="M60 74 q60 -46 120 0 z" fill="' + STEEL + '" stroke="' + INK +
        '" stroke-width="3.5" stroke-linejoin="round"/>' +
        drop(120, 88, 26) +
        '<circle cx="86" cy="112" r="4" fill="' + INK + '"/><circle cx="154" cy="112" r="4" fill="' + INK + '"/>' +
        word(202, 132, 'CLICK!', RUST, 16));
    },
    /* setting a bus ID: one device on the bench, a dial */
    busid: function () {
      return svg(
        '<rect x="40" y="60" width="80" height="60" rx="6" fill="' + INK + '"/>' +
        '<rect x="50" y="70" width="60" height="26" rx="3" fill="' + GRN + '"/>' +
        '<text x="80" y="90" font-family="Space Mono, monospace" font-size="17" fill="' + INK +
        '" text-anchor="middle">ID</text>' +
        '<circle cx="172" cy="88" r="30" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<path d="M172 88 L172 66" stroke="' + RUST + '" stroke-width="5" stroke-linecap="round"/>' +
        arc(172, 88, 40, GRN) + word(120, 34, 'ONE AT A TIME', BLUE, 15));
    },
    /* a daisy-chained bus with terminators at both ends */
    daisy: function () {
      var node = function (x) {
        return '<rect x="' + x + '" y="62" width="34" height="30" rx="4" fill="' + INK + '"/>' +
          '<rect x="' + (x + 5) + '" y="68" width="24" height="12" rx="2" fill="' + GRN + '"/>';
      };
      return svg('<path d="M22 78 H218" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/>' +
        node(50) + node(103) + node(156) +
        '<rect x="12" y="66" width="16" height="24" rx="3" fill="' + YEL + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<rect x="212" y="66" width="16" height="24" rx="3" fill="' + YEL + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<text x="20" y="112" font-family="Space Mono, monospace" font-size="11" fill="' + INK + '">120Ω</text>' +
        '<text x="200" y="112" font-family="Space Mono, monospace" font-size="11" fill="' + INK + '">120Ω</text>');
    },
    /* a wheel turning through a full steer rotation */
    wheel: function () {
      return svg(plate(78, 30, 84, 26) +
        '<circle cx="120" cy="92" r="34" fill="' + INK + '"/>' +
        '<circle cx="120" cy="92" r="14" fill="' + STEEL + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="120" cy="92" r="5" fill="' + OR + '"/>' +
        arc(120, 92, 48, GRN) + word(206, 44, 'SPIN!', GRN, 16));
    },
    /* one swerve module on the bench: motor, gearbox, wheel */
    module: function () {
      return svg(plate(80, 24, 80, 22) +
        motor(120, 62, 22) +
        '<rect x="96" y="84" width="48" height="16" rx="4" fill="' + DARK + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="120" cy="118" r="24" fill="' + INK + '"/>' +
        '<circle cx="120" cy="118" r="9" fill="' + STEEL + '" stroke="' + INK + '" stroke-width="2.5"/>' +
        drop(180, 60, 26, GRN) + word(196, 132, 'x3', BLUE, 20));
    },
    /* three swerve modules in the delta layout */
    swerve: function () {
      var m = function (x, y) {
        return '<circle cx="' + x + '" cy="' + y + '" r="16" fill="' + INK + '"/>' +
          '<circle cx="' + x + '" cy="' + y + '" r="6" fill="' + OR + '"/>';
      };
      return svg('<path d="M120 34 L188 112 H52 Z" fill="' + PAPER + '" stroke="' + INK +
        '" stroke-width="3.5" stroke-linejoin="round"/>' +
        m(120, 44) + m(178, 108) + m(62, 108) +
        '<text x="120" y="90" font-family="Space Mono, monospace" font-size="13" fill="' + INK +
        '" text-anchor="middle">120°</text>');
    },
    /* sweeping a joint through its full travel */
    range: function () {
      return svg(plate(96, 104, 48, 26) +
        '<path d="M120 104 L120 44" stroke="' + INK + '" stroke-width="7" stroke-linecap="round"/>' +
        '<path d="M120 104 L74 66" stroke="' + INK + '" stroke-width="4" stroke-linecap="round" opacity="0.32"/>' +
        '<path d="M120 104 L166 66" stroke="' + INK + '" stroke-width="4" stroke-linecap="round" opacity="0.32"/>' +
        '<path d="M62 104 A62 62 0 0 1 178 104" stroke="' + GRN + '" stroke-width="3.5" fill="none" stroke-dasharray="7 5"/>' +
        '<circle cx="120" cy="104" r="7" fill="' + RUST + '"/>' +
        word(120, 34, 'BOTH ENDS!', GRN, 15));
    },
    /* the telescoping lift column */
    column: function () {
      return svg(plate(60, 122, 120, 18) +
        '<rect x="98" y="42" width="44" height="82" fill="' + DARK + '" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<rect x="106" y="26" width="28" height="70" fill="' + STEEL + '" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<path d="M198 124 V34 M188 48 L198 30 L208 48" stroke="' + GRN + '" stroke-width="4.5" ' +
        'fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<text x="198" y="140" font-family="Space Mono, monospace" font-size="11" fill="' + GRN +
        '" text-anchor="middle">0.635 m</text>');
    },
    /* the hand and its tendons */
    hand: function () {
      var f = '';
      for (var i = 0; i < 4; i++) {
        f += '<rect x="' + (74 + i * 20) + '" y="34" width="13" height="52" rx="6" fill="' + PAPER +
          '" stroke="' + INK + '" stroke-width="3"/>';
      }
      return svg(f + plate(66, 86, 92, 40, '#D9D2C0') +
        '<rect x="46" y="94" width="24" height="15" rx="7" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M80 86 v-8 M100 86 v-8 M120 86 v-8 M140 86 v-8" stroke="' + OR + '" stroke-width="2.5"/>' +
        word(200, 44, '17 DOF', BLUE, 16));
    },
    /* a bench supply with the current limit set low */
    power: function () {
      return svg(
        '<rect x="44" y="46" width="152" height="70" rx="8" fill="' + INK + '"/>' +
        '<rect x="58" y="58" width="80" height="30" rx="3" fill="' + GRN + '"/>' +
        '<text x="98" y="80" font-family="Space Mono, monospace" font-size="15" fill="' + INK +
        '" text-anchor="middle">0.5A</text>' +
        '<circle cx="166" cy="72" r="16" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M166 72 L158 60" stroke="' + RUST + '" stroke-width="4" stroke-linecap="round"/>' +
        '<circle cx="70" cy="102" r="6" fill="' + OR + '"/><circle cx="94" cy="102" r="6" fill="' + PAPER + '"/>' +
        word(120, 34, 'LIMIT FIRST!', RUST, 16));
    },
    /* torque disabled — a limp joint */
    torque: function () {
      return svg(plate(92, 96, 56, 30) +
        '<path d="M120 96 q4 -34 -30 -44" stroke="' + INK + '" stroke-width="7" fill="none" stroke-linecap="round"/>' +
        '<circle cx="120" cy="96" r="9" fill="' + STEEL + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M170 50 l30 30 M200 50 l-30 30" stroke="' + RUST + '" stroke-width="6" stroke-linecap="round"/>' +
        word(120, 34, 'TORQUE OFF', RUST, 16));
    },
    /* a printed part coming off the bed */
    print: function () {
      return svg(
        '<rect x="34" y="30" width="172" height="10" rx="4" fill="' + INK + '"/>' +
        '<rect x="104" y="40" width="34" height="20" rx="4" fill="#D9D2C0" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M121 60 v14" stroke="' + OR + '" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M72 116 L121 74 L170 116 Z" fill="' + OR + '" stroke="' + INK +
        '" stroke-width="3.5" stroke-linejoin="round"/>' +
        '<path d="M82 108h78M92 98h58" stroke="' + INK + '" stroke-width="2" opacity="0.5"/>' +
        '<rect x="60" y="118" width="120" height="10" rx="4" fill="' + INK + '"/>');
    },
    /* a board being seated */
    board: function () {
      return svg(plate(44, 92, 152, 34) +
        '<rect x="70" y="40" width="100" height="44" rx="4" fill="' + GRN + '" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<rect x="104" y="54" width="30" height="20" fill="' + INK + '"/>' +
        '<path d="M80 48h14M80 58h14M146 48h14M146 58h14" stroke="' + YEL + '" stroke-width="3" stroke-linecap="round"/>' +
        drop(120, 88, 22));
    },
    /* a check: it passed */
    check: function () {
      return svg(
        '<circle cx="120" cy="76" r="44" fill="' + GRN + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M98 78 l16 17 l30 -37" stroke="' + PAPER + '" stroke-width="9" fill="none" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
        word(120, 138, 'PROVE IT!', RUST, 16));
    },
    /* generic: a wrench over a part */
    generic: function () {
      return svg(plate(64, 88, 112, 40) +
        '<path d="M150 34 a16 16 0 1 0 16 22 L196 88 l-12 12 L154 68 a16 16 0 0 0 -4 -34 z" ' +
        'fill="' + STEEL + '" stroke="' + INK + '" stroke-width="3.5" stroke-linejoin="round"/>' +
        '<circle cx="92" cy="108" r="5" fill="' + INK + '"/><circle cx="118" cy="108" r="5" fill="' + INK + '"/>');
    }
  };

  /* what the step is about → which figure. First match wins, so the more
     specific patterns come first. */
  var RULES = [
    [/torque (is )?(off|disabl)|limp|de-?energ/i, 'torque'],
    [/current[- ]limit|bench supply|first energi[sz]|power (it |the )?up|psu/i, 'power'],
    [/print|petg|spool|filament|bed/i, 'print'],
    [/daisy|terminator|120 ?Ω|bus chain|chain the/i, 'daisy'],
    [/\bid\b|ids|address|one .* at a time/i, 'busid'],
    [/wheel|spin each|steer rotation/i, 'wheel'],
    [/delta layout|at 120|three modules at/i, 'swerve'],
    [/(build|assemble).{0,24}module|swerve module/i, 'module'],
    [/range[- ]test|full travel|both end stops|sweep|through its full/i, 'range'],
    [/lift|column|telescop|z-column/i, 'column'],
    /* NB: not a bare /hand/ — "turn the screw by hand" is an idiom, and it
       was putting the ORCA hand drawing on a leadscrew step. */
    [/finger|tendon|\borca\b|palm|knuckle|\bhands\b/i, 'hand'],
    [/cover|shell|housing|close the/i, 'cover'],
    /* \blead\b, not /lead/ — otherwise "leadscrew" drew a cable */
    [/cable|route|harness|slack|\bwires?\b|\bleads?\b/i, 'cable'],
    [/camera|zed|realsense|arducam|lidar/i, 'camera'],
    [/servo|dynamixel|xc330/i, 'servo'],
    [/teensy|jetson|pico|board|compute bay|pcb|hub/i, 'board'],
    [/bolt|screw|thread|fasten|tighten|shaft/i, 'bolt'],
    [/actuator|motor|dm\d|damiao|neo\b|bldc/i, 'actuator'],
    [/mount|attach|bracket|plate|seat the/i, 'mount'],
    [/confirm|verify|check|test|home it|prove/i, 'check']
  ];

  /* Match the IMPERATIVE first — the caption is what the panel is about.
     Only if nothing there matches do we fall back to the whole panel, which
     otherwise let an incidental "with torque off" or "wire it to…" in the
     explanation choose the picture. */
  function artFor(headline, full) {
    var i;
    for (i = 0; i < RULES.length; i++) if (RULES[i][0].test(headline)) return RULES[i][1];
    for (i = 0; i < RULES.length; i++) if (RULES[i][0].test(full)) return RULES[i][1];
    return 'generic';
  }

  Array.prototype.forEach.call(lists, function (ol) {
    Array.prototype.forEach.call(ol.children, function (li) {
      if (li.querySelector('.asm-art')) return;
      /* <b> COUNTS TOO. The site's build page opens each step with <strong>
         and the wiki's chapters open theirs with <b> — the same thing said
         two ways. Reading only one meant the drawings appeared on one page
         and not the other, which is how the two pages came to look like
         different projects in the first place. */
      var strong = li.querySelector('strong, b');
      var head = strong ? strong.textContent : '';
      var fig = document.createElement('figure');
      fig.className = 'asm-art';
      fig.innerHTML = (ART[artFor(head, li.textContent)] || ART.generic)();
      /* wrap the loose explanation text so it can be styled as the
         secondary voice under the lettering */
      var node = strong && strong.nextSibling;
      if (node && node.nodeType === 3 && node.nodeValue.trim()) {
        var say = document.createElement('span');
        say.className = 'asm-say';
        /* the wiki writes "Assign CAN IDs 1–6, powering one at a time", so
           the caption inherits a leading comma when the bold half ends
           mid-sentence. Trim the joining punctuation and capitalise. */
        var t = node.nodeValue.trim().replace(/^[,;:—–-]\s*/, '');
        say.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        li.replaceChild(say, node);
      }
      li.insertBefore(fig, li.firstChild);
      li.classList.add('has-art');
    });
  });
})();
