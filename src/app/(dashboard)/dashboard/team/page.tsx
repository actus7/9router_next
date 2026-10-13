import TeamClient from "./TeamClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

/**
 * Members, invitations and access limits. Everything on it is read in the
 * browser through Neon Auth's organization API and `/api/access`, so the page
 * itself awaits nothing and renders synchronously.
 */
export default function TeamPage() {
  return (
    <>
      <TeamClient />
      <MetadataIsDynamic />
    </>
  );
}
