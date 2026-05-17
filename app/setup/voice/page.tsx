// Server component wrapper for /setup/voice. The form itself is a
// client component (./voice-form.tsx) — we need that for useState +
// useTransition. The wrapper exists so we can mount <SupabaseWarning />,
// which has to be a server component to read process.env safely.

import { SupabaseWarning } from "@/components/supabase-warning";
import { VoiceCalibrationForm } from "./voice-form";

export default function VoiceCalibrationPage() {
  return (
    <>
      <SupabaseWarning />
      <VoiceCalibrationForm />
    </>
  );
}
