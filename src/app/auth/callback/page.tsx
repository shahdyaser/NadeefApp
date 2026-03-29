"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolveAuthCallback() {
      if (!supabaseClient) {
        if (!cancelled) {
          setError(
            "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
          );
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error: exchangeError } =
          await supabaseClient.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          if (!cancelled) {
            setError(exchangeError.message);
          }
          return;
        }
      }

      const { data, error: sessionError } = await supabaseClient.auth.getSession();

      if (sessionError) {
        if (!cancelled) {
          setError(sessionError.message);
        }
        return;
      }

      if (!data.session) {
        if (!cancelled) {
          setError(
            "Authentication was not completed. Try again and confirm provider permissions.",
          );
        }
        return;
      }

      router.replace("/setup");
    }

    void resolveAuthCallback();

    return () => {
      cancelled = true;
    };
  }, [router, supabaseClient]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9fb] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">Finishing sign in...</h1>
        {!error ? (
          <p className="mt-2 text-sm text-slate-600">
            Please wait while we connect your account.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-red-700">{error}</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
            >
              Back to login
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
