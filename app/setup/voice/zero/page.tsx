// /setup/voice/zero — Path 0: write a sample on the spot.

import { SupabaseWarning } from "@/components/supabase-warning";
import { ZeroForm } from "./zero-form";

export default function VoiceZeroPath() {
  return (
    <>
      <SupabaseWarning />
      <ZeroForm />
    </>
  );
}
