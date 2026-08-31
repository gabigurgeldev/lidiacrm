import { TenantTeamClient } from "./_client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantTeamPage({ params }: Props) {
  const { id } = await params;
  return <TenantTeamClient organizationId={id} />;
}
