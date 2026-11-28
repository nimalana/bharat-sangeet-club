"use client";

import { useState } from "react";
import { publicSiteAvailable, signInWithGoogle as startGoogleSignIn } from "../../../lib/api/public";
import { ApiError } from "../../../lib/errors";
import { heroPhotos } from "../hero-photos";

export function LoginScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function signInWithGoogle() {
    if (!publicSiteAvailable()) return;
    setSending(true);
    setErrorMessage("");
    try {
      await startGoogleSignIn(window.location.origin);
    } catch (error) {
      // Supabase answering with an error is shown; anything else is not this screen's to hide.
      if (!(error instanceof ApiError)) throw error;
      setErrorMessage(error.message);
      setSending(false);
    }
  }

  return <main className="login-page"><div className="login-art"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="Bharat Sangeet" /><h1>Many traditions.<br /><em>One place to make music.</em></h1></div></div><section className="login-panel"><button className="login-back" type="button" onClick={onBack}>← Back to public site</button><div className="login-box"><span className="login-context">UNC CHAPEL HILL MEMBER PORTAL</span><div className="auth-tabs"><button className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setErrorMessage(""); }}>Member sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setErrorMessage(""); }}>Join the club</button></div><h2>{mode === "signup" ? "Join Bharat Sangeet" : "Welcome to Bharat Sangeet"}</h2><p>{mode === "signup" ? "Sign up with Google to join UNC's Carnatic and Hindustani music community. Every new account begins as a regular member." : "Use the Google account connected to your UNC Chapel Hill club membership. No password is required."}</p><button className="google-button" type="button" onClick={signInWithGoogle} disabled={sending}><span aria-hidden="true">G</span>{sending ? "Opening Google…" : mode === "signup" ? "Sign up with Google" : "Continue with Google"}</button>{errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}<small>{mode === "signup" ? "Executive access is assigned separately by current club executives." : "Access your recordings, documents, calendar, groups, and attendance."}</small></div></section></main>;
}
