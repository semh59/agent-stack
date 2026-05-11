import { createContext, useContext, useEffect, useState } from "react";

export type Environment = "vscode" | "console";

interface EnvContextType {
  env: Environment;
  isReady: boolean;
}

const EnvContext = createContext<EnvContextType | null>(null);

export function EnvironmentProvider({ children, forcedEnv }: { children: React.ReactNode; forcedEnv?: Environment }) {
  const [env, setEnv] = useState<Environment>(forcedEnv ?? "console");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (forcedEnv) {
      setIsReady(true);
      return;
    }

    // Detect environment
    const isVSCode = typeof window !== "undefined" && "acquireVsCodeApi" in window;
    setEnv(isVSCode ? "vscode" : "console");
    setIsReady(true);
  }, [forcedEnv]);

  if (!isReady) return null;

  return <EnvContext.Provider value={{ env, isReady }}>{children}</EnvContext.Provider>;
}

export function useEnvironmentContext() {
  const ctx = useContext(EnvContext);
  if (!ctx) {
    throw new Error("useEnvironmentContext must be used within an EnvironmentProvider");
  }
  return ctx.env;
}
