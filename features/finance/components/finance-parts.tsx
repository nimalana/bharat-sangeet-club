import { Badge } from "../../../components/ui/badge";
import { EmptyState } from "../../../components/ui/empty-state";

export function PanelHeading({ title, meta }: { title: string; meta: string }) {
  return <div className="panel-heading"><div><h2>{title}</h2><span>{meta}</span></div></div>;
}

export function StatusBadge({ status }: { status: string }) { return <Badge variant="muted" className={`finance-status ${status}`}>{status.replaceAll("_", " ")}</Badge>; }
export function FinanceEmpty({ title, text }: { title: string; text: string }) { return <EmptyState className="finance-empty" title={title} text={text} />; }
