/**
 * Minimal auth wiring (email/password + Google OAuth). Its only real job is
 * populating `auth.uid()` so Supabase RLS policies (and the `increment_mastery`
 * / `touch_streak` RPCs, which key off `auth.uid()` internally) have a user to
 * attach to. When Supabase isn't configured, `user` just stays `null` and
 * the rest of the app keeps working through the localStorage fallback.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { mergeLocalMasteryIntoSupabase } from "@/lib/mastery-store";

type AuthResult = { error: string | null };
type SignUpResult = AuthResult & { needsEmailConfirmation: boolean };

type AuthContextValue = {
  isSupabaseConfigured: boolean;
  user: User | null;
  session: Session | null;
  /** True until the initial `getSession()` lookup resolves (always `false` when Supabase isn't configured). */
  isLoading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const queryClient = useQueryClient();
  // Guards against re-running the merge for the same user (e.g. React
  // Strict Mode double-invoking effects, or multiple SIGNED_IN events).
  const mergedForUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);

      if (event === "SIGNED_IN" && nextSession?.user) {
        const userId = nextSession.user.id;
        if (mergedForUserIdRef.current !== userId) {
          mergedForUserIdRef.current = userId;
          mergeLocalMasteryIntoSupabase(userId)
            .catch((error) => {
              console.error("Failed to merge local mastery into Supabase:", error);
            })
            .finally(() => {
              queryClient.invalidateQueries({ queryKey: ["topic-mastery", userId] });
              queryClient.invalidateQueries({ queryKey: ["profile", userId] });
            });
        }
      }

      if (event === "SIGNED_OUT") {
        mergedForUserIdRef.current = null;
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isSupabaseConfigured,
      user: session?.user ?? null,
      session,
      isLoading,
      async signInWithPassword(email, password) {
        if (!supabase) return { error: "Supabase isn't configured." };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      async signInWithGoogle() {
        if (!supabase) return { error: "Supabase isn't configured." };
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/dashboard`,
          },
        });
        return { error: error?.message ?? null };
      },
      async signUp(email, password) {
        if (!supabase)
          return { error: "Supabase isn't configured.", needsEmailConfirmation: false };
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        return { error: error?.message ?? null, needsEmailConfirmation: !error && !data.session };
      },
      async signOut() {
        if (!supabase) return;
        await supabase.auth.signOut();
      },
    }),
    [session, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>.");
  return ctx;
}
