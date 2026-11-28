// Which folder and which audience the library is looking at. The open folder lives in the address bar (?page=documents&folder=<id>),
// so back and forward move between folders and a link opens one directly; the audience can also be set from outside (a group's
// "Open resources" opens the library for that group).
import { useEffect, useRef, useState } from "react";
import type { ScopeFilter } from "../../../lib/db";
import { folderUrl, parseFolderParam } from "../../../lib/resources-query";

export function useResourceFolder(initialScope: ScopeFilter) {
  const [scope, setScope] = useState<ScopeFilter>(initialScope);
  // The open folder lives in the address bar as ?page=documents&folder=<id>.
  const [folderId, setFolderId] = useState<number | null>(() => typeof window === "undefined" ? null : parseFolderParam(window.location.search));
  const previousScopeRef = useRef(initialScope);

  useEffect(() => {
    // initialScope is also used to deep-link from My Groups; defer the sync so
    // the render that receives new navigation props stays interruption-safe.
    // The first run is skipped so a folder in the address bar is kept.
    if (previousScopeRef.current === initialScope) return;
    previousScopeRef.current = initialScope;
    const timer = window.setTimeout(() => { setScope(initialScope); changeFolder(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialScope]);

  // Back and forward move between folders because each folder is its own URL.
  useEffect(() => {
    const onPopState = () => setFolderId(parseFolderParam(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function changeFolder(next: number | null) {
    setFolderId(next);
    const url = folderUrl(window.location.pathname, window.location.search, next);
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.pushState({ section: "documents" }, "", url);
  }

  return { scope, setScope, folderId, changeFolder };
}
