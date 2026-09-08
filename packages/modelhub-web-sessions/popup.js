import { PROVIDERS, isDashboardUrl, permissionOrigin } from "./providers.js";

const status = document.getElementById("status");
const destination = document.getElementById("destination");
const primary = document.getElementById("primary");
const reject = document.getElementById("reject");
const revoke = document.getElementById("revoke");
const send = async (message) => {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.type === "error") throw new Error(result.error);
  return result;
};
const fail = (error) => { status.textContent = error.message || "Não foi possível continuar. Tente novamente."; primary.disabled = false; };

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { job } = await send({ type: "popup-state" });
  if (job) {
    const config = PROVIDERS[job.provider];
    status.textContent = job.providerTab ? `Faça login em ${config.name}. Para Z.ai, envie uma mensagem para capturar a verificação.` : `Conectar sua conta ${config.name}?`;
    destination.textContent = `Destino da sessão: ${job.origin}`;
    reject.hidden = false;
    reject.onclick = async () => { try { await send({ type: "reject", requestId: job.requestId }); window.close(); } catch (error) { fail(error); } };
    if (job.providerTab) return;
    primary.hidden = false;
    primary.textContent = `Autorizar e abrir ${config.name}`;
    primary.onclick = async () => {
      try {
        // Called directly from a user gesture, before any other await.
        const granted = await chrome.permissions.request({ origins: [permissionOrigin(config.url)], ...(config.mode === "cookies" ? { permissions: ["cookies"] } : {}) });
        if (!granted) { status.textContent = "Acesso não concedido. Autorize para conectar ou cancele."; return; }
        primary.disabled = true;
        await send({ type: "approve", requestId: job.requestId });
        window.close();
      } catch (error) { fail(error); }
    };
    return;
  }
  if (!tab || !isDashboardUrl(tab.url)) {
    status.textContent = "Abra o dashboard do ModelHub em uma aba e clique nesta extensão para autorizar.";
    return;
  }
  const origin = new URL(tab.url).origin;
  destination.textContent = origin;
  status.textContent = "Autorize este endereço para receber as sessões que você escolher conectar.";
  primary.hidden = false;
  primary.textContent = "Autorizar este ModelHub";
  primary.onclick = async () => {
    try {
      const granted = await chrome.permissions.request({ origins: [permissionOrigin(tab.url)] });
      if (!granted) { status.textContent = "Acesso não concedido. Você pode tentar novamente."; return; }
      primary.disabled = true;
      await send({ type: "authorize", tabId: tab.id, origin });
      status.textContent = "ModelHub autorizado. Volte ao dashboard e clique em Verificar extensão.";
    } catch (error) { fail(error); }
  };
}
revoke.onclick = async () => {
  try { await send({ type: "revoke" }); status.textContent = "Autorizações removidas. Nenhuma sessão será capturada."; primary.hidden = true; reject.hidden = true; }
  catch (error) { fail(error); }
};
init().catch(fail);
