// "Nothing here yet": the club mark, a title and a line of text. `className` names the look (the finance screen has its own).
export function EmptyState({ title, text, className = "empty-state" }: { title: string; text: string; className?: string }) {
  return <div className={className}><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><h3>{title}</h3><p>{text}</p></div>;
}
