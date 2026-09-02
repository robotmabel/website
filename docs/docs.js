/* MABEL replication docs — shared shell.
   One NAV array is the single source of truth for the chapter tree; every
   page carries only its content and this script injects the sidebar,
   active state, prev/next links, and copy buttons on code blocks. */

const NAV = [
  ["index.html",        "00", "Overview"],
  ["bom.html",          "01", "Bill of materials"],
  ["assembly.html",     "02", "Mechanical assembly"],
  ["electronics.html",  "03", "Electronics & wiring"],
  ["firmware.html",     "04", "Firmware"],
  ["software.html",     "05", "Software install"],
  ["bringup.html",      "06", "Bring-up & calibration"],
  ["operate.html",      "07", "Operating the robot"],
  ["learning.html",     "08", "Data & learning"],
  ["troubleshoot.html", "09", "Troubleshooting"],
];

(function () {
  const here = location.pathname.split("/").pop() || "index.html";
  const idx = NAV.findIndex(([f]) => f === here);

  /* sidebar */
  const side = document.createElement("nav");
  side.className = "side";
  side.innerHTML = `
    <a class="brand" href="../index.html">
      <img src="../assets/logo.svg" alt="" />
      <span><b>MABEL</b><br/><span>replication docs</span></span>
    </a>
    <button id="navtoggle">chapters ▾</button>
    <ul class="tree">
      ${NAV.map(([f, n, t]) =>
        `<li><a href="${f}" class="${f === here ? "here" : ""}">
           <span class="n">${n}</span>${t}</a></li>`).join("")}
    </ul>
    <div class="foot">
      <a href="https://github.com/robotmabel/MABEL">robotmabel/MABEL ↗</a><br/>
      <a href="../index.html">project site ↗</a>
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
