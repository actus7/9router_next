// Tailscale Funnel: cert provisioning + *.ts.net DNS propagation slower → longer timeouts
export const HEALTH_CHECK: {
  intervalMs: number;
  timeoutMs: number;
  fetchTimeoutMs: number;
  dnsTimeoutMs: number;
} = {
  intervalMs: 2000,
  timeoutMs: 180000,
  fetchTimeoutMs: 8000,
  dnsTimeoutMs: 3000,
};
