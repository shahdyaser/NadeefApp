"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getViewCache, setViewCache } from "@/lib/view-cache";

type RankedMember = {
  userId: string;
  points: number;
  label: string;
  avatarUrl: string | null;
};
type LeaderboardCachePayload = {
  globalMembers: RankedMember[];
  homeMembers: RankedMember[];
};

function initialsFromName(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "NA"
  );
}

export default function LeaderboardPage() {
  const router = useRouter();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalMembers, setGlobalMembers] = useState<RankedMember[]>([]);
  const [homeMembers, setHomeMembers] = useState<RankedMember[]>([]);
  const [activeRange, setActiveRange] = useState<"weekly" | "monthly" | "all">("weekly");

  useEffect(() => {
    async function loadLeaderboard() {
      const cacheKey = `leaderboard:${activeRange}`;
      const cached = getViewCache<LeaderboardCachePayload>(cacheKey);
      if (cached) {
        setGlobalMembers(cached.globalMembers);
        setHomeMembers(cached.homeMembers);
        setLoading(false);
      }

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

      const userId = sessionData.session.user.id;
      const { data: membershipData, error: membershipError } = await supabaseClient
        .from("user_house_bridge")
        .select("house_id")
        .eq("user_id", userId)
        .limit(1);

      if (membershipError) {
        setError(membershipError.message);
        setLoading(false);
        return;
      }

      const houseId = membershipData?.[0]?.house_id;
      if (!houseId) {
        router.replace("/setup");
        return;
      }

      const { data: globalData, error: globalError } = await supabaseClient.rpc(
        "get_leaderboard_points",
        {
          p_scope: "global",
          p_range: activeRange,
          p_house_id: houseId,
        },
      );
      if (globalError) {
        setError(globalError.message);
        setLoading(false);
        return;
      }

      const { data: homeData, error: homeError } = await supabaseClient.rpc(
        "get_leaderboard_points",
        {
          p_scope: "home",
          p_range: activeRange,
          p_house_id: houseId,
        },
      );
      if (homeError) {
        setError(homeError.message);
        setLoading(false);
        return;
      }

      const allUserIds = Array.from(
        new Set([...(globalData ?? []).map((row) => row.user_id), ...(homeData ?? []).map((row) => row.user_id)]),
      );
      const { data: profileData } =
        allUserIds.length > 0
          ? await supabaseClient
              .from("user_house_bridge")
              .select("user_id,display_name,avatar_url")
              .in("user_id", allUserIds)
          : { data: [] };
      const profileByUserId = new Map(
        (profileData ?? []).map((row) => [row.user_id, row]),
      );

      const globalRanking: RankedMember[] = (globalData ?? []).map((row) => ({
        userId: row.user_id,
        points: Number(row.points ?? 0),
        label:
          profileByUserId.get(row.user_id)?.display_name?.trim() ||
          (row.user_id === userId ? "You" : "Member"),
        avatarUrl: profileByUserId.get(row.user_id)?.avatar_url ?? null,
      }));
      const homeRanking: RankedMember[] = (homeData ?? []).map((row) => ({
        userId: row.user_id,
        points: Number(row.points ?? 0),
        label:
          profileByUserId.get(row.user_id)?.display_name?.trim() ||
          (row.user_id === userId ? "You" : "Member"),
        avatarUrl: profileByUserId.get(row.user_id)?.avatar_url ?? null,
      }));

      setGlobalMembers(globalRanking);
      setHomeMembers(homeRanking);
      setViewCache<LeaderboardCachePayload>(cacheKey, {
        globalMembers: globalRanking,
        homeMembers: homeRanking,
      });
      setLoading(false);
    }

    void loadLeaderboard();
  }, [activeRange, router, supabaseClient]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6">
        <p className="text-sm text-slate-600">Loading leaderboard...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      </main>
    );
  }

  const globalTop1 = globalMembers[0];
  const globalTop2 = globalMembers[1];
  const globalTop3 = globalMembers[2];
  const globalRest = globalMembers.slice(3);

  return (
    <main className="min-h-screen bg-[#f7f9fb] px-6 pb-28 pt-6 text-[#191c1e]">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setActiveRange("weekly")}
            className={`rounded-full px-6 py-2 text-sm font-medium shadow-sm transition-all ${
              activeRange === "weekly" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => setActiveRange("monthly")}
            className={`rounded-full px-6 py-2 text-sm font-medium transition-all ${
              activeRange === "monthly" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setActiveRange("all")}
            className={`rounded-full px-6 py-2 text-sm font-medium transition-all ${
              activeRange === "all" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            All-time
          </button>
        </div>
        <p className="text-center text-xs text-slate-500">
          Smart score = effort points + completed tasks + home freshness + streak.
        </p>

        <section className="grid grid-cols-3 items-end gap-4 pb-2 pt-4">
          <PodiumCard place={2} member={globalTop2} />
          <PodiumCard place={1} member={globalTop1} />
          <PodiumCard place={3} member={globalTop3} />
        </section>

        <section className="space-y-3">
          <h2 className="px-2 text-sm font-bold uppercase tracking-widest text-slate-500">
            Global Rankings
          </h2>
          <div className="space-y-4">
            {globalRest.map((member, index) => (
              <div
                key={member.userId}
                className="group flex items-center gap-4 rounded-2xl bg-white p-4 transition-colors hover:bg-slate-100"
              >
                <div className="w-4 text-sm font-bold text-slate-500">{index + 4}</div>
                <div
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700"
                  style={
                    member.avatarUrl
                      ? {
                          backgroundImage: `url("${member.avatarUrl}")`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  {!member.avatarUrl ? initialsFromName(member.label) : null}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900">{member.label}</h3>
                  <div className="mt-1">
                    <div className="inline-flex rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                      🏆 {member.points.toLocaleString()} smart pts
                    </div>
                  </div>
                </div>
                <span className="text-slate-400 transition-colors group-hover:text-teal-700">›</span>
              </div>
            ))}
            {!globalRest.length && (
              <p className="rounded-xl bg-white p-4 text-sm text-slate-500">
                No additional global members yet.
              </p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="px-2 text-sm font-bold uppercase tracking-widest text-slate-500">
            Home Ranking
          </h2>
          <div className="space-y-3">
            {homeMembers.map((member, index) => (
              <div
                key={`${member.userId}-home`}
                className="flex items-center gap-4 rounded-2xl bg-white p-4"
              >
                <div className="w-4 text-sm font-bold text-slate-500">{index + 1}</div>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700"
                  style={
                    member.avatarUrl
                      ? {
                          backgroundImage: `url("${member.avatarUrl}")`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  {!member.avatarUrl ? initialsFromName(member.label) : null}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">{member.label}</p>
                  <p className="text-xs text-slate-500">Same home leaderboard</p>
                </div>
                <div className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                  {member.points.toLocaleString()} smart pts
                </div>
              </div>
            ))}
            {!homeMembers.length && (
              <p className="rounded-xl bg-white p-4 text-sm text-slate-500">
                No home ranking data yet.
              </p>
            )}
          </div>
        </section>
      </div>

      <nav className="fixed bottom-0 z-50 w-full rounded-t-[1.5rem] bg-[#f7f9fb]/90 shadow-[0_-10px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl">
        <div className="flex items-center justify-around px-4 pb-6 pt-3">
          <Link
            href="/home"
            className="flex flex-col items-center justify-center px-5 py-2 text-slate-500"
          >
            <span>🏠</span>
            <span className="text-[11px] font-medium tracking-wide">Home</span>
          </Link>
          <Link
            href="/tasks"
            className="flex flex-col items-center justify-center px-5 py-2 text-slate-500"
          >
            <span>📝</span>
            <span className="text-[11px] font-medium tracking-wide">Tasks</span>
          </Link>
          <Link
            href="/leaderboard"
            className="flex flex-col items-center justify-center rounded-2xl bg-teal-50 px-5 py-2 text-teal-700"
          >
            <span>🏆</span>
            <span className="text-[11px] font-medium tracking-wide">Leaderboard</span>
          </Link>
          <Link
            href="/profile"
            className="flex flex-col items-center justify-center px-5 py-2 text-slate-500"
          >
            <span>👤</span>
            <span className="text-[11px] font-medium tracking-wide">Profile</span>
          </Link>
        </div>
      </nav>
    </main>
  );
}

function PodiumCard({
  place,
  member,
}: {
  place: 1 | 2 | 3;
  member: RankedMember | undefined;
}) {
  const baseHeight = place === 1 ? "h-44 pt-8 pb-6 rounded-t-3xl" : place === 2 ? "h-32 pt-6 pb-4 rounded-t-2xl" : "h-24 pt-6 pb-4 rounded-t-2xl";
  const ring = place === 1 ? "ring-1 ring-teal-700/10 shadow-md" : "shadow-sm";
  const avatarSize = place === 1 ? "h-20 w-20 border-4 border-teal-300" : "h-16 w-16 border-4 border-slate-200";

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {place === 1 && <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-amber-500">🏅</div>}
        <div
          className={`overflow-hidden rounded-full bg-slate-200 ${avatarSize} flex items-center justify-center text-xs font-bold text-slate-700`}
          style={
            member?.avatarUrl
              ? {
                  backgroundImage: `url("${member.avatarUrl}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          {!member?.avatarUrl ? initialsFromName(member?.label ?? "-") : null}
        </div>
        <div
          className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
            place === 1
              ? "bg-teal-300 text-teal-900"
              : place === 2
                ? "bg-slate-300 text-slate-700"
                : "bg-orange-200 text-orange-800"
          }`}
        >
          {place}
        </div>
      </div>
      <div className={`w-full bg-white text-center ${baseHeight} ${ring}`}>
        <span className={`truncate px-2 ${place === 1 ? "text-sm font-extrabold" : "text-xs font-bold"}`}>
          {member?.label ?? "-"}
        </span>
        <div className={`font-bold text-teal-700 ${place === 1 ? "text-lg font-black" : "text-sm"}`}>
          {(member?.points ?? 0).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
