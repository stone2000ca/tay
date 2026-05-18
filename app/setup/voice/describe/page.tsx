// /setup/voice/describe — Path 2: 1 anchor email + 3 questions.

import { SupabaseWarning } from "@/components/supabase-warning";
import { DescribeForm } from "./describe-form";

export default function VoiceDescribePath() {
  return (
    <>
      <SupabaseWarning />
      <DescribeForm />
    </>
  );
}
