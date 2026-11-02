/* Keep visible gallery clips moving after reveals, tab changes and autoplay blocks. */
(function () {
  'use strict';
  var book=document.getElementById('rgGrid');if(!book)return;
  var videos=Array.from(book.querySelectorAll('video')),scheduled=false;
  function visible(v) { var r=v.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&v.offsetParent!==null; }
  function attempt(v) {
    if(document.hidden||document.body.classList.contains('pop-locked')||v.dataset.userPaused||!visible(v)||!v.src)return;
    v.muted=true;v.defaultMuted=true;
    var promise=v.play();if(promise&&promise.catch)promise.catch(function(){v.closest('.rg-cell').classList.add('rg-paused');});
  }
  function refresh() { scheduled=false;videos.forEach(attempt); }
  function schedule() { if(!scheduled){scheduled=true;requestAnimationFrame(refresh);} }
  videos.forEach(function(v){
    v.autoplay=true;v.muted=true;v.defaultMuted=true;v.loop=true;v.playsInline=true;v.setAttribute('webkit-playsinline','');
    var cell=v.closest('.rg-cell'),button=document.createElement('button');
    button.type='button';button.className='rg-clip-toggle';cell.appendChild(button);
    function state(){var paused=v.paused;cell.classList.toggle('rg-paused',paused);button.textContent=paused?'▶ Play':'Ⅱ Pause';button.setAttribute('aria-label',(paused?'Play ':'Pause ')+(v.getAttribute('aria-label')||'robot clip'));}
    button.addEventListener('click',function(){
      if(!v.paused){v.dataset.userPaused='true';v.pause();}
      else {delete v.dataset.userPaused;if(v.error)v.load();var promise=v.play();if(promise&&promise.catch)promise.catch(function(){v.controls=true;});}
    });
    v.addEventListener('click',function(){if(!v.controls)button.click();});
    v.addEventListener('playing',state);v.addEventListener('pause',state);v.addEventListener('error',state);
    v.addEventListener('loadeddata',function(){attempt(v);});v.addEventListener('canplay',function(){attempt(v);});
    cell.addEventListener('transitionend',function(e){if(e.propertyName==='clip-path')attempt(v);});state();
  });
  new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting)attempt(e.target);});},{threshold:.05}).observe(book);
  // Returning to a tab can pause media without changing its intersection state.
  addEventListener('pageshow',schedule);addEventListener('focus',schedule);document.addEventListener('visibilitychange',schedule);
  book.addEventListener('scroll',schedule,{passive:true,capture:true});
})();
