"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type TabId = "home" | "tasks" | "leaderboard" | "profile";

function getActiveTab(pathname: string): TabId {
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/leaderboard")) return "leaderboard";
  if (pathname.startsWith("/profile")) return "profile";
  return "home";
}

const TABS: Array<{ id: TabId; href: string; icon: string; label: string }> = [
  { id: "home", href: "/home", icon: "🏠", label: "Home" },
  { id: "tasks", href: "/tasks", icon: "📝", label: "Tasks" },
  { id: "leaderboard", href: "/leaderboard", icon: "🏆", label: "Leaderboard" },
  { id: "profile", href: "/profile", icon: "👤", label: "Profile" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const activeTab = getActiveTab(pathname);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200/70 bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-around px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex min-w-[68px] flex-col items-center justify-center rounded-2xl px-4 py-2 transition-colors ${
                isActive ? "bg-teal-50 text-teal-700" : "text-slate-500 hover:text-teal-700"
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              <span className="text-[11px] font-medium tracking-wide">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
