/* Chapter navigation and explanations follow the actual CLI replay playhead. */
(function () {
  'use strict';
  var host = document.getElementById('harnessWalkthrough');
  if (!host) return;
  var video = host.querySelector('video'), select = host.querySelector('select');
  var title = host.querySelector('[data-hw-command]'), purpose = host.querySelector('[data-hw-purpose]');
  var phase = host.querySelector('[data-hw-phase]'), inspection = host.querySelector('[data-hw-inspection]');
  var answer = host.querySelector('[data-hw-answer]'), count = host.querySelector('[data-hw-count]');
  var previous = host.querySelector('[data-hw-prev]'), next = host.querySelector('[data-hw-next]');
  var status = host.querySelector('[data-hw-status]'), chapters = [], current = -1;
  function show(index) {
    var chapter = chapters[index];
    if (current !== index) {
      current = index; title.textContent = chapter.command; purpose.textContent = chapter.purpose;
      answer.textContent = chapter.answer; select.value = String(index);
      count.textContent = (index + 1) + ' / ' + chapters.length;
      previous.disabled = index === 0; next.disabled = index === chapters.length - 1;
      host.dataset.command = chapter.key;
    }
    var event = chapter.events.filter(function (e) { return e.at <= video.currentTime + .05; }).pop();
    phase.textContent = event ? (event.kind === 'answer' ? 'Explaining the source' : 'Inspecting the checkout') : 'Starting this command';
    inspection.textContent = event ? (event.kind === 'answer' ? event.text.split(/\n\s*\n/)[0].replace(/\*\*|`/g, '') : event.text) : 'Claude Code reads local source files before answering.';
    inspection.classList.toggle('hw-finding', !!event && event.kind === 'answer');
  }
  function sync() {
    if (!chapters.length) return;
    var index = chapters.findIndex(function (c) { return video.currentTime < c.end; });
    show(index < 0 ? chapters.length - 1 : index);
  }
  function jump(index) {
    if (index < 0 || index >= chapters.length) return;
    video.currentTime = chapters[index].start + .08;
    show(index);
    video.play().catch(function () { status.textContent = 'Press play in the video to start this chapter.'; });
  }
  fetch('assets/data/harness-recording.json', {cache: 'no-cache'}).then(function (r) {
    if (!r.ok) throw new Error('recording'); return r.json();
  }).then(function (data) {
    chapters = data.chapters; video.poster = data.poster; video.src = data.video;
    chapters.forEach(function (c, i) { var option = document.createElement('option'); option.value = String(i); option.textContent = String(i + 1).padStart(2, '0') + ' · ' + c.command; select.appendChild(option); });
    select.disabled = false; show(0); status.textContent = '25 recorded command guides · waiting time condensed';
    select.addEventListener('change', function () { jump(Number(select.value)); });
    previous.addEventListener('click', function () { jump(current - 1); });
    next.addEventListener('click', function () { jump(current + 1); });
    video.addEventListener('timeupdate', sync); video.addEventListener('seeked', sync);
    host.querySelector('[data-hw-copy]').addEventListener('click', function () {
      navigator.clipboard.writeText(chapters[current].command).then(function () { status.textContent = chapters[current].command + ' copied'; }).catch(function () { status.textContent = 'Command: ' + chapters[current].command; });
    });
    window.__harnessWalkthrough = {chapters: chapters, jump: jump};
  }).catch(function () { status.textContent = 'The replay could not load. Download the transcript below or reload to try again.'; });
})();
