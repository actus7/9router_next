import ConsoleLogClient from "./ConsoleLogClient";

// Force dynamic so Next.js standalone build includes the server-side JS file

export default function ConsoleLogPage() {
  return <ConsoleLogClient />;
}
