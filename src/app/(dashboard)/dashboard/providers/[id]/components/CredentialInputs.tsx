"use client";

import { FormInput as Input } from "@/shared/components/FormInput";
import { Button } from "@/components/ui/button";

interface CredentialInputsProps {
  name: string;
  apiKey: string;
  credentialLabel: string;
  credentialPlaceholder: string;
  isCookie: boolean;
  validating: boolean;
  saving: boolean;
  onNameChange: (name: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onValidate: () => void;
}

export default function CredentialInputs({
  name, apiKey, credentialLabel, credentialPlaceholder, isCookie, validating, saving,
  onNameChange, onApiKeyChange, onValidate,
}: CredentialInputsProps) {
  return (
    <>
      <Input label="Name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onNameChange(e.target.value)} placeholder="Production Key" />
      <div className="flex gap-2">
        <Input label={credentialLabel} type={isCookie ? "text" : "password"} value={apiKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onApiKeyChange(e.target.value)} placeholder={credentialPlaceholder} className="flex-1" />
        <div className="pt-6">
          <Button onClick={onValidate} disabled={!apiKey || validating || saving} variant="secondary">
            {validating ? "Checking..." : "Check"}
          </Button>
        </div>
      </div>
    </>
  );
}
