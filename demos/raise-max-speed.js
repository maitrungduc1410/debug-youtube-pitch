// Sửa cấu hình tốc độ server gửi về: maximumPlaybackRate 200 -> 400, thêm nút 2.5 / 3 / 4.
(() => {
  if (window.restoreFetch) window.restoreFetch();

  const originalFetch = window.fetch;
  const EXTRA = [
    [250, 0],
    [300, 1],
    [400, 1],
  ];

  const patchSpeed = (node, path, hits) => {
    if (!node || typeof node !== 'object') return;
    const g = node.granularVariableSpeedConfig;
    if (g) {
      const before = g.maximumPlaybackRate;
      g.maximumPlaybackRate = 400;
      const opts = g.defaultPlaybackRateOptions || [];
      for (const o of opts) o.isPremiumUpsell = false;
      for (const [value, priority] of EXTRA) {
        if (!opts.some((o) => o.value === value)) {
          opts.push({ label: (value / 100).toFixed(1), value, isPremiumUpsell: false, priority });
        }
      }
      opts.sort((a, b) => a.value - b.value);
      g.defaultPlaybackRateOptions = opts;
      hits.push({ path: `${path}.granularVariableSpeedConfig`, before, after: 400, options: opts.map((o) => o.label).join(' / ') });
    }
    for (const k in node) patchSpeed(node[k], `${path}.${k}`, hits);
  };

  window.fetch = async function (input, init) {
    const res = await originalFetch.apply(this, arguments);
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!/\/youtubei\/v1\/(player|get_watch)/.test(url)) return res;
    try {
      const json = JSON.parse(await res.clone().text());
      const hits = [];
      patchSpeed(json, '$', hits);
      if (!hits.length) return res;
      console.log(`%c${url.split('?')[0]}: maximumPlaybackRate ${hits[0].before} -> 400`, 'color:#ffd43b;font-weight:bold;font-size:14px');
      console.table(hits);
      return new Response(JSON.stringify(json), { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      console.warn('không sửa được response:', e);
      return res;
    }
  };

  window.restoreFetch = () => {
    window.fetch = originalFetch;
    delete window.restoreFetch;
    console.log('đã gỡ, trả lại fetch như cũ (tải lại trang để về cấu hình gốc)');
  };

  console.log('đã sẵn sàng: giờ bấm sang một video đề xuất, rồi mở menu Tốc độ phát');
})();
