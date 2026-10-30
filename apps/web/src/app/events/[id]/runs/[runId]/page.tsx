import { Soundcheck } from "@/components/soundcheck";

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  return <Soundcheck eventId={id} runId={runId} />;
}
