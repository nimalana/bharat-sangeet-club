// The four small blocks every screen repeated (components/ui): page-title, empty-state, loading-block, error-block.
// Each is checked against the exact markup the screens wrote by hand before (class names, element order, text), because the
// stylesheet and the browser pictures depend on it, and for what a person can do with it.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorBlock } from "../../components/ui/error-block";
import { LoadingBlock } from "../../components/ui/loading-block";
import { PageTitle } from "../../components/ui/page-title";

const html = (node: React.ReactElement) => render(node).container.innerHTML;

describe("PageTitle", () => {
  it("is eyebrow, title and text in the page-title block", () => {
    expect(html(<PageTitle eyebrow="CLUB ROSTER" title="Member roster" text="Find the people." />))
      .toBe('<div class="page-title"><p class="eyebrow">CLUB ROSTER</p><h1>Member roster</h1><p>Find the people.</p></div>');
  });

  it.each(["Photo archive", "Club finances", "Club control center"])("%s is marked Club-wide without being told", (title) => {
    expect(html(<PageTitle eyebrow="E" title={title} text="T" />))
      .toBe(`<div class="page-title"><span class="scope-badge">Club-wide</span><p class="eyebrow">E</p><h1>${title}</h1><p>T</p></div>`);
  });

  it("another title has no badge, a given scope is shown as given, and it wins over the title's own", () => {
    expect(html(<PageTitle eyebrow="E" title="Important dates" text="T" />)).not.toContain("scope-badge");
    expect(html(<PageTitle eyebrow="E" title="Annual plan" text="T" scope="Subgroup" />)).toContain('<span class="scope-badge">Subgroup</span>');
    expect(html(<PageTitle eyebrow="E" title="Club finances" text="T" scope="Subgroup" />)).toContain('<span class="scope-badge">Subgroup</span>');
  });

  it("a title that only contains a club-wide title is not club-wide", () => {
    expect(html(<PageTitle eyebrow="E" title="Photo archive 2026" text="T" />)).not.toContain("scope-badge");
  });
});

// The markup the screens wrote by hand (portal.tsx EmptyState, finance.tsx FinanceEmpty), as the oracle.
const oldEmpty = (className: string, title: string, text: string) => <div className={className}><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><h3>{title}</h3><p>{text}</p></div>;

describe("EmptyState", () => {
  it("is the club mark, a title and a line, in the empty-state block", () => {
    const markup = html(<EmptyState title="Nothing yet" text="Come back later." />);
    expect(markup).toBe(html(oldEmpty("empty-state", "Nothing yet", "Come back later.")));
    expect(markup).toContain('<div class="empty-state">');
    expect(markup).toContain('src="/unc-bharat-sangeet-logo.jpg"');
    expect(markup).toContain('<h3>Nothing yet</h3><p>Come back later.</p>');
  });

  it("takes the class of another look (the finance screen's)", () => {
    const markup = html(<EmptyState className="finance-empty" title="No payments yet" text="Income will appear here." />);
    expect(markup).toBe(html(oldEmpty("finance-empty", "No payments yet", "Income will appear here.")));
    expect(markup).toContain('<div class="finance-empty">');
  });
});

describe("LoadingBlock", () => {
  it("is the loading line, with no role unless one is asked for", () => {
    expect(html(<LoadingBlock>Loading attendance…</LoadingBlock>)).toBe('<div class="inline-loading">Loading attendance…</div>');
  });

  it("can announce itself as a status (the placeholder of a lazily loaded screen)", () => {
    expect(html(<LoadingBlock role="status">Loading…</LoadingBlock>)).toBe('<div class="inline-loading" role="status">Loading…</div>');
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});

describe("ErrorBlock", () => {
  it("is what the attendance screen wrote by hand: the message, a space, a small secondary Try again, in a loading line", () => {
    const old = <div className="inline-loading">Attendance could not be loaded. <Button size="sm" variant="secondary" onClick={() => {}}>Try again</Button></div>;
    const markup = html(<ErrorBlock message="Attendance could not be loaded." onRetry={() => {}} />);
    expect(markup).toBe(html(old));
    expect(markup).toContain('<div class="inline-loading">Attendance could not be loaded. <button');
  });

  it("takes the class of the block it replaces", () => {
    const old = <div className="attendance-empty">The roster could not be loaded. <Button size="sm" variant="secondary" onClick={() => {}}>Try again</Button></div>;
    const markup = html(<ErrorBlock className="attendance-empty" message="The roster could not be loaded." onRetry={() => {}} />);
    expect(markup).toBe(html(old));
    expect(markup).toContain('<div class="attendance-empty">');
  });

  it("Try again calls onRetry once per press, and nothing before", () => {
    const onRetry = vi.fn();
    render(<ErrorBlock message="x" onRetry={onRetry} />);
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
