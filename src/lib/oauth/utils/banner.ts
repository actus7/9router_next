import figlet from "figlet";
import gradient from "gradient-string";
import chalkAnimation from "chalk-animation";

/**
 * Display banner
 */
export function showBanner(): void {
  const banner: string = figlet.textSync("LLM Proxy", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
    verticalLayout: "default",
  });

  console.log("\n" + gradient.pastel.multiline(banner));
  console.log(gradient.cristal("  🚀 OAuth CLI for AI Providers\n"));
}

/**
 * Display simple banner (no animation)
 */
export function showSimpleBanner(): void {
  const banner: string = figlet.textSync("EP CLI", {
    font: "Standard",
    horizontalLayout: "default",
  });
  console.log(gradient.pastel.multiline(banner));
  console.log(gradient.cristal("  OAuth CLI for AI Providers\n"));
}

/**
 * Display success animation
 */
export async function showSuccess(message: string): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    const animation = chalkAnimation.rainbow(`\n✨ ${message}\n`);
    setTimeout(() => {
      animation.stop();
      resolve();
    }, 1000);
  });
}

interface LoadingIndicator {
  stop: () => void;
}

/**
 * Display loading animation
 */
export function showLoading(text: string): LoadingIndicator {
  const frames: string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i: number = 0;
  
  const interval: ReturnType<typeof setInterval> = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${text}`);
    i = (i + 1) % frames.length;
  }, 80);

  return {
    stop: (): void => {
      clearInterval(interval);
      process.stdout.write("\r");
    },
  };
}
