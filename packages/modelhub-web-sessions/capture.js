// No session values cross the page's DOM or postMessage channel here.
(() => {
  if (globalThis.__modelhubCaptureTimer) clearInterval(globalThis.__modelhubCaptureTimer);
  const tick = () => chrome.runtime.sendMessage({ type: "capture-tick" }).then((response) => {
    if (!response?.active) { clearInterval(globalThis.__modelhubCaptureTimer); globalThis.__modelhubCaptureTimer = null; }
  }).catch(() => clearInterval(globalThis.__modelhubCaptureTimer));
  globalThis.__modelhubCaptureTimer = setInterval(tick, 2000);
  tick();
})();
