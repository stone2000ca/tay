// /setup/voice/emails — Path 1: paste 1+ real emails.
//
// Lifted from the legacy /setup/voice page, relaxed from 5 textareas
// to 1-required + N-optional (SAMPLE_COUNT initial rows, the user can
// leave the extras blank). On success the rubric is saved and the user
// is redirected to /setup/voice/preview.
//
// Server component wrapper; the form is the existing client component.

import { SupabaseWarning } from "@/components/supabase-warning";
import { EmailsForm } from "./emails-form";

export default function VoiceEmailsPath() {
  return (
    <>
      <SupabaseWarning />
      <EmailsForm />
    </>
  );
}
