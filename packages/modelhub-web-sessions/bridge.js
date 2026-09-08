(() => {
  if (globalThis.__modelhubSessionBridge) return;
  globalThis.__modelhubSessionBridge = true;
  const channel = "modelhub-web-session-v1";
  const pending = new Map();
  const reply = (requestId, data) => window.postMessage({ ...data, channel, direction: "extension", requestId }, location.origin);
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || event.origin !== location.origin || msg?.channel !== channel || msg.direction !== "dashboard") return;
    if (typeof msg.requestId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(msg.requestId)) return;
    if (!["hello", "connect", "cancel"].includes(msg.type) || !location.pathname.startsWith("/dashboard/")) return;
    if (msg.type === "connect") {
      if (pending.size >= 4) return;
      pending.set(msg.requestId, setTimeout(() => pending.delete(msg.requestId), 185000));
    }
    if (msg.type === "cancel") { clearTimeout(pending.get(msg.requestId)); pending.delete(msg.requestId); }
    // sendMessage throws *synchronously* once the extension is reloaded/disabled,
    // so the promise catch alone leaves an uncaught "Extension context invalidated".
    const dead = () => reply(msg.requestId, { type: "error", error: "A extensão foi atualizada ou desativada. Recarregue esta página." });
    try {
      chrome.runtime.sendMessage({ type: msg.type, requestId: msg.requestId, provider: msg.provider }).then((response) => {
        if (response) reply(msg.requestId, response);
      }).catch(dead);
    } catch { dead(); }
  });
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !pending.has(msg?.requestId)) return;
    if (!["captured", "error"].includes(msg.type)) return;
    clearTimeout(pending.get(msg.requestId));
    pending.delete(msg.requestId);
    reply(msg.requestId, msg);
    respond({ received: true });
  });
})();
