// Watchdog + network monitor timings (shared by both services)
export const RESTART_COOLDOWN_MS: number = 120000;
export const NETWORK_SETTLE_MS: number = 2500;
export const WATCHDOG_INTERVAL_MS: number = 60000;
export const NETWORK_CHECK_INTERVAL_MS: number = 5000;

// Skip virtual/transient interfaces (tailscale utun, AirDrop awdl, bridges) that flap and cause false netchange
export const VIRTUAL_IFACE_REGEX: RegExp = /^(utun|awdl|llw|anpi|bridge|gif|stf|ipsec|ap|tun|tap|vmnet|veth|docker)/i;
