/* ═══════════════════════════════════════════════════════════════════
   MABEL — swerve velocity playground (top-down, 2-D canvas)
   Drag to set the base translation velocity; a slider sets the yaw rate.
   The three swerve modules steer to the commanded body twist via the same
   inverse-kinematics MABEL's drive uses:  v_i = v + ω × r_i  (per module).
   Tip-safe speed cap (0.8 m/s) is drawn as the outer ring.
═══════════════════════════════════════════════════════════════════ */
const canvas = document.getElementById('swerveCanvas');
if (canvas) initSwerve(canvas);

function initSwerve(cv) {
  const ctx = cv.getContext('2d');
  const MAX_LIN = 0.8;        // m/s  (config MAX_LIN_SPEED)
  const MAX_ANG = 2.0;        // rad/s (config MAX_ANG_SPEED)

  // three swerve modules in the robot frame (x forward, y left), metres
  const MODULES = [
    { name: 'FL', r: [0.16, 0.14] },
    { name: 'FR', r: [0.16, -0.14] },
    { name: 'B', r: [-0.20, 0.0] },
  ];

  let vx = 0, vy = 0, omega = 0;   // body twist
  let dragging = false;

  const out = {
    vx: document.querySelector('[data-sw="vx"]'),
    vy: document.querySelector('[data-sw="vy"]'),
    sp: document.querySelector('[data-sw="speed"]'),
    w: document.querySelector('[data-sw="omega"]'),
    fl: document.querySelector('[data-sw="FL"]'),
    fr: document.querySelector('[data-sw="FR"]'),
    b: document.querySelector('[data-sw="B"]'),
  };
  const yaw = document.querySelector('[data-sw-yaw]');
  const reset = document.querySelector('[data-sw-reset]');

  // robot-frame (m) → screen (px). screen up = +x(forward), screen left = +y(left)
  let cx = 0, cy = 0, R = 0, mPerR = 0.42;   // metres mapped to the ring radius
  function layout() {
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2; cy = h / 2; R = Math.min(w, h) * 0.40;
  }
  const sx = (px, py) => cx - py * (R / mPerR);
  const sy = (px, py) => cy - px * (R / mPerR);
  const velPx = R / MAX_LIN;        // px per (m/s) for the velocity arrow

  function setVelFromPointer(ev) {
    const r = cv.getBoundingClientRect();
    const dx = (ev.clientX - r.left) - cx;
    const dy = (ev.clientY - r.top) - cy;
    // screen → body: forward = -dy, left = -dx
    let nvx = -dy / velPx, nvy = -dx / velPx;
    const sp = Math.hypot(nvx, nvy);
    if (sp > MAX_LIN) { nvx *= MAX_LIN / sp; nvy *= MAX_LIN / sp; }
    vx = nvx; vy = nvy;
  }

  cv.addEventListener('pointerdown', (e) => { dragging = true; cv.setPointerCapture(e.pointerId); setVelFromPointer(e); });
  cv.addEventListener('pointermove', (e) => { if (dragging) setVelFromPointer(e); });
  cv.addEventListener('pointerup', () => { dragging = false; });
  cv.addEventListener('pointercancel', () => { dragging = false; });

  if (yaw) yaw.addEventListener('input', () => { omega = parseFloat(yaw.value); });
  if (reset) reset.addEventListener('click', () => {
    vx = vy = omega = 0; if (yaw) yaw.value = 0;
  });
  new ResizeObserver(layout).observe(cv);
  layout();

  const COL = { ink: '#161412', rust: '#C25B2A', paper: '#DCD6C7', ash: '#8B847A', bone: '#F2EEE6' };

  function arrow(x0, y0, x1, y1, col, head = 7, lw = 2) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4));
    ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
  }

  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // tip-safe speed ring + crosshair
    ctx.strokeStyle = 'rgba(22,20,18,0.16)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(22,20,18,0.12)';
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.ash; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('FWD', cx, cy - R - 8); ctx.fillText('0.8 m/s', cx + R - 22, cy - 6);

    // chassis footprint (triangle through the modules)
    ctx.beginPath();
    MODULES.forEach((m, i) => {
      const X = sx(m.r[0], m.r[1]), Y = sy(m.r[0], m.r[1]);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(194,91,42,0.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(22,20,18,0.28)'; ctx.lineWidth = 2; ctx.stroke();

    // per-module swerve IK: v_i = v + ω × r_i
    const steers = {};
    for (const m of MODULES) {
      const wx = vx - omega * m.r[1];
      const wy = vy + omega * m.r[0];
      const steer = Math.atan2(wy, wx);          // robot-frame heading
      const speed = Math.hypot(wx, wy);
      steers[m.name] = steer;
      const X = sx(m.r[0], m.r[1]), Y = sy(m.r[0], m.r[1]);

      // wheel body, oriented along the steer direction (screen: fwd=-y, left=-x)
      const ang = Math.atan2(-wx, -wy);          // screen angle of the rolling dir
      ctx.save(); ctx.translate(X, Y); ctx.rotate(ang);
      ctx.fillStyle = COL.ink;
      ctx.beginPath(); roundRect(ctx, -5, -11, 10, 22, 3); ctx.fill();
      ctx.restore();

      // module velocity arrow (rust), length ∝ speed
      const L = (speed / MAX_LIN) * (R * 0.42);
      if (L > 2) arrow(X, Y, X - wy / speed * L, Y - wx / speed * L, COL.rust, 7, 2.4);

      ctx.fillStyle = COL.ash; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
      ctx.fillText(m.name, X, Y - 16);
    }

    // commanded translation velocity (big rust arrow from centre)
    const sp = Math.hypot(vx, vy);
    if (sp > 0.01) arrow(cx, cy, cx - vy * velPx, cy - vx * velPx, COL.rust, 10, 3);
    ctx.fillStyle = COL.ink; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();

    // readouts
    if (out.vx) out.vx.textContent = vx.toFixed(2) + ' m/s';
    if (out.vy) out.vy.textContent = vy.toFixed(2) + ' m/s';
    if (out.sp) out.sp.textContent = sp.toFixed(2) + ' m/s';
    if (out.w) out.w.textContent = omega.toFixed(1) + ' rad/s';
    const deg = (a) => (a * 180 / Math.PI).toFixed(0) + '°';
    if (out.fl) out.fl.textContent = deg(steers.FL || 0);
    if (out.fr) out.fr.textContent = deg(steers.FR || 0);
    if (out.b) out.b.textContent = deg(steers.B || 0);

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}
