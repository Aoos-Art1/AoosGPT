import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { NAVIGATION, isSection } from "@/lib/navigation";
export function generateStaticParams() { return NAVIGATION.map((item) => ({ section: item.id })); }
export default async function PreviewPage({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; if (!isSection(section)) notFound(); return <Workspace section={section} demo />; }
