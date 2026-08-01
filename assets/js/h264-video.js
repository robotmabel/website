/* h264-video.js — low-latency H.264 video in the browser via WebCodecs.
 *
 * The bridge encodes each camera ONCE with hardware NVENC and exposes the H.264
 * access units on a WebSocket at  ws://<host>:8080/camera/<name>/h264  (one binary
 * message == one Annex-B access unit; see hardware_bridge/cameras/video_server.py).
 * Browsers can't read the raw UDP H.264 the iOS/Vision Pro apps use, so this is the
 * browser-native equivalent: WebCodecs VideoDecoder (hardware-accelerated) → <canvas>.
 *
 * Why this beats the MJPEG <img>: H.264 is inter-frame, so HIGH-RES (720p) costs
 * ~3-4 Mbps instead of MJPEG's ~30-60 Mbps, and WebCodecs has no MSE jitter buffer —
 * glass-to-glass is decode + one frame. We still keep the MJPEG <img> as an automatic
 * fallback (older browser, or the relay path where the WS isn't exposed).
 *
 * Usage:
 *   const s = new H264Stream({ wsUrl, canvas, onLive: live => {...} });
 *   s.start();  …  s.stop();
 */
(function (global) {
  'use strict';

  const supported = typeof global.VideoDecoder === 'function' &&
                    typeof global.EncodedVideoChunk === 'function';

  function nalType(nalu) { return nalu[0] & 0x1f; }

  // Annex-B buffer -> array of NAL units (start codes stripped).
  function splitNALUs(buf) {
    const out = [];
    const n = buf.length;
    function startLen(i) {
      if (i + 3 < n && buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) return 4;
      if (i + 2 < n && buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 1) return 3;
      return 0;
    }
    let i = 0;
    while (i < n && startLen(i) === 0) i++;
    while (i < n) {
      const sl = startLen(i); if (sl === 0) break;
      const start = i + sl;
      let j = start;
      while (j < n && startLen(j) === 0) j++;
      if (start < j) out.push(buf.subarray(start, j));
      i = j;
    }
    return out;
  }

  // "avc1.PPCCLL" from an SPS NAL (profile_idc, constraint flags, level_idc).
  function codecString(sps) {
    const hex = b => b.toString(16).padStart(2, '0');
    return 'avc1.' + hex(sps[1]) + hex(sps[2]) + hex(sps[3]);
  }

  // AVCDecoderConfigurationRecord (avcC) from SPS+PPS — the decoder `description`.
  function buildAvcC(sps, pps) {
    const len = 11 + sps.length + pps.length;
    const b = new Uint8Array(len);
    let o = 0;
    b[o++] = 1;                          // configurationVersion
    b[o++] = sps[1];                     // AVCProfileIndication
    b[o++] = sps[2];                     // profile_compatibility
    b[o++] = sps[3];                     // AVCLevelIndication
    b[o++] = 0xff;                       // 6 bits reserved | lengthSizeMinusOne = 3
    b[o++] = 0xe1;                       // 3 bits reserved | numOfSPS = 1
    b[o++] = (sps.length >> 8) & 0xff; b[o++] = sps.length & 0xff;
    b.set(sps, o); o += sps.length;
    b[o++] = 1;                          // numOfPPS = 1
    b[o++] = (pps.length >> 8) & 0xff; b[o++] = pps.length & 0xff;
    b.set(pps, o); o += pps.length;
    return b;
  }

  class H264Stream {
    constructor({ wsUrl, canvas, onLive }) {
      this.wsUrl = wsUrl;
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext('2d') : null;
      this.onLive = onLive || function () {};
      this.ws = null;
      this.decoder = null;
      this.sps = null; this.pps = null;
      this.configured = false;
      this.ts = 0;            // monotonic µs timestamp for EncodedVideoChunk
      this.live = false;
      this.lastFrame = 0;
      this._stopped = false;
    }

    static get supported() { return supported; }

    start() {
      if (!supported || !this.wsUrl) { this.onLive(false); return; }
      this._stopped = false;
      this._open();
    }

    _open() {
      if (this._stopped) return;
      let ws;
      try { ws = new WebSocket(this.wsUrl); } catch (e) { return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onmessage = ev => { this._backoff = 1000; this._onAU(new Uint8Array(ev.data)); };
      // Reconnect with backoff (1→10 s). A bridge without the /h264 route (old build,
      // or relay) just keeps failing here while the MJPEG <img> fallback shows — so we
      // back off instead of hammering a 404 every second.
      ws.onclose = () => {
        if (this._stopped) return;
        this._backoff = Math.min((this._backoff || 1000) * 1.7, 10000);
        setTimeout(() => this._open(), this._backoff);
      };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    }

    _ensureDecoder() {
      if (this.decoder && this.decoder.state !== 'closed') return;
      this.decoder = new VideoDecoder({
        output: frame => {
          this.lastFrame = performance.now();
          if (!this.live) { this.live = true; this.onLive(true); }
          if (this.ctx) {
            if (this.canvas.width !== frame.displayWidth) this.canvas.width = frame.displayWidth;
            if (this.canvas.height !== frame.displayHeight) this.canvas.height = frame.displayHeight;
            this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
          }
          frame.close();
        },
        error: e => { console.warn('H264 decode error', e); this.configured = false; }
      });
    }

    _configure() {
      if (!this.sps || !this.pps) return;
      this._ensureDecoder();
      try {
        this.decoder.configure({
          codec: codecString(this.sps),
          description: buildAvcC(this.sps, this.pps),
          optimizeForLatency: true,
          hardwareAcceleration: 'prefer-hardware'
        });
        this.configured = true;
      } catch (e) {
        console.warn('VideoDecoder.configure failed', e); this.configured = false;
      }
    }

    _onAU(au) {
      const nalus = splitNALUs(au);
      let isKey = false;
      const vcl = [];
      let paramChanged = false;
      for (const nalu of nalus) {
        const t = nalType(nalu);
        if (t === 7) { if (!this.sps || !eq(this.sps, nalu)) { this.sps = nalu.slice(); paramChanged = true; } }
        else if (t === 8) { if (!this.pps || !eq(this.pps, nalu)) { this.pps = nalu.slice(); paramChanged = true; } }
        else if (t === 5) { vcl.push(nalu); isKey = true; }
        else if (t === 1) { vcl.push(nalu); }
      }
      if (paramChanged) this._configure();
      if (!this.configured || vcl.length === 0) return;

      // VCL NALUs -> AVCC (4-byte length-prefixed), concatenated = one frame.
      let total = 0;
      for (const v of vcl) total += 4 + v.length;
      const data = new Uint8Array(total);
      let o = 0;
      for (const v of vcl) {
        data[o++] = (v.length >>> 24) & 0xff; data[o++] = (v.length >>> 16) & 0xff;
        data[o++] = (v.length >>> 8) & 0xff;  data[o++] = v.length & 0xff;
        data.set(v, o); o += v.length;
      }
      try {
        this.decoder.decode(new EncodedVideoChunk({
          type: isKey ? 'key' : 'delta',
          timestamp: this.ts,
          data
        }));
        this.ts += 33333;   // ~30 fps in µs (timing-only; display is immediate)
      } catch (e) { /* wait for the next IDR */ }
    }

    /** True if a decoded frame arrived within `ms` (the MJPEG-fallback signal). */
    isFresh(ms) { return (performance.now() - this.lastFrame) < (ms || 2500); }

    stop() {
      this._stopped = true;
      if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
      if (this.decoder && this.decoder.state !== 'closed') { try { this.decoder.close(); } catch (e) {} }
      this.decoder = null; this.configured = false; this.live = false;
    }
  }

  function eq(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  global.H264Stream = H264Stream;
})(window);
