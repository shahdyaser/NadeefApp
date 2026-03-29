import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DESIGN_SCREENS,
  getDesignHtmlPath,
  getDesignScreenBySlug,
} from "@/lib/design-screens";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return DESIGN_SCREENS.map((screen) => ({ slug: screen.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const screen = getDesignScreenBySlug(slug);

  if (!screen) {
    return { title: "Screen Not Found | Nadeef" };
  }

  return {
    title: `${screen.title} | Nadeef`,
    description: screen.description,
  };
}

export default async function DesignScreenPage({ params }: PageProps) {
  const { slug } = await params;
  const screen = getDesignScreenBySlug(slug);

  if (!screen) {
    notFound();
  }

  const htmlPath = getDesignHtmlPath(screen.folder);

  return (
    <main className="min-h-screen bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-3 text-slate-100 backdrop-blur">
        <div>
          <p className="text-xs uppercase tracking-widest text-teal-300">Nadeef</p>
          <h1 className="text-sm font-semibold">{screen.title}</h1>
        </div>
        <Link
          href="/"
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium hover:border-slate-500"
        >
          Back to Screens
        </Link>
      </header>
      <iframe
        title={screen.title}
        src={htmlPath}
        className="h-[calc(100vh-57px)] w-full border-0"
      />
    </main>
  );
}
