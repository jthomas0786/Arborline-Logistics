import type { Metadata } from "next";
import DemoExperience from "./DemoExperience";
import styles from "./demo.module.css";

export const metadata: Metadata = {
  title: "ArborLine Connect — Product Demo",
  description: "A simulated ArborLine Connect workflow using demo data only."
};

const allowedScenes = new Set(["full", "discover", "contact", "outreach", "reply", "handoff"]);

export default async function DemoPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawScene = typeof params.scene === "string" ? params.scene : "full";
  const scene = allowedScenes.has(rawScene) ? rawScene : "full";
  const record = params.record === "1";

  return (
    <main className={`${styles.page} ${record ? styles.recordMode : ""}`}>
      <div className={styles.ambientOne} />
      <div className={styles.ambientTwo} />
      <DemoExperience scene={scene} record={record} />
    </main>
  );
}
