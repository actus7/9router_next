import ConsoleLogClient from "./ConsoleLogClient";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

// Force dynamic so Next.js standalone build includes the server-side JS file

export default function ConsoleLogPage() {
  return (
    <>
      <AdminOnly>
        <ConsoleLogClient />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
