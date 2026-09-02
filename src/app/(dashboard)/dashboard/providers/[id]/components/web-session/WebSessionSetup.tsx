"use client";

import { useState, useCallback } from "react";
import type { CredentialOrigin } from "../../utils/webSessionCredential";
import ImportStep from "./ImportStep";
import NameSaveStep from "./NameSaveStep";

interface ProxyPool {
  id: string;
  name: string;
}

interface WebSessionSetupProps {
  provider: string;
  providerName: string;
  website?: string;
  authHint?: string;
  proxyPools?: ProxyPool[];
  error?: string;
  existingNames?: string[];
  onSave: (formData: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export default function WebSessionSetup({
  provider,
  providerName,
  website,
  authHint,
  proxyPools,
  error,
  existingNames,
  onSave,
  onClose,
}: WebSessionSetupProps) {
  const [step, setStep] = useState<"import" | "name">("import");
  const [credential, setCredential] = useState<string | null>(null);
  const [origin, setOrigin] = useState<CredentialOrigin | null>(null);

  const handleExtracted = useCallback((cred: string, orig: CredentialOrigin) => {
    setCredential(cred);
    setOrigin(orig);
    setStep("name");
  }, []);

  const handleBack = useCallback(() => {
    setCredential(null);
    setOrigin(null);
    setStep("import");
  }, []);

  if (step === "import") {
    return (
      <ImportStep
        providerName={providerName}
        website={website}
        authHint={authHint}
        onExtracted={handleExtracted}
      />
    );
  }

  if (step === "name" && credential && origin) {
    return (
      <NameSaveStep
        provider={provider}
        providerName={providerName}
        credential={credential}
        origin={origin}
        proxyPools={proxyPools}
        error={error}
        existingNames={existingNames}
        onSave={onSave}
        onBack={handleBack}
        onClose={onClose}
      />
    );
  }

  return null;
}
