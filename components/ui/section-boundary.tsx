"use client";

import { Component, Fragment, type ReactNode } from "react";
import { isChunkLoadError } from "../../lib/chunk-errors";
import { Button } from "./button";

type Props = { children: ReactNode };
type State = { failed: boolean; error: unknown; attempt: number };

// Keeps a screen that fails to load or render from taking the whole portal
// with it: the header and navigation stay, and the person gets Try again.
// Give it a `key` that changes with the screen so moving elsewhere clears it.
//
// A code-split screen whose file cannot be fetched (a deploy replaced it while
// the page was open, or the connection dropped) cannot be retried in place,
// because React keeps the failed import; Try again reloads the page then.
export class SectionBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown) {
    console.error("A portal screen failed", error);
  }

  retry = () => {
    if (isChunkLoadError(this.state.error)) { window.location.reload(); return; }
    this.setState((current) => ({ failed: false, error: null, attempt: current.attempt + 1 }));
  };

  render() {
    if (!this.state.failed) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    const stale = isChunkLoadError(this.state.error);
    return <section className="section-shell page-section">
      <div className="empty-state" role="alert">
        <h3>{stale ? "This page could not be loaded" : "Something went wrong on this page"}</h3>
        <p>{stale ? "The connection may have dropped, or the portal was updated while this page was open." : "Nothing has been changed. Try again, or open another page from the menu."}</p>
        <Button variant="secondary" className="mt-4" onClick={this.retry}>{stale ? "Reload the page" : "Try again"}</Button>
      </div>
    </section>;
  }
}
