import net from "net";

const INTERNET_CHECK: {
  host: string;
  port: number;
  timeoutMs: number;
} = {
  host: "1.1.1.1",
  port: 443,
  timeoutMs: 3000,
};

export function checkInternet(): Promise<boolean> {
  return new Promise<boolean>((resolve: (value: boolean) => void) => {
    const socket: net.Socket = new net.Socket();
    let done: boolean = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(INTERNET_CHECK.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try { socket.connect(INTERNET_CHECK.port, INTERNET_CHECK.host); }
    catch { finish(false); }
  });
}
