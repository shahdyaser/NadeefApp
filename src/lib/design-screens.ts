export type DesignScreen = {
  slug: string;
  title: string;
  description: string;
  folder: string;
};

export const DESIGN_SCREENS: DesignScreen[] = [
  {
    slug: "login",
    title: "Login",
    description: "Branded sign-in screen for Nadeef.",
    folder: "nadeef_login_updated_branding",
  },
  {
    slug: "dashboard",
    title: "Dashboard",
    description: "Home freshness overview and room status cards.",
    folder: "dashboard_cleanliness_champion_v1",
  },
  {
    slug: "tasks",
    title: "All Tasks",
    description: "Compact task list with completion status.",
    folder: "all_tasks_ultra_compact",
  },
  {
    slug: "task-new",
    title: "Add Task",
    description: "Modern form to create a cleaning task.",
    folder: "add_task_modern_form",
  },
  {
    slug: "room-new",
    title: "Add Room",
    description: "Modal form to add a room.",
    folder: "add_room_modal",
  },
  {
    slug: "kitchen",
    title: "Kitchen Detail",
    description: "Kitchen-focused cleaning detail page.",
    folder: "kitchen_detail_final",
  },
  {
    slug: "leaderboard",
    title: "Leaderboard",
    description: "Gamified cleanliness ranking view.",
    folder: "leaderboard_premium_bento",
  },
  {
    slug: "profile",
    title: "Profile",
    description: "User profile and preferences screen.",
    folder: "profile_page",
  },
  {
    slug: "theme-preview",
    title: "Azure Breeze",
    description: "Alternate visual style preview.",
    folder: "azure_breeze",
  },
];

export function getDesignScreenBySlug(slug: string): DesignScreen | undefined {
  return DESIGN_SCREENS.find((screen) => screen.slug === slug);
}

export function getDesignHtmlPath(folder: string): string {
  return `/designs/${folder}/code.html`;
}
