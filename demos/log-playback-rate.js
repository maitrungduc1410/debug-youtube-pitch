// Mỗi lần có code ghi playbackRate / preservesPitch sẽ in 1 dòng kèm stack trace .
(() => {
  const proto = HTMLMediaElement.prototype;
  const props = ['playbackRate', 'preservesPitch'];

  if (window.stopLog) window.stopLog();

  const originals = {};
  for (const prop of props) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.set) continue;
    originals[prop] = desc;
    Object.defineProperty(proto, prop, {
      ...desc,
      set(value) {
        console.trace(`%c${prop} = ${value}`, 'color:#ffd43b;font-weight:bold;font-size:14px');
        return desc.set.call(this, value);
      },
    });
  }

  window.stopLog = () => {
    for (const [prop, desc] of Object.entries(originals)) Object.defineProperty(proto, prop, desc);
    delete window.stopLog;
    console.log('đã gỡ, trả lại như cũ');
  };

  for (const v of document.querySelectorAll('video')) {
    console.log(`video hiện tại: playbackRate = ${v.playbackRate}, preservesPitch = ${v.preservesPitch}`);
  }
  console.log(`sẽ in log mỗi khi có code ghi: ${Object.keys(originals).join(', ')}`);
})();
