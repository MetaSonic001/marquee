import { Suspense } from "react";
import { EventView } from "@/components/event-view";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <EventView id={id} />
    </Suspense>
  );
}
