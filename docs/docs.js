/* MABEL replication docs — shared shell.
   One NAV array is the single source of truth for the chapter tree; every
   page carries only its content and this script injects the sidebar,
   active state, prev/next links, and copy buttons on code blocks. */

/* file, number, title, and which PHASE of the build it belongs to.
   Ten flat items is a list you read; four labelled phases is a shape you can
   hold in your head, and a build manual is read over days rather than in one
   sitting. The phases are the real order of work: you cannot wire a frame you
   have not printed, and you cannot calibrate a robot with no firmware. */
const NAV = [
  ["index.html",        "00", "Overview",              "Plan"],
  ["bom.html",          "01", "Bill of materials",     "Plan"],
  ["assembly.html",     "02", "Mechanical assembly",   "Build"],
  ["electronics.html",  "03", "Electronics & wiring",  "Build"],
  ["firmware.html",     "04", "Firmware",              "Build"],
  ["software.html",     "05", "Software install",      "Run"],
  ["bringup.html",      "06", "Bring-up & calibration", "Run"],
  ["operate.html",      "07", "Operating the robot",   "Run"],
  ["learning.html",     "08", "Data & learning",       "Extend"],
  ["troubleshoot.html", "09", "Troubleshooting",       "Extend"],
];

(function () {
  const here = location.pathname.split("/").pop() || "index.html";
  const idx = NAV.findIndex(([f]) => f === here);

  /* sidebar */
  const side = document.createElement("nav");
  side.className = "side";
  /* the chapter list, broken at each phase change */
  let phase = null;
  const items = NAV.map(([f, n, t, ph]) => {
    const head = ph !== phase ? `<li class="ph">${ph}</li>` : "";
    phase = ph;
    return head + `<li><a href="${f}" class="${f === here ? "here" : ""}">
      <span class="n">${n}</span><span class="t">${t}</span></a></li>`;
  }).join("");

  /* WHERE AM I IN THE BUILD. A manual is read over days, and the one thing a
     reader wants on returning to it is how far through they are. */
  const pos = idx < 0 ? 0 : idx + 1;
  const pct = Math.round((pos / NAV.length) * 100);

  side.innerHTML = `
    <a class="brand" href="../index.html">
      <img src="../assets/logo.svg" alt="" />
      <span><b>MABEL</b><i>Replication docs</i></span>
    </a>
    <div class="prog" title="chapter ${pos} of ${NAV.length}">
      <div class="prog-bar"><i style="width:${pct}%"></i></div>
      <span>${String(pos).padStart(2, "0")} <em>of</em> ${NAV.length}</span>
    </div>
    <button id="navtoggle">Chapters &#9662;</button>
    <ul class="tree">${items}</ul>
    <div class="foot">
      <a class="sbtn" href="../index.html">&#8592; The project site</a>
      <a href="https://github.com/robotmabel/MABEL">robotmabel/MABEL &#8599;</a>
      <a href="../build.html#bom">Interactive BOM &#8599;</a>
      <p>Build it, break it, tell us which step was wrong.</p>
    </div>`;
  const wrap = document.querySelector(".wrap");
  wrap.insertBefore(side, wrap.firstChild);
  side.querySelector("#navtoggle").addEventListener("click",
    () => side.classList.toggle("open"));

  /* prev / next */
  if (idx >= 0) {
    const pn = document.createElement("div");
    pn.className = "pn";
    const mk = (i, cls, label) => {
      if (i < 0 || i >= NAV.length) return "";
      const [f, n, t] = NAV[i];
      return `<a class="${cls}" href="${f}"><small>${label} · ${n}</small>${t}</a>`;
    };
    pn.innerHTML = mk(idx - 1, "prev", "previous") + mk(idx + 1, "next", "next");
    document.querySelector("main").appendChild(pn);
  }

  /* copy buttons */
  document.querySelectorAll("pre").forEach((pre) => {
    const b = document.createElement("button");
    b.className = "cbtn"; b.textContent = "copy";
    b.addEventListener("click", () => {
      navigator.clipboard.writeText(pre.innerText.replace(/^copy\n?/, ""));
      b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1200);
    });
    pre.appendChild(b);
  });
})();
