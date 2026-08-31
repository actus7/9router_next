"use client";

import { Card } from "@/shared/components";
import { useTtsFormState } from "./useTtsFormState";
import TtsFormFields from "./TtsFormFields";
import TtsResponseSection from "./TtsResponseSection";
import TtsLanguageModal from "./TtsLanguageModal";

export function TtsExampleCard({ providerId }: { providerId: string }) {
  const state = useTtsFormState({ providerId });

  return (
    <>
      <Card>
        <h2 className="text-lg font-semibold mb-4">Example</h2>
        <div className="flex flex-col gap-2.5">
          <TtsFormFields state={state} />
          <TtsResponseSection state={state} />
        </div>
      </Card>

      {state.modalOpen && (
        <TtsLanguageModal
          setModalOpen={state.setModalOpen}
          modalSearch={state.modalSearch}
          setModalSearch={state.setModalSearch}
          modalLoading={state.modalLoading}
          modalError={state.modalError}
          filteredLanguages={state.filteredLanguages}
          selectedLang={state.selectedLang}
          handlePickLanguage={state.handlePickLanguage}
        />
      )}
    </>
  );
}
