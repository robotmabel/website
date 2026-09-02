/* Comic pop-ups — click a card, a panel bursts open like a comic reveal.
 *
 * Markup contract (progressive enhancement: without JS the card is inert
 * and its extra copy stays hidden, so nothing is lost):
 *
 *   <div class="card" data-pop data-fx="VHOOM!" data-art="swerve">
 *     ...the card's normal contents...
 *     <template class="pop-more">  extra HTML revealed in the panel  </template>
 *   </div>
 *
 * data-fx  — the onomatopoeia flung out on open (defaults cycle)
 * data-art — which spot illustration to draw at the top of the panel
 */
(function () {
  'use strict';

  var FX = ['VHOOM!', 'KA-POW!', 'BOOM!', 'ZAP!', 'WHAMM!', 'THWIP!', 'KRAK!', 'BRAAP!'];
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── spot illustrations ────────────────────────────────────────────────
     Drawn here rather than imported: flat comic shapes, ink outlines,
     halftone dots, the site's own palette. Each returns an <svg> string. */
  var INK = '#151820', ORANGE = '#F0762E', YELLOW = '#F2C94C',
      BLUE = '#23577E', RUST = '#C6301A', PANEL = '#FDF6E2', GREEN = '#2E7D4F';

  function halftone(id, color) {
    return '<pattern id="' + id + '" width="7" height="7" patternUnits="userSpaceOnUse">' +
      '<circle cx="2" cy="2" r="1.5" fill="' + color + '"/></pattern>';
  }

  /* MABEL's head — the site logo, drawn big and expressive */
  function head(x, y, s, mood) {
    var eye = mood === 'wink' ? 8 : 11;
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<line x1="-40" y1="-22" x2="-58" y2="-46" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/>' +
      '<line x1="40" y1="-22" x2="58" y2="-46" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="-58" cy="-46" r="6" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="4"/>' +
      '<circle cx="58" cy="-46" r="6" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="4"/>' +
      '<rect x="-62" y="-24" width="124" height="64" rx="29" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="5"/>' +
      '<rect x="-50" y="-14" width="100" height="44" rx="20" fill="none" stroke="' + ORANGE + '" stroke-width="5"/>' +
      '<circle cx="-22" cy="8" r="15" fill="#FFF9F0" stroke="' + INK + '" stroke-width="4"/>' +
      '<circle cx="22" cy="8" r="' + (mood === 'wink' ? 15 : 15) + '" fill="#FFF9F0" stroke="' + INK + '" stroke-width="4"/>' +
      '<circle cx="-22" cy="8" r="' + eye + '" fill="' + INK + '"/>' +
      '<circle cx="22" cy="8" r="' + eye + '" fill="' + INK + '"/>' +
      '<circle cx="-19" cy="4" r="3.5" fill="#FFF9F0"/><circle cx="25" cy="4" r="3.5" fill="#FFF9F0"/>' +
      '</g>';
  }

  function frame(inner, bg) {
    return '<svg viewBox="0 0 420 190" class="pop-art-svg" aria-hidden="true">' +
      '<defs>' + halftone('ht', 'rgba(240,118,46,0.45)') + '</defs>' +
      '<rect x="2" y="2" width="416" height="186" rx="10" fill="' + (bg || '#F6E9C9') +
      '" stroke="' + INK + '" stroke-width="4"/>' + inner + '</svg>';
  }

  function speed(x, y, n, w, color) {
    var s = '';
    for (var i = 0; i < n; i++) {
      s += '<rect x="' + (x + i * 3) + '" y="' + (y + i * 13) + '" width="' + (w - i * 9) +
        '" height="4" rx="2" fill="' + (color || INK) + '" opacity="' + (0.85 - i * 0.13) + '"/>';
    }
    return s;
  }

  var ART = {
    /* the swerve base translating while facing forward */
    swerve: function () {
      return frame(
        speed(18, 40, 5, 120, ORANGE) +
        '<rect x="0" y="0" width="420" height="190" fill="url(#ht)" opacity="0.25"/>' +
        '<g transform="translate(255,120)">' +
        '<rect x="-70" y="-18" width="140" height="52" rx="12" fill="#B9B2A0" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="-8" y="-96" width="18" height="80" fill="#8E8778" stroke="' + INK + '" stroke-width="5"/>' +
        '<circle cx="-46" cy="38" r="15" fill="' + INK + '"/><circle cx="46" cy="38" r="15" fill="' + INK + '"/>' +
        '<circle cx="-46" cy="38" r="6" fill="' + ORANGE + '"/><circle cx="46" cy="38" r="6" fill="' + ORANGE + '"/>' +
        '<path d="M-70 12 L-104 12 M-96 4 L-104 12 L-96 20" stroke="' + RUST + '" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        head(0, -110, 0.62) + '</g>');
    },
    /* two hands, 17 tendon DOF each */
    hands: function () {
      var fingers = '';
      for (var i = 0; i < 4; i++) {
        fingers += '<rect x="' + (-26 + i * 15) + '" y="-54" width="10" height="40" rx="5" fill="' + PANEL +
          '" stroke="' + INK + '" stroke-width="4"/>';
      }
      return frame(
        '<rect x="0" y="0" width="420" height="190" fill="url(#ht)" opacity="0.18"/>' +
        '<g transform="translate(140,120)">' + fingers +
        '<rect x="-32" y="-16" width="70" height="42" rx="12" fill="#D9D2C0" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="-48" y="-8" width="20" height="12" rx="6" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/></g>' +
        '<g transform="translate(285,120) scale(-1,1)">' + fingers +
        '<rect x="-32" y="-16" width="70" height="42" rx="12" fill="#D9D2C0" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="-48" y="-8" width="20" height="12" rx="6" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/></g>' +
        '<circle cx="212" cy="86" r="22" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<text x="212" y="93" font-family="Bangers, cursive" font-size="20" fill="' + INK +
        '" text-anchor="middle">17</text>');
    },
    /* the lift column raising the whole torso */
    lift: function () {
      return frame(
        '<g transform="translate(210,150)">' +
        '<rect x="-64" y="-16" width="128" height="42" rx="10" fill="#B9B2A0" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="-10" y="-108" width="20" height="94" fill="#8E8778" stroke="' + INK + '" stroke-width="5"/>' +
        '<line x1="-10" y1="-60" x2="10" y2="-60" stroke="' + INK + '" stroke-width="3"/>' +
        '<line x1="-10" y1="-84" x2="10" y2="-84" stroke="' + INK + '" stroke-width="3"/>' +
        head(0, -120, 0.5) + '</g>' +
        '<path d="M362 150 L362 46 M352 58 L362 44 L372 58" stroke="' + GREEN +
        '" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<text x="386" y="104" font-family="Space Mono, monospace" font-size="13" fill="' + GREEN +
        '" text-anchor="middle" transform="rotate(90,386,104)">0.635 m</text>');
    },
    /* the modular exploded view */
    modules: function () {
      var boxes = [[70, 60, 'HEAD'], [70, 125, 'BASE'], [200, 60, 'ARM'], [200, 125, 'HAND'],
                   [330, 60, 'NECK'], [330, 125, 'LIFT']];
      var s = '<rect x="0" y="0" width="420" height="190" fill="url(#ht)" opacity="0.15"/>';
      var cols = [ORANGE, BLUE, YELLOW, GREEN, RUST, '#D9A13F'];
      boxes.forEach(function (b, i) {
        s += '<g transform="translate(' + b[0] + ',' + b[1] + ')">' +
          '<rect x="-46" y="-24" width="92" height="46" rx="8" fill="' + PANEL +
          '" stroke="' + INK + '" stroke-width="4"/>' +
          '<rect x="-46" y="-24" width="10" height="46" fill="' + cols[i] + '"/>' +
          '<text x="4" y="6" font-family="Bangers, cursive" font-size="19" fill="' + INK +
          '" text-anchor="middle" letter-spacing="1">' + b[2] + '</text></g>';
      });
      return frame(s, '#F1E6C6');
    },
    /* sim twin ↔ real robot */
    twin: function () {
      return frame(
        '<line x1="210" y1="14" x2="210" y2="176" stroke="' + INK +
        '" stroke-width="4" stroke-dasharray="9 7"/>' +
        '<g transform="translate(105,118)">' +
        '<rect x="-46" y="-14" width="92" height="38" rx="9" fill="#C9E2F0" stroke="' + BLUE + '" stroke-width="5"/>' +
        '<rect x="-7" y="-70" width="14" height="58" fill="#A8CDE2" stroke="' + BLUE + '" stroke-width="5"/>' +
        head(0, -82, 0.44) + '</g>' +
        '<g transform="translate(315,118)">' +
        '<rect x="-46" y="-14" width="92" height="38" rx="9" fill="#B9B2A0" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="-7" y="-70" width="14" height="58" fill="#8E8778" stroke="' + INK + '" stroke-width="5"/>' +
        head(0, -82, 0.44) + '</g>' +
        '<text x="105" y="176" font-family="Bangers, cursive" font-size="18" fill="' + BLUE +
        '" text-anchor="middle" letter-spacing="1">SIM</text>' +
        '<text x="315" y="176" font-family="Bangers, cursive" font-size="18" fill="' + INK +
        '" text-anchor="middle" letter-spacing="1">REAL</text>');
    },
    /* the operator, the wire, the robot */
    teleop: function () {
      return frame(
        '<g transform="translate(88,110)">' +
        '<circle cx="0" cy="-42" r="20" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="-22" y="-50" width="44" height="16" rx="6" fill="' + INK + '"/>' +
        '<path d="M-24 -14 Q0 -26 24 -14 L20 34 L-20 34 Z" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="5"/></g>' +
        '<path d="M128 96 Q210 46 292 96" stroke="' + RUST + '" stroke-width="5" fill="none" stroke-dasharray="10 8"/>' +
        '<text x="210" y="60" font-family="Space Mono, monospace" font-size="13" fill="' + RUST +
        '" text-anchor="middle">49 ms</text>' +
        '<g transform="translate(320,124)">' +
        '<rect x="-52" y="-16" width="104" height="40" rx="9" fill="#B9B2A0" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="-8" y="-72" width="16" height="58" fill="#8E8778" stroke="' + INK + '" stroke-width="5"/>' +
        head(0, -84, 0.46) + '</g>');
    },
    /* the money shot */
    price: function () {
      return frame(
        '<g transform="translate(210,92)">' +
        '<circle cx="0" cy="0" r="56" fill="' + YELLOW + '" stroke="' + INK + '" stroke-width="5"/>' +
        '<text x="0" y="12" font-family="Limelight, serif" font-size="30" fill="' + INK +
        '" text-anchor="middle">$9,670</text></g>' +
        speed(24, 34, 4, 84, RUST) + speed(312, 34, 4, 84, RUST) +
        '<text x="210" y="180" font-family="Bangers, cursive" font-size="18" fill="' + RUST +
        '" text-anchor="middle" letter-spacing="1">AS BUILT — NO MACHINE SHOP</text>');
    },
    /* a printer laying down a part */
    printer: function () {
      return frame(
        '<rect x="42" y="26" width="336" height="140" rx="8" fill="none" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="60" y="40" width="300" height="10" rx="4" fill="' + INK + '"/>' +
        '<rect x="176" y="50" width="66" height="34" rx="5" fill="#D9D2C0" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M209 84 L209 108" stroke="' + ORANGE + '" stroke-width="5" stroke-linecap="round"/>' +
        '<rect x="150" y="108" width="118" height="34" rx="4" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M158 118h102M158 128h102" stroke="' + INK + '" stroke-width="2" opacity="0.5"/>' +
        '<rect x="60" y="142" width="300" height="10" rx="4" fill="' + INK + '"/>' +
        '<circle cx="96" cy="96" r="26" fill="none" stroke="' + INK + '" stroke-width="5"/>' +
        '<circle cx="96" cy="96" r="8" fill="' + YELLOW + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="324" cy="96" r="26" fill="none" stroke="' + INK + '" stroke-width="5"/>' +
        '<circle cx="324" cy="96" r="8" fill="' + BLUE + '" stroke="' + INK + '" stroke-width="3"/>');
    },
    /* the bench: drivers, iron, meter */
    tools: function () {
      return frame(
        '<rect x="0" y="0" width="420" height="190" fill="url(#ht)" opacity="0.14"/>' +
        /* hex driver */
        '<rect x="46" y="40" width="16" height="86" rx="6" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<rect x="50" y="122" width="8" height="30" fill="#B9B2A0" stroke="' + INK + '" stroke-width="3"/>' +
        /* soldering iron */
        '<rect x="104" y="46" width="18" height="70" rx="6" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M113 116 L113 150" stroke="' + INK + '" stroke-width="5"/>' +
        '<circle cx="113" cy="154" r="7" fill="' + RUST + '"/>' +
        /* multimeter */
        '<rect x="168" y="52" width="94" height="104" rx="9" fill="' + YELLOW + '" stroke="' + INK + '" stroke-width="5"/>' +
        '<rect x="182" y="66" width="66" height="30" rx="3" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="215" cy="122" r="18" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M215 122 L215 110" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>' +
        /* bench supply */
        '<rect x="286" y="60" width="94" height="88" rx="8" fill="' + INK + '"/>' +
        '<rect x="298" y="72" width="70" height="28" rx="3" fill="' + GREEN + '"/>' +
        '<circle cx="312" cy="126" r="8" fill="' + ORANGE + '"/><circle cx="342" cy="126" r="8" fill="' + PANEL + '"/>');
    },
    /* laptop + jetson */
    computers: function () {
      return frame(
        '<path d="M78 130 L96 58 H214 L196 130 Z" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="5" stroke-linejoin="round"/>' +
        '<path d="M104 66 H206 L192 122 H90 Z" fill="' + BLUE + '"/>' +
        '<rect x="62" y="130" width="150" height="12" rx="5" fill="#D9D2C0" stroke="' + INK + '" stroke-width="4"/>' +
        '<rect x="252" y="74" width="112" height="66" rx="8" fill="' + INK + '"/>' +
        '<rect x="266" y="88" width="84" height="30" rx="3" fill="' + GREEN + '"/>' +
        '<path d="M252 96h-16M252 110h-16M364 96h16M364 110h16" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>' +
        '<text x="308" y="160" font-family="Space Mono, monospace" font-size="12" fill="' + INK +
        '" text-anchor="middle">JETSON</text>' +
        '<text x="137" y="160" font-family="Space Mono, monospace" font-size="12" fill="' + INK +
        '" text-anchor="middle">YOUR LAPTOP</text>');
    },
    /* hands + terminal: the skills you need */
    skills: function () {
      return frame(
        '<rect x="40" y="36" width="164" height="118" rx="8" fill="' + INK + '"/>' +
        '<path d="M58 66 l18 14 -18 14M86 94h34" stroke="' + GREEN + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<rect x="58" y="112" width="120" height="6" rx="3" fill="' + GREEN + '" opacity="0.6"/>' +
        '<g transform="translate(300,96)">' +
        '<rect x="-34" y="-6" width="68" height="40" rx="10" fill="#D9D2C0" stroke="' + INK + '" stroke-width="4"/>' +
        '<rect x="-26" y="-48" width="12" height="46" rx="6" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<rect x="-8" y="-56" width="12" height="54" rx="6" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<rect x="10" y="-50" width="12" height="48" rx="6" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/>' +
        '<rect x="-48" y="4" width="18" height="12" rx="6" fill="' + PANEL + '" stroke="' + INK + '" stroke-width="4"/></g>');
    },
    /* generic: MABEL says hi */
    hello: function () {
      return frame(
        '<rect x="0" y="0" width="420" height="190" fill="url(#ht)" opacity="0.2"/>' +
        head(150, 96, 1.0) +
        '<g transform="translate(310,58)">' +
        '<ellipse cx="0" cy="0" rx="62" ry="34" fill="#FFF9F0" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M-30 26 L-46 50 L-14 32 Z" fill="#FFF9F0" stroke="' + INK + '" stroke-width="4"/>' +
        '<text x="0" y="8" font-family="Bangers, cursive" font-size="22" fill="' + INK +
        '" text-anchor="middle" letter-spacing="1">HI THERE!</text></g>');
    }
  };

  /* ── the overlay ────────────────────────────────────────────────────── */
  var overlay = null, panel = null, lastCard = null;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'pop-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="pop-burst" aria-hidden="true"></div>' +
      '<div class="pop-panel">' +
        '<button class="pop-close" aria-label="Close">✕</button>' +
        '<div class="pop-art"></div>' +
        '<div class="pop-head"><span class="pop-kicker"></span><h3 class="pop-title"></h3></div>' +
        '<div class="pop-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    panel = overlay.querySelector('.pop-panel');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.pop-close')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
  }

  function flingFx(word) {
    var wrap = overlay.querySelector('.pop-burst');
    wrap.innerHTML = '';
    if (reduce) return;
    var main = document.createElement('span');
    main.className = 'pop-fx pop-fx-main';
    main.textContent = word;
    wrap.appendChild(main);
    ['POW!', 'ZAP!', 'BAM!'].forEach(function (w, i) {
      var s = document.createElement('span');
      s.className = 'pop-fx pop-fx-mini pop-fx-' + i;
      s.textContent = w;
      wrap.appendChild(s);
    });
  }

  function open(card) {
    if (!overlay) build();
    lastCard = card;
    var title = card.getAttribute('data-pop-title') ||
      (card.querySelector('h3, h4, h5') || {}).textContent || '';
    var kicker = card.getAttribute('data-pop-kicker') ||
      (card.querySelector('.card-num, .res-tag, .eyebrow') || {}).textContent || '';
    var art = ART[card.getAttribute('data-art')] || ART.hello;
    var tpl = card.querySelector('template.pop-more');
    var body = tpl ? tpl.innerHTML : '';
    if (!body) {
      var ps = card.querySelectorAll('p');
      body = Array.prototype.map.call(ps, function (p) { return '<p>' + p.innerHTML + '</p>'; }).join('');
    }
    overlay.querySelector('.pop-art').innerHTML = art();
    overlay.querySelector('.pop-kicker').textContent = kicker;
    overlay.querySelector('.pop-title').textContent = title;
    overlay.querySelector('.pop-body').innerHTML = body;

    /* fly the panel out of the card that was clicked */
    var r = card.getBoundingClientRect();
    var cx = r.left + r.width / 2 - window.innerWidth / 2;
    var cy = r.top + r.height / 2 - window.innerHeight / 2;
    panel.style.setProperty('--from-x', cx.toFixed(0) + 'px');
    panel.style.setProperty('--from-y', cy.toFixed(0) + 'px');

    document.body.classList.add('pop-locked');
    overlay.classList.add('open');
    overlay.querySelector('.pop-close').focus();
    /* The FX must be inserted AFTER the overlay is displayed: elements added
       into a display:none subtree never start their animation, so the words
       sat at their `from` keyframe (scale 0.2, opacity 0) and never appeared. */
    var word = card.getAttribute('data-fx') ||
      FX[Array.prototype.indexOf.call(document.querySelectorAll('[data-pop]'), card) % FX.length];
    requestAnimationFrame(function () { flingFx(word); });
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.classList.remove('pop-locked');
    if (lastCard) { lastCard.focus(); lastCard = null; }
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */
  function init() {
    var cards = document.querySelectorAll('[data-pop]');
    Array.prototype.forEach.call(cards, function (c) {
      c.classList.add('is-poppable');
      if (!c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0');
      c.setAttribute('role', 'button');
      if (!c.querySelector('.pop-cue')) {
        var cue = document.createElement('span');
        cue.className = 'pop-cue';
        cue.textContent = 'READ ON +';
        c.appendChild(cue);
      }
      c.addEventListener('click', function (e) {
        if (e.target.closest('a, button')) return;   // real links still win
        open(c);
      });
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(c); }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
