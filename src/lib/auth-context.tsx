import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AuthState = {
  isAuthenticated: boolean;
  isReady: boolean;
  user: User | null;
  session: Session | null;
};

const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  isReady: false,
  user: null,
  session: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isReady: false,
    user: null,
    session: null,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        isAuthenticated: !!session,
        isReady: true,
        user: session?.user ?? null,
        session,
      });
    });
    supabase.auth.getSession().then(({ data }) => {
      setState({
        isAuthenticated: !!data.session,
        isReady: true,
        user: data.session?.user ?? null,
        session: data.session,
      });
    });
    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
