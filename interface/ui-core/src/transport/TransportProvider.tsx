import { createContext, useContext } from "react";

export interface TransportAdapter {
  get(endpoint: string): Promise<any>;
  post(endpoint: string, data: any): Promise<any>;
  subscribe(topic: string, callback: (data: any) => void): () => void;
}

const TransportContext = createContext<TransportAdapter | null>(null);

export function TransportProvider({ children, adapter }: { children: React.ReactNode; adapter: TransportAdapter }) {
  return <TransportContext.Provider value={adapter}>{children}</TransportContext.Provider>;
}

export function useTransport() {
  const ctx = useContext(TransportContext);
  if (!ctx) {
    throw new Error("useTransport must be used within a TransportProvider");
  }
  return ctx;
}
