import styles from "./portal.module.css";

function ringTone(score: number) {
  if (score >= 80) return styles.scoreRingGood;
  if (score >= 60) return styles.scoreRingMediocre;
  return styles.scoreRingBad;
}

export function ScoreRing({ score, href, label = "match" }: { score: number | null | undefined; href?: string; label?: string }) {
  const normalized = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Math.round(Number(score)))) : null;

  if (normalized === null) {
    const empty = <span className={`${styles.scoreRing} ${styles.scoreRingEmpty}`} aria-label={`${label} score unavailable`}>
      <span className={styles.scoreRingValue}>—</span>
    </span>;
    return href ? <a className={styles.scoreRingLink} href={href}>{empty}</a> : empty;
  }

  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  const dash = (normalized / 100) * circumference;
  const ring = <span className={`${styles.scoreRing} ${ringTone(normalized)}`} aria-label={`${normalized}% ${label}`}>
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle className={styles.scoreRingTrack} cx="32" cy="32" r={radius}/>
      <circle
        className={styles.scoreRingProgress}
        cx="32"
        cy="32"
        r={radius}
        strokeDasharray={`${dash} ${circumference - dash}`}
      />
    </svg>
    <span className={styles.scoreRingValue}>{normalized}<small>%</small></span>
  </span>;

  return href ? <a className={styles.scoreRingLink} href={href}>{ring}</a> : ring;
}
