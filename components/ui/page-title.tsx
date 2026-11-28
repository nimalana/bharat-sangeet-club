// The heading block at the top of a portal screen: eyebrow, title, one line of text, and a scope badge on the screens that are
// club-wide whatever group is chosen. (The finance page writes its own title row around the same classes.)
const CLUB_WIDE_TITLES = ["Photo archive", "Club finances", "Club control center"];

export function PageTitle({ eyebrow, title, text, scope }: { eyebrow: string; title: string; text: string; scope?: "Club-wide" | "Subgroup" }) {
  const resolvedScope = scope || (CLUB_WIDE_TITLES.includes(title) ? "Club-wide" : undefined);
  return <div className="page-title">{resolvedScope && <span className="scope-badge">{resolvedScope}</span>}<p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>;
}
