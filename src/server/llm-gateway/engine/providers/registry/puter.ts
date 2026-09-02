export default {
  id: "puter",
  alias: "puter",
  display: {
    name: "Puter (MiMo)",
    icon: "public",
    color: "#8B5CF6",
    textIcon: "PT",
    website: "https://puter.com",
    notice: "Runs in your browser via the Puter SDK — use the ModelHub chat UI, not the API directly.",
  },
  category: "free",
  authType: "apikey",
  noAuth: true,
  // No server transport: this provider only runs client-side via the Puter
  // browser SDK (js.puter.com). The executor rejects any request that
  // reaches the server, matching how upstream ModelHub registers it.
  models: [
    { id: "xiaomi/mimo-v2.5", name: "Xiaomi MiMo V2.5 (Puter)" },
  ],
  noModelDiscovery: true,
};
