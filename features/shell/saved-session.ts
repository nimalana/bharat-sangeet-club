// F3 (the browser check of Phase 2): a signed-in person saw the public landing page for 85 to 236 ms before the portal replaced it, because the
// landing is prerendered for everybody and only the browser knows whether it holds a saved sign-in. This is the early answer.
//
// SAVED_SESSION_SCRIPT is a few characters of JavaScript that app/layout.tsx puts in the <head>. It runs while the page is being read, before the
// first paint, and when localStorage holds a saved sign-in (the same `sb-<project>-auth-token` key that lib/api/auth.ts `hasSavedSession` looks for) it
// sets `data-saved-session` on <html>. public.css hides the landing page under that attribute, and the shell removes it as soon as the session check
// has answered (use-auth-session's `authLoading` is false): a visitor with no saved sign-in has no attribute and sees the same prerendered page,
// painted as early as before; a person whose saved sign-in turns out to be no good sees the landing a moment later, as before.
//
// The text has no `"`, `'`, `&`, `<` or `>` on purpose: it is written into the page as the child of a <script> element, which React escapes like any
// text (no dangerouslySetInnerHTML), and a test pins that what the server sends is exactly this string. The policy of next.config.ts allows
// inline scripts (script-src 'unsafe-inline': docs/KNOWN_GAPS.md section 3), so no hash or nonce is needed, and nothing here makes the page dynamic.
export const SAVED_SESSION_ATTRIBUTE = "data-saved-session";

export const SAVED_SESSION_SCRIPT = "try{if(Object.keys(localStorage).some(function(k){return /^sb-.+-auth-token$/.test(k)}))document.documentElement.setAttribute(`data-saved-session`,`1`)}catch(e){}";
