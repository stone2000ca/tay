// /setup/voice/url — Path 3: 1 anchor email + company URL.

import { SupabaseWarning } from "@/components/supabase-warning";
import { UrlForm } from "./url-form";

export default function VoiceUrlPath() {
  return (
    <>
      <SupabaseWarning />
      <UrlForm />
    </>
  );
}
