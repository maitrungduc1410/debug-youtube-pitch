// Dán toàn bộ file này vào Console của Firefox khi đang mở một video YouTube.
// Trước khi dán: tua tới đoạn có người nói liên tục, rồi bấm pause.
// Sau khi chạy xong, tải lại trang để gỡ hook và audio capture.

(async () => {
  const STEPS = [
    { label: '1x (gốc)', rate: 1, pp: true },
    { label: '2x, giữ giọng', rate: 2, pp: true },
    { label: '2x, TẮT giữ giọng', rate: 2, pp: false },
    { label: '4x', rate: 4, pp: true },
    { label: '7.9x', rate: 7.9, pp: true },
    { label: '8x', rate: 8, pp: true },
    { label: '8.1x (trên ngưỡng 8?)', rate: 8.1, pp: true },
    { label: '16x', rate: 16, pp: true },
    { label: 'gán 17x', rate: 17, pp: true },
    { label: '0.13x', rate: 0.13, pp: true },
    { label: '0.12x (dưới 1/8?)', rate: 0.12, pp: true },
  ];
  const SETTLE_MS = 600;
  const MEASURE_MS = 2000;
  // Firefox's mozCaptureStream() takes the audio away from the speakers, so the
  // analyser is also wired to the output. Set to false if you hear an echo.
  const ROUTE_TO_SPEAKERS = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const player = document.getElementById('movie_player');
  const v = player?.querySelector('video') ?? document.querySelector('video');
  if (!v) {
    console.error('Không tìm thấy thẻ <video>.');
    return;
  }

  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
    zIndex: 2147483647, background: 'rgba(0,0,0,.88)', color: '#fff',
    font: '600 26px/1.4 system-ui, sans-serif', padding: '16px 28px',
    borderRadius: '12px', textAlign: 'center', maxWidth: '90vw',
  });
  const text = document.createElement('div');
  const btn = document.createElement('button');
  btn.textContent = 'Bắt đầu đo';
  Object.assign(btn.style, { marginTop: '12px', font: 'inherit', padding: '6px 18px', cursor: 'pointer' });
  box.append(text, btn);
  document.body.append(box);
  const say = (t) => { text.textContent = t; };

  say('Bấm nút để bắt đầu (cần một cú click để được phép bật âm thanh)');
  await new Promise((r) => { btn.onclick = r; });
  btn.remove();

  const info = {
    browser: navigator.userAgent.match(/(Firefox|Chrome)\/[\d.]+/)?.[0],
    playerJs: window.ytcfg?.get?.('PLAYER_JS_URL'),
    preservesPitchDefault: v.preservesPitch,
    hasMozPreservesPitch: 'mozPreservesPitch' in v,
    ytAvailableRates: player?.getAvailablePlaybackRates?.(),
    ytServerMaxRate: player?.getPlayerResponse?.()?.playerConfig?.granularVariableSpeedConfig?.maximumPlaybackRate,
  };

  const writes = [];
  const proto = HTMLMediaElement.prototype;
  for (const prop of ['playbackRate', 'preservesPitch', 'defaultPlaybackRate']) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d?.set) continue;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set(val) {
        writes.push({ prop, val, from: new Error().stack.split('\n').slice(1, 4).join(' <- ') });
        return d.set.call(this, val);
      },
    });
  }

  say('Thử: YouTube tự chuyển sang 2x thì nó ghi vào đâu?');
  player?.setPlaybackRate?.(2);
  await sleep(1000);
  const youtubeWritesAt2x = writes.splice(0).filter((w) => !w.from.includes('debugger eval'));
  player?.setPlaybackRate?.(4);
  await sleep(500);
  const youtubeAccepts4x = { videoRate: v.playbackRate, ytRate: player?.getPlaybackRate?.() };
  player?.setPlaybackRate?.(1);
  await sleep(300);

  const limits = {};
  for (const r of [16, 17, 100, -1]) {
    try {
      v.playbackRate = r;
      limits[r] = `không lỗi, đọc lại playbackRate = ${v.playbackRate}`;
    } catch (e) {
      limits[r] = `${e.name}: ${e.message}`;
    }
  }
  v.playbackRate = 1;

  const ctx = new AudioContext();
  await ctx.resume();
  const stream = v.captureStream ? v.captureStream() : v.mozCaptureStream();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  src.connect(an);
  if (ROUTE_TO_SPEAKERS && !v.captureStream) an.connect(ctx.destination);

  const sr = ctx.sampleRate;
  const freq = new Float32Array(an.frequencyBinCount);
  const td = new Float32Array(an.fftSize);
  const hzPerBin = sr / an.fftSize;
  const minLag = Math.floor(sr / 400);
  const maxLag = Math.ceil(sr / 70);

  function estimateF0(buf, rms) {
    if (rms < 0.01) return null;
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + lag < buf.length; i++) {
        num += buf[i] * buf[i + lag];
        e1 += buf[i] * buf[i];
        e2 += buf[i + lag] * buf[i + lag];
      }
      const c = num / Math.sqrt(e1 * e2 || 1);
      if (c > best) { best = c; bestLag = lag; }
    }
    return best > 0.6 ? sr / bestLag : null;
  }

  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };

  async function measure(ms) {
    const rmsList = [], centroids = [], f0s = [];
    const end = performance.now() + ms;
    while (performance.now() < end) {
      an.getFloatTimeDomainData(td);
      let s = 0;
      for (const x of td) s += x * x;
      const rms = Math.sqrt(s / td.length);
      rmsList.push(rms);

      an.getFloatFrequencyData(freq);
      let num = 0, den = 0;
      for (let i = 1; i < freq.length; i++) {
        const m = 10 ** (freq[i] / 20);
        num += m * i * hzPerBin;
        den += m;
      }
      if (den && rms >= 0.01) centroids.push(num / den);

      const f0 = estimateF0(td, rms);
      if (f0) f0s.push(f0);
      await sleep(60);
    }
    const avgRms = rmsList.reduce((a, b) => a + b, 0) / rmsList.length;
    return {
      rms: +avgRms.toFixed(4),
      centroidHz: centroids.length ? Math.round(median(centroids)) : null,
      f0Hz: f0s.length ? Math.round(median(f0s)) : null,
      voicedFrames: f0s.length,
    };
  }

  const t0 = v.currentTime;
  await v.play();
  const rows = [];
  for (const [i, step] of STEPS.entries()) {
    say(`(${i + 1}/${STEPS.length}) ${step.label}: nghe xem có tiếng không, giọng có bị cao không`);
    v.currentTime = t0;
    v.preservesPitch = step.pp;
    let setError = null;
    try {
      v.playbackRate = step.rate;
    } catch (e) {
      setError = e.name;
    }
    await sleep(SETTLE_MS);
    const m = await measure(MEASURE_MS);
    rows.push({
      step: step.label,
      rateSet: step.rate,
      rateReadBack: v.playbackRate,
      setError,
      preservesPitch: v.preservesPitch,
      muted: v.muted,
      ...m,
    });
  }

  v.pause();
  v.playbackRate = 1;
  v.preservesPitch = true;
  v.currentTime = t0;
  await ctx.close();

  const result = { info, youtubeWritesAt2x, youtubeAccepts4x, limits, rows };
  console.log('=== Thông tin ===', info);
  console.log('=== YouTube ghi gì khi chuyển 2x ===', youtubeWritesAt2x);
  console.log('=== Nhờ YouTube API đặt 4x ===', youtubeAccepts4x);
  console.log('=== Gán playbackRate ngoài giới hạn ===', limits);
  console.table(rows);
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  try {
    copy(json);
    say('Xong! Kết quả JSON đã được copy vào clipboard. Tải lại trang để gỡ hook.');
  } catch {
    say('Xong! Copy đoạn JSON cuối cùng trong Console. Tải lại trang để gỡ hook.');
  }
  setTimeout(() => box.remove(), 8000);
})();
