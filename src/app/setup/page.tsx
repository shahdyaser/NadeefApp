"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type SetupMode = "create" | "join";

export default function SetupPage() {
  const router = useRouter();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode>("create");

  const [houseName, setHouseName] = useState("");
  const [houseTimezone, setHouseTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    async function bootstrap() {
      if (!supabaseClient) {
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
        );
        setLoading(false);
        return;
      }

      const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();
      if (sessionError || !sessionData.session?.user) {
        router.replace("/");
        return;
      }

      const uid = sessionData.session.user.id;
      setUserId(uid);

      const { data: memberships, error: membershipError } = await supabaseClient
        .from("user_house_bridge")
        .select("house_id")
        .eq("user_id", uid)
        .limit(1);

      if (membershipError) {
        setError(membershipError.message);
        setLoading(false);
        return;
      }

      if (memberships?.[0]?.house_id) {
        router.replace("/home");
        return;
      }

      setLoading(false);
    }

    void bootstrap();
  }, [router, supabaseClient]);

  async function handleCreateHouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!supabaseClient || !userId) return;

    setSaving(true);
    const { error: insertError } = await supabaseClient.from("house").insert({
      name: houseName.trim(),
      timezone: houseTimezone.trim() || "UTC",
      owner_id: userId,
    });
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("Home created. Redirecting...");
    router.replace("/home");
  }

  async function handleSignOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    router.replace("/");
  }

  async function handleJoinHouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!supabaseClient || !userId) return;
    if (!inviteCode.trim()) {
      setError("Enter a valid house code.");
      return;
    }

    setSaving(true);
    const { error: joinError } = await supabaseClient.rpc("join_house_by_invite_code", {
      p_invite_code: inviteCode.trim(),
    });
    setSaving(false);

    if (joinError) {
      setError(joinError.message);
      return;
    }

    setMessage("Joined house successfully. Redirecting...");
    router.replace("/home");
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Preparing setup...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
            Nadeef
          </p>
          <h1 className="text-lg font-bold text-slate-900">Set Up Your Home Access</h1>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Sign out
        </button>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          {message}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-base font-bold text-slate-900">First-time setup</h2>
        <p className="mt-1 text-xs text-slate-600">
          Create a new home or join an existing one using a house code.
        </p>

        <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setSetupMode("create");
              setError(null);
              setMessage(null);
            }}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${
              setupMode === "create" ? "bg-teal-700 text-white" : "text-slate-600"
            }`}
          >
            Create House
          </button>
          <button
            type="button"
            onClick={() => {
              setSetupMode("join");
              setError(null);
              setMessage(null);
            }}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${
              setupMode === "join" ? "bg-teal-700 text-white" : "text-slate-600"
            }`}
          >
            Join with Code
          </button>
        </div>

        {setupMode === "create" ? (
          <form className="mt-4 space-y-3" onSubmit={handleCreateHouse}>
            <input
              required
              value={houseName}
              onChange={(event) => setHouseName(event.target.value)}
              placeholder="Home name (e.g. Family Apartment)"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"
            />
            <input
              required
              value={houseTimezone}
              onChange={(event) => setHouseTimezone(event.target.value)}
              placeholder="Timezone (e.g. Asia/Riyadh)"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"
            />
            <button
              type="submit"
              disabled={saving}
              className="h-11 w-full rounded-xl bg-teal-700 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Creating..." : "Create Home"}
            </button>
          </form>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={handleJoinHouse}>
            <input
              required
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
              placeholder="Enter house code (e.g. ABCD1234)"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm uppercase outline-none focus:border-teal-500"
            />
            <button
              type="submit"
              disabled={saving}
              className="h-11 w-full rounded-xl bg-teal-700 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Joining..." : "Join House"}
            </button>
            <p className="text-xs text-slate-500">
              Ask a house owner/member to share the house code with you.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
