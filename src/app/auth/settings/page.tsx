import { AccountSettingsCards } from "@neondatabase/auth/react/ui";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

/**
 * Password, email, connected providers and active sessions.
 *
 * These used to be a hand-written form over `settings.password`. They belong to
 * Neon Auth now — it owns the credential, so it is the only thing that can
 * change it — and the dashboard's own Security card links here.
 */
export default function AccountSettingsPage() {
  return (
    <>
      <div className="w-full max-w-2xl">
        <AccountSettingsCards />
      </div>
      <MetadataIsDynamic />
    </>
  );
}
