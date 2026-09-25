import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitReachedMessage, reviewAllowance } from "@/lib/review-allowance";
import { Card } from "@/components/ui/card";
import { Body, Title } from "@/components/ui/typography";
import UploadForm from "./upload-form";

export default async function UploadPage() {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");

  const allowance = await reviewAllowance(createAdminClient(), associate.id);
  if (allowance.remaining > 0) return <UploadForm />;

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
        ← Back to dashboard
      </Link>
      <Card padding="lg" className="mt-4">
        <Title className="text-[var(--text-primary)] tracking-tight mb-1">Monthly limit reached</Title>
        <Body as="p" className="text-[var(--text-secondary)]">
          {limitReachedMessage(allowance)}
        </Body>
      </Card>
    </div>
  );
}
