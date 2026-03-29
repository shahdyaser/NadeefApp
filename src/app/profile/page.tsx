"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type HouseRow = Database["public"]["Tables"]["house"]["Row"];
type BridgeRow = Database["public"]["Tables"]["user_house_bridge"]["Row"];
type MemberRole = Database["public"]["Enums"]["membership_role"];
type ProfileMember = Pick<
  BridgeRow,
  "user_id" | "role" | "display_name" | "avatar_url" | "total_points" | "current_streak_days"
>;

const APP_SIGNUP_URL = process.env.NEXT_PUBLIC_APP_SIGNUP_URL || "http://localhost:3000";

function initialsFromName(name: string) {
  const value = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return value || "NM";
}

export default function ProfilePage() {
  const router = useRouter();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  const [displayName, setDisplayName] = useState("Nadeef Member");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarFileName, setAvatarFileName] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [memberSince, setMemberSince] = useState("Recently joined");

  const [totalPoints, setTotalPoints] = useState(0);
  const [rank, setRank] = useState("#-");
  const [streakDays, setStreakDays] = useState(0);

  const [inviteCode, setInviteCode] = useState("NAD-000");
  const [houseName, setHouseName] = useState("Your Home");
  const [members, setMembers] = useState<ProfileMember[]>([]);
  const initials = initialsFromName(displayName);
  const shownAvatarUrl = avatarPreviewUrl || avatarUrl;

  const loadMembers = useCallback(
    async (targetHouseId: string) => {
      if (!supabaseClient) return;
      const { data: membersData, error: membersError } = await supabaseClient
        .from("user_house_bridge")
        .select("user_id,role,display_name,avatar_url,total_points,current_streak_days")
        .eq("house_id", targetHouseId)
        .order("created_at", { ascending: true });
      if (!membersError) {
        setMembers((membersData ?? []) as ProfileMember[]);
      }
    },
    [supabaseClient],
  );

  useEffect(() => {
    async function loadProfile() {
      if (!supabaseClient) {
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
        );
        setLoading(false);
        return;
      }

      setError(null);
      setMessage(null);

      const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();
      if (sessionError || !sessionData.session?.user) {
        router.replace("/");
        return;
      }

      const user = sessionData.session.user;
      setCurrentUserId(user.id);

      const emailName = user.email?.split("@")[0] ?? "Nadeef Member";
      const joinedAt = user.created_at
        ? new Date(user.created_at).toLocaleDateString(undefined, {
            month: "short",
            year: "numeric",
          })
        : "Recently joined";
      setMemberSince(`Member since ${joinedAt}`);

      const { data: memberships, error: membershipsError } = await supabaseClient
        .from("user_house_bridge")
        .select("*")
        .eq("user_id", user.id)
        .limit(1);
      if (membershipsError) {
        setError(membershipsError.message);
        setLoading(false);
        return;
      }

      const bridge = memberships?.[0] as BridgeRow | undefined;
      const memberHouseId = bridge?.house_id;
      if (!memberHouseId) {
        router.replace("/setup");
        return;
      }

      setHouseId(memberHouseId);
      setDisplayName(bridge?.display_name?.trim() || emailName);
      setAvatarUrl(bridge?.avatar_url ?? "");
      setNotificationsEnabled(bridge?.notifications_enabled ?? true);
      setStreakDays(bridge?.current_streak_days ?? 0);

      const { data: houseData, error: houseError } = await supabaseClient
        .from("house")
        .select("*")
        .eq("id", memberHouseId)
        .single();
      if (houseError) {
        setError(houseError.message);
        setLoading(false);
        return;
      }

      const house = houseData as HouseRow | null;
      if (house) {
        setInviteCode(house.invite_code);
        setHouseName(house.name);
        setIsOwner(house.owner_id === user.id);
      }

      await loadMembers(memberHouseId);

      const { data: globalAllTime, error: globalScoreError } = await supabaseClient.rpc(
        "get_leaderboard_points",
        {
          p_scope: "global",
          p_range: "all",
          p_house_id: memberHouseId,
        },
      );
      if (!globalScoreError) {
        const mine = (globalAllTime ?? []).find((row) => row.user_id === user.id);
        setTotalPoints(Number(mine?.points ?? 0));
      } else {
        setTotalPoints(bridge?.total_points ?? 0);
      }

      const { data: homeAllTime, error: homeRankError } = await supabaseClient.rpc(
        "get_leaderboard_points",
        {
          p_scope: "home",
          p_range: "all",
          p_house_id: memberHouseId,
        },
      );
      if (!homeRankError) {
        const myIndex = (homeAllTime ?? []).findIndex((row) => row.user_id === user.id);
        setRank(myIndex >= 0 ? `#${myIndex + 1}` : "#-");
      }

      setLoading(false);
    }

    void loadProfile();
  }, [loadMembers, router, supabaseClient]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  async function handleSaveProfile() {
    if (!supabaseClient || !houseId || !currentUserId) return;

    setError(null);
    setMessage(null);
    setSavingProfile(true);

    const cleanName = displayName.trim();
    if (!cleanName) {
      setSavingProfile(false);
      setError("Name cannot be empty.");
      return;
    }

    let cleanAvatar = avatarUrl.trim();
    if (avatarFile) {
      const safeName = avatarFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${currentUserId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabaseClient.storage
        .from("profile-pictures")
        .upload(filePath, avatarFile, {
          upsert: true,
          contentType: avatarFile.type,
        });

      if (uploadError) {
        setSavingProfile(false);
        setError(uploadError.message);
        return;
      }

      const { data: publicUrlData } = supabaseClient.storage
        .from("profile-pictures")
        .getPublicUrl(filePath);
      cleanAvatar = publicUrlData.publicUrl;
    }

    const { error: updateError } = await supabaseClient
      .from("user_house_bridge")
      .update({
        display_name: cleanName,
        avatar_url: cleanAvatar || null,
        notifications_enabled: notificationsEnabled,
      })
      .eq("user_id", currentUserId)
      .eq("house_id", houseId);

    setSavingProfile(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setAvatarUrl(cleanAvatar || "");
    setAvatarFile(null);
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarPreviewUrl(null);
    setMessage("Profile settings updated.");
    await loadMembers(houseId);
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    // Keep upload payload reasonable.
    if (file.size > 5 * 1024 * 1024) {
      setError("Image is too large. Please choose one under 5MB.");
      return;
    }
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    const nextPreview = URL.createObjectURL(file);
    setAvatarPreviewUrl(nextPreview);
    setAvatarFile(file);
    setAvatarFileName(file.name);
    setError(null);
  }

  async function handleChangeRole(memberUserId: string, role: MemberRole) {
    if (!supabaseClient || !houseId || !isOwner) return;

    setError(null);
    setMessage(null);
    setUpdatingRoleId(memberUserId);

    const { error: updateError } = await supabaseClient
      .from("user_house_bridge")
      .update({ role })
      .eq("house_id", houseId)
      .eq("user_id", memberUserId);

    setUpdatingRoleId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMembers((prev) => prev.map((m) => (m.user_id === memberUserId ? { ...m, role } : m)));
    setMessage("Member permission updated.");
  }

  async function copyInviteCode() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setMessage("Invite code copied.");
    } catch {
      setError("Unable to copy code. Please copy it manually.");
    }
  }

  function buildHouseInviteMessage() {
    const inviterName = displayName.trim() || "A member";
    return `${inviterName} from "${houseName}" has invited you to join Nadeef.

Create your account here: ${APP_SIGNUP_URL}
After signing up, enter this house code to join: ${inviteCode}`;
  }

  async function handleShareHouse() {
    const messageText = buildHouseInviteMessage();
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Join my Nadeef home",
          text: messageText,
          url: APP_SIGNUP_URL,
        });
        setMessage("Invitation shared.");
        return;
      } catch {
        // User may cancel; no-op.
      }
    }
    await navigator.clipboard.writeText(messageText);
    setMessage("Sharing not available. Invitation copied to clipboard.");
  }

  function handleShareWhatsapp() {
    const messageText = buildHouseInviteMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(messageText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleLogout() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6">
        <p className="text-sm text-slate-600">Loading profile...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] px-6 pb-28 pt-6 text-[#191c1e]">
      <div className="mx-auto max-w-2xl space-y-8">
        <section className="flex flex-col items-center py-6 text-center">
          <div className="group relative">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-teal-700 to-teal-400 opacity-25 blur transition duration-1000 group-hover:opacity-50" />
            <div
              className="relative flex h-28 w-28 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-teal-100 to-cyan-100 text-3xl font-black text-teal-800 shadow-sm"
              style={
                shownAvatarUrl
                  ? {
                      backgroundImage: `url("${shownAvatarUrl}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!shownAvatarUrl ? initials : null}
            </div>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold tracking-tight">{displayName}</h2>
          <p className="mt-1 text-sm font-medium uppercase tracking-widest text-slate-500">
            {memberSince}
          </p>
        </section>

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
            {message}
          </p>
        ) : null}

        <section className="grid grid-cols-2 gap-4">
          <div className="relative col-span-2 flex items-center justify-between overflow-hidden rounded-2xl bg-white p-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.04)]">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-amber-200 opacity-10 blur-2xl" />
            <div className="flex flex-col">
              <span className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                Total Smart Points
              </span>
              <span className="flex items-baseline gap-1 text-4xl font-black text-teal-700">
                {totalPoints.toLocaleString()}{" "}
                <span className="text-sm font-bold tracking-normal text-slate-500">pts</span>
              </span>
            </div>
            <div className="rounded-full bg-amber-200 p-4 text-2xl">✨</div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl bg-white p-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.04)]">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-xl">
              🏅
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Household Rank (All-Time)
              </span>
              <div className="mt-1 text-2xl font-bold">{rank}</div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl bg-white p-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.04)]">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-xl">
              🔥
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Streak
              </span>
              <div className="mt-1 text-2xl font-bold">{streakDays} Days</div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="px-1 text-xs font-bold uppercase tracking-widest text-slate-500">
            Account Settings
          </h3>
          <div className="space-y-4 rounded-2xl bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.02)]">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Name
              </span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 outline-none ring-2 ring-transparent focus:ring-teal-300"
                placeholder="Your name"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Profile Picture
              </span>
              <div className="rounded-xl bg-slate-100 p-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => void handleAvatarFileChange(event)}
                  className="w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-700 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  {avatarFileName
                    ? `Selected: ${avatarFileName}`
                    : shownAvatarUrl
                      ? "Current profile picture loaded."
                      : "Upload JPG/PNG/WebP (max 5MB)."}
                </p>
              </div>
            </label>

            <button
              type="button"
              onClick={() => setNotificationsEnabled((prev) => !prev)}
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left ${
                notificationsEnabled
                  ? "bg-teal-50 text-teal-800 ring-1 ring-teal-200"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              <span className="text-sm font-semibold">Notifications</span>
              <span className="text-xs font-bold uppercase">
                {notificationsEnabled ? "Enabled" : "Disabled"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={savingProfile}
              className="w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {savingProfile ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="px-1 text-xs font-bold uppercase tracking-widest text-slate-500">
            Household Management
          </h3>
          <div className="space-y-6 rounded-2xl bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-100 p-4">
              <div>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Invite to House
                </span>
                <span className="text-lg font-black tracking-widest text-teal-700">{inviteCode}</span>
                <p className="text-xs text-slate-500">{houseName}</p>
              </div>
              <button
                type="button"
                onClick={copyInviteCode}
                className="rounded-full bg-teal-700 px-4 py-2 text-sm font-bold text-white shadow-md transition-transform active:scale-95"
              >
                Copy Code
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleShareWhatsapp}
                className="rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-white transition-transform active:scale-95"
              >
                Share via WhatsApp
              </button>
              <button
                type="button"
                onClick={() => void handleShareHouse()}
                className="rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white transition-transform active:scale-95"
              >
                Share via More Apps
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Change the signup link anytime from <code>NEXT_PUBLIC_APP_SIGNUP_URL</code> in your
              environment configuration.
            </p>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Manage Members
              </p>
              {members.map((member, index) => {
                const isMe = member.user_id === currentUserId;
                const memberName = member.display_name?.trim() || (isMe ? "You" : `Member ${index + 1}`);
                const memberInitials = initialsFromName(memberName);
                return (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700"
                      style={
                        member.avatar_url
                          ? {
                              backgroundImage: `url("${member.avatar_url}")`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    >
                      {!member.avatar_url ? memberInitials : null}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">{memberName}</p>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">{member.role}</p>
                    </div>
                    {isOwner && !isMe ? (
                      <select
                        aria-label={`Change role for ${memberName}`}
                        value={member.role}
                        onChange={(event) =>
                          void handleChangeRole(member.user_id, event.target.value as MemberRole)
                        }
                        disabled={updatingRoleId === member.user_id}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none"
                      >
                        <option value="member">Member</option>
                        <option value="helper">Helper</option>
                        <option value="owner">Owner</option>
                      </select>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">
                        {isMe ? "You" : "View only"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
              Member can add and edit tasks like owner. Helper can only view tasks and mark tasks as
              done.
            </p>
          </div>
        </section>

        <section className="pt-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl p-4 font-bold text-red-600 transition-colors duration-200 hover:bg-red-50"
          >
            ⎋ Logout
          </button>
          <p className="mt-6 text-center text-[10px] uppercase tracking-[0.2em] text-slate-400">
            Nadeef App v2.4.1 (Stable Build)
          </p>
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
            className="flex flex-col items-center justify-center px-5 py-2 text-slate-500"
          >
            <span>🏆</span>
            <span className="text-[11px] font-medium tracking-wide">Leaderboard</span>
          </Link>
          <Link
            href="/profile"
            className="flex flex-col items-center justify-center rounded-2xl bg-teal-50 px-5 py-2 text-teal-700"
          >
            <span>👤</span>
            <span className="text-[11px] font-medium tracking-wide">Profile</span>
          </Link>
        </div>
      </nav>
    </main>
  );
}
