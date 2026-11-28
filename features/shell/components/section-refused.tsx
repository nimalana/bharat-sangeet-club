"use client";

import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";

export function SectionRefused({ label, onHome }: { label: string; onHome: () => void }) {
  return <section className="section-shell page-section"><EmptyState title={`${label} is not available to your account`} text="Ask a club administrator if you think you should have access." /><div className="mt-4 flex justify-center"><Button variant="secondary" onClick={onHome}>Back to Overview</Button></div></section>;
}
