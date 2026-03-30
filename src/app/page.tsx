"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthMode = "signin" | "signup";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const isConfigured = !!supabaseClient;

  useEffect(() => {
    let cancelled = false;

    async function redirectIfSignedIn() {
      if (!supabaseClient) return;
      const { data, error: sessionError } = await supabaseClient.auth.getSession();
      if (cancelled || sessionError) return;
      if (data.session) {
        router.replace("/setup");
      }
    }

    void redirectIfSignedIn();
    const {
      data: { subscription },
    } = supabaseClient
      ? supabaseClient.auth.onAuthStateChange((event, session) => {
          if (cancelled) return;
          if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
            router.replace("/setup");
          }
        })
      : { data: { subscription: { unsubscribe: () => undefined } } };

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, supabaseClient]);

  async function handleEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!supabaseClient) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      return;
    }

    setLoading(true);

    try {
      if (mode === "signin") {
        const { error: signInError } =
          await supabaseClient.auth.signInWithPassword({
            email,
            password,
          });

        if (signInError) {
          setError(signInError.message);
          return;
        }

        router.push("/setup");
        return;
      }

      const { data, error: signUpError } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/oauth/consent`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (data.session) {
        router.push("/setup");
        return;
      }

      setMessage(
        "Account created. Check your email inbox to confirm your account, then sign in.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setMessage(null);
    setError(null);

    if (!supabaseClient) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      return;
    }

    if (!email) {
      setError("Enter your email first, then click Forgot Password.");
      return;
    }

    setLoading(true);
    const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/oauth/consent`,
      },
    );
    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("Password reset email sent. Check your inbox.");
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-[#f7f9fb] px-4 pb-6 pt-8 sm:px-6 sm:pb-10 sm:pt-16">
      <section className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.08)] sm:max-w-md sm:rounded-3xl sm:p-8">
        <div className="mb-5 text-center sm:mb-7">
          <Image
            src="/nadeef-logo.png"
            alt="Nadeef logo"
            width={220}
            height={220}
            className="mx-auto mb-2 h-auto w-32 sm:mb-4 sm:w-40"
            priority
          />
          <p className="mt-1 text-xs text-slate-600 sm:mt-2 sm:text-sm">
            Discover a simpler way to manage your space and keep everything
            feeling Nadeef.
          </p>
        </div>

        <form className="space-y-3 sm:space-y-4" onSubmit={handleEmailAuth}>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            className="h-11 w-full rounded-full border border-slate-200 px-4 text-sm text-slate-900 outline-none transition focus:border-teal-500 sm:h-12"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="h-11 w-full rounded-full border border-slate-200 px-4 text-sm text-slate-900 outline-none transition focus:border-teal-500 sm:h-12"
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading || !isConfigured}
            className="h-11 w-full rounded-full bg-gradient-to-r from-teal-700 to-teal-400 text-sm font-bold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:h-12"
          >
            {loading
              ? "Please wait..."
              : mode === "signin"
                ? "Sign In with Email"
                : "Create Account"}
          </button>
        </form>

        {!isConfigured && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Set Supabase env vars in `.env.local` before using auth.
          </p>
        )}

        {message && (
          <p className="mt-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
            {message}
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <p className="mt-5 text-center text-xs text-slate-500 sm:mt-7">
          {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage(null);
              setError(null);
            }}
            className="font-semibold text-teal-700 hover:text-teal-800"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>

        <p className="mt-2 text-center text-xs text-slate-500 sm:mt-3">
          After successful login, you will be redirected to your{" "}
          <Link href="/setup" className="font-semibold text-teal-700">
            home setup
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
