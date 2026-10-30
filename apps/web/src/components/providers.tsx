"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { useState } from "react";
import { WakeGate } from "./wake-gate";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={qc}>
      <Tooltip.Provider delayDuration={150}>
        <WakeGate>{children}</WakeGate>
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: { background: "#1c1c1f", color: "#EEE9E0", border: "1px solid rgba(238,233,224,.14)", borderRadius: 10, fontFamily: "var(--font-inter-tight)" },
          }}
        />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
