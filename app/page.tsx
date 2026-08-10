"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Section = "home" | "recordings" | "documents" | "gallery" | "finances";
type ClubRole = "member" | "executive";
type ArchiveType = "recording" | "document" | "photo";
type ArchiveItem = {
  id: number; title: string; description: string; type: ArchiveType;
  storage_path: string; visibility: "members" | "executives";
  event_date: string | null; raga: string | null; tala: string | null; created_at: string;
  signedUrl?: string;
};
type Transaction = {
  id: number; description: string; amount: number; category: string;
  transaction_date: string; created_at: string;
};

const heroPhotos = [
  { src: "https://asianartsagency.co.uk/wp-content/uploads/2021/08/Trio-WP.jpg", alt: "Carnatic trio performing with veena and percussion" },
  { src: "https://static.wixstatic.com/media/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg/v1/fill/w_2500,h_1203,al_c/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg", alt: "Carnatic ensemble recital" },
];

export default function Home() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<ClubRole>("member");
  const [name, setName] = useState("");
  const [section, setSection] = useState<Section>("home");
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const loadProfile = useCallback(async (currentUser: User) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select("full_name, role").eq("id", currentUser.id).single();
    if (error) { notify("We could not load your club profile"); return; }
    setRole(data.role as ClubRole);
    setName(data.full_name || currentUser.email?.split("@")[0] || "Club member");
  }, [notify]);

  const loadData = useCallback(async (currentRole: ClubRole) => {
    const client = supabase;
    if (!client) return;
    setDataLoading(true);
    const archiveResult = await client.from("archive_items").select("*").order("created_at", { ascending: false });
    if (archiveResult.error) notify("The club archive could not be loaded");
    const items = (archiveResult.data || []) as ArchiveItem[];
    const photos = items.filter((item) => item.type === "photo");
    await Promise.all(photos.map(async (item) => {
      const { data } = await client.storage.from("club-archive").createSignedUrl(item.storage_path, 3600);
      item.signedUrl = data?.signedUrl;
    }));
    setArchive(items);
    if (currentRole === "executive") {
      const result = await client.from("transactions").select("*").order("transaction_date", { ascending: false });
      if (result.error) notify("Financial records could not be loaded");
      setTransactions((result.data || []) as Transaction[]);
    } else setTransactions([]);
    setDataLoading(false);
  }, [notify]);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) loadProfile(data.user);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) window.setTimeout(() => loadProfile(session.user), 0);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  useEffect(() => { if (user) loadData(role); }, [user, role, loadData]);

  const recordings = useMemo(() => archive.filter((item) => item.type === "recording" && `${item.title} ${item.description} ${item.raga || ""}`.toLowerCase().includes(query.toLowerCase())), [archive, query]);
  const documents = archive.filter((item) => item.type === "document");
  const photos = archive.filter((item) => item.type === "photo");
  const balance = transactions.reduce((sum, item) => sum + Number(item.amount), 0);
  const income = transactions.filter((item) => Number(item.amount) > 0).reduce((sum, item) => sum + Number(item.amount), 0);
  const expenses = transactions.filter((item) => Number(item.amount) < 0).reduce((sum, item) => sum + Number(item.amount), 0);

  const navigate = (next: Section) => { setSection(next); window.scrollTo({ top: 0, behavior: "smooth" }); };

  async function openFile(item: ArchiveItem) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("club-archive").createSignedUrl(item.storage_path, 300);
    if (error || !data) { notify("This file could not be opened"); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (authLoading) return <LoadingScreen />;
  if (!supabase) return <SetupScreen />;
  if (!user) return <LoginScreen notify={notify} />;

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Bharat Sangeet home"><span className="brand-mark">sa</span><span><b>Bharat Sangeet</b><small>Carnatic Music Club</small></span></button>
        <nav aria-label="Main navigation">
          {(["home", "recordings", "documents", "gallery"] as Section[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => navigate(item)}>{item === "home" ? "Club Home" : item}</button>)}
          {role === "executive" && <button className={section === "finances" ? "active" : ""} onClick={() => navigate("finances")}>Finances</button>}
        </nav>
        <div className="account"><button className="role-button" onClick={() => supabase?.auth.signOut()} title="Sign out"><span className="avatar">{role === "executive" ? "EX" : "MB"}</span><span><b>{name}</b><small>{role === "executive" ? "Executive · Sign out" : "Member · Sign out"}</small></span></button></div>
      </header>

      {section === "home" && <>
        <section className="hero"><div className="hero-copy"><p className="eyebrow">2026–27 SEASON · CAMPUS CHAPTER</p><h1>Music remembered.<br /><em>Community connected.</em></h1><p className="lede">One shared home for our recordings, repertoire, club resources, concert memories, and the people who keep the music alive.</p><div className="hero-actions"><button className="primary" onClick={() => navigate("recordings")}>Listen to the archive <span>→</span></button><button className="secondary" onClick={() => navigate("documents")}>Browse club resources</button></div></div><div className="hero-image"><img src={photos[0]?.signedUrl || heroPhotos[0].src} alt={photos[0]?.title || heroPhotos[0].alt} /><div className="image-caption"><span>Club archive</span><b>{photos[0]?.title || "Bharat Sangeet in concert"}</b></div></div></section>
        <section className="welcome-strip"><p><span className="dot" /> Welcome back, {name}</p><p className="quote">“Where melody becomes memory.”</p><p><b>{role === "executive" ? "Executive access" : "Member access"}</b></p></section>
        <section className="section-shell overview"><div className="section-heading"><div><p className="eyebrow">YOUR CLUB SPACE</p><h2>Everything in its place</h2></div>{role === "executive" && <button className="primary small" onClick={() => setShowUpload(true)}>＋ Add to archive</button>}</div><div className="feature-grid">
          <button className="feature-card large" onClick={() => navigate("recordings")}><span className="line-icon">◉</span><span className="count">{recordings.length} recordings</span><h3>Listen & revisit</h3><p>Concerts, rehearsals, and workshops—organized for the whole club.</p><b>Open recordings →</b></button>
          <button className="feature-card" onClick={() => navigate("documents")}><span className="line-icon">▤</span><span className="count">{documents.length} files</span><h3>Club library</h3><p>Constitution, repertoire, event plans, and member resources.</p><b>Browse documents →</b></button>
          <button className="feature-card photo-card" onClick={() => navigate("gallery")}><img src={photos[1]?.signedUrl || heroPhotos[1].src} alt={photos[1]?.title || heroPhotos[1].alt} /><span><small>PHOTO ARCHIVE</small><b>Moments from the stage</b></span></button>
          <div className="feature-card next-card"><p className="eyebrow">LIVE & SECURE</p><div className="calendar-date"><b>{archive.length}</b><span>ITEMS</span></div><div><h3>Shared club archive</h3><p>Protected by member and executive permissions.</p></div></div>
        </div></section>
        <section className="raga-banner"><div><p className="eyebrow">RAGA OF THE MONTH</p><h2>Kalyani</h2><p>Expansive, luminous, and full of possibility—a raga that invites both discipline and imagination.</p></div><div className="swara"><small>AROHANAM</small><b>Sa Ri₂ Ga₃ Ma₂ Pa Da₂ Ni₃ Sa</b><small>AVAROHANAM</small><b>Sa Ni₃ Da₂ Pa Ma₂ Ga₃ Ri₂ Sa</b></div></section>
      </>}

      {section === "recordings" && <section className="section-shell page-section"><PageTitle eyebrow="LISTENING ROOM" title="Recordings archive" text="Concerts, rehearsals, workshops, and musical moments from every season." /><div className="toolbar"><label className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, raga, or description" /></label>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Upload recording</button>}</div>{dataLoading ? <InlineLoading /> : recordings.length ? <div className="recording-list">{recordings.map((item, index) => <article className="recording-row" key={item.id}><button className="play" onClick={() => openFile(item)}>▶</button><div className="track-no">{String(index + 1).padStart(2, "0")}</div><div className="track-main"><h3>{item.title}</h3><p>{[item.raga, item.tala, item.description].filter(Boolean).join(" · ") || "Club recording"}</p></div><span className="pill">Recording</span><time>{formatDate(item.created_at)}</time><button className="more" onClick={() => openFile(item)}>•••</button></article>)}</div> : <EmptyState title="No recordings yet" text={role === "executive" ? "Upload the first rehearsal or concert recording." : "The executives have not added a recording yet."} />}</section>}

      {section === "documents" && <section className="section-shell page-section"><PageTitle eyebrow="SHARED LIBRARY" title="Club documents" text="The practical side of our community—easy for every member to find and use." /><div className="toolbar"><p className="access-note">✓ All members can view and download shared files</p>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Add document</button>}</div>{documents.length ? <div className="document-grid">{documents.map((item) => <article className="document-card" key={item.id}><div className="file-top"><span className="file-icon">▤</span><span className="pill">{item.visibility}</span></div><h3>{item.title}</h3><p>{item.description || `Added ${formatDate(item.created_at)}`}</p><button onClick={() => openFile(item)}>Download <span>↓</span></button></article>)}</div> : <EmptyState title="No documents yet" text={role === "executive" ? "Add the constitution, repertoire, or member guide." : "Shared club documents will appear here."} />}</section>}

      {section === "gallery" && <section className="section-shell page-section"><PageTitle eyebrow="CLUB MEMORIES" title="Photo archive" text="The rehearsals, stages, and friendships that shape Bharat Sangeet." />{photos.length ? <div className="gallery-grid">{photos.map((item, index) => <figure key={item.id} className={index === 0 ? "wide" : ""}><img src={item.signedUrl} alt={item.title} /><figcaption><b>{item.title}</b><span>{formatDate(item.created_at)}</span></figcaption></figure>)}</div> : <EmptyState title="No club photos yet" text={role === "executive" ? "Upload the first memory from a rehearsal or concert." : "Club photos will appear here."} />}</section>}

      {section === "finances" && role === "executive" && <section className="section-shell page-section"><PageTitle eyebrow="EXECUTIVE ACCESS" title="Club finances" text="A private, clear record of the funds that support our music." /><div className="finance-summary"><div><small>AVAILABLE BALANCE</small><strong>{money(balance)}</strong><span>Live club ledger</span></div><div><small>TOTAL INCOME</small><b className="income">{money(income)}</b><span>Recorded funds</span></div><div><small>TOTAL EXPENSES</small><b>{money(expenses)}</b><span>Recorded spending</span></div><button className="primary" onClick={() => setShowUpload(true)}>＋ Add transaction</button></div>{transactions.length ? <div className="ledger"><div className="ledger-head"><b>Recent activity</b><span>Club ledger</span></div>{transactions.map((item) => <div className="ledger-row" key={item.id}><span className={`money-mark ${Number(item.amount) > 0 ? "income" : "expense"}`}>{Number(item.amount) > 0 ? "+" : "−"}</span><b>{item.description}</b><span>{formatDate(item.transaction_date)}</span><strong className={Number(item.amount) > 0 ? "income" : "expense"}>{money(Number(item.amount))}</strong></div>)}</div> : <EmptyState title="No transactions yet" text="Add the first allocation, donation, or expense." />}</section>}

      <footer><div className="footer-brand"><span className="brand-mark">sa</span><div><b>Bharat Sangeet</b><small>Practice · Perform · Preserve</small></div></div><p>Made for our music, and the community around it.</p><p>2026–27 Season</p></footer>
      {showUpload && <ArchiveModal user={user} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); loadData(role); notify("Saved to the club archive"); }} notify={notify} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function LoginScreen({ notify }: { notify: (message: string) => void }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setSending(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } });
    setSending(false); notify(error ? error.message : "Check your email for a secure sign-in link");
  }
  return <main className="login-page"><div className="login-art"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div><span className="brand-mark">sa</span><h1>Music remembered.<br /><em>Community connected.</em></h1></div></div><section className="login-panel"><div className="login-box"><p className="eyebrow">MEMBER PORTAL</p><h2>Welcome to Bharat Sangeet</h2><p>Enter the email invited by your club executive. We’ll send you a secure sign-in link—no password needed.</p><form onSubmit={submit}><label>Email address<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" /></label><button className="primary" disabled={sending}>{sending ? "Sending link…" : "Email me a sign-in link"}</button></form><small>Access is limited to invited club members.</small></div></section></main>;
}

function ArchiveModal({ user, onClose, onSaved, notify }: { user: User; onClose: () => void; onSaved: () => void; notify: (message: string) => void }) {
  const [type, setType] = useState<ArchiveType | "financial">("recording");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    const form = new FormData(event.currentTarget); const title = String(form.get("title") || "");
    if (type === "financial") {
      const amount = Number(form.get("amount"));
      const { error } = await supabase.from("transactions").insert({ description: title, amount, category: String(form.get("category") || "General"), created_by: user.id });
      setSaving(false); if (error) notify(error.message); else onSaved(); return;
    }
    const file = form.get("file") as File; if (!file?.size) { setSaving(false); notify("Choose a file to upload"); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-"); const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from("club-archive").upload(storagePath, file, { upsert: false });
    if (upload.error) { setSaving(false); notify(upload.error.message); return; }
    const saved = await supabase.from("archive_items").insert({ title, description: String(form.get("description") || ""), type, storage_path: storagePath, visibility: form.get("visibility"), raga: type === "recording" ? String(form.get("raga") || "") || null : null, tala: type === "recording" ? String(form.get("tala") || "") || null : null, uploaded_by: user.id });
    if (saved.error) { await supabase.storage.from("club-archive").remove([storagePath]); setSaving(false); notify(saved.error.message); return; }
    setSaving(false); onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>Add to club records</h2><label>Item type<select value={type} onChange={(e) => setType(e.target.value as ArchiveType | "financial")}><option value="recording">Recording</option><option value="document">Document</option><option value="photo">Photo</option><option value="financial">Financial transaction</option></select></label><label>{type === "financial" ? "Description" : "Title"}<input name="title" required placeholder="Give this item a clear name" /></label>{type === "financial" ? <><label>Amount<input name="amount" type="number" step="0.01" required placeholder="Use a negative number for expenses" /></label><label>Category<input name="category" required placeholder="Venue, donation, equipment…" /></label></> : <><label>Description<input name="description" placeholder="Optional context for members" /></label>{type === "recording" && <div className="form-pair"><label>Raga<input name="raga" /></label><label>Tala<input name="tala" /></label></div>}<label>Choose file<input name="file" type="file" required accept={type === "recording" ? "audio/*,video/*" : type === "photo" ? "image/*" : undefined} /></label><label>Who can access this?<select name="visibility"><option value="members">All club members</option><option value="executives">Executives only</option></select></label></>}<button className="primary" disabled={saving}>{saving ? "Saving…" : "Save to archive"}</button></form></div>;
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span>sa</span><h3>{title}</h3><p>{text}</p></div>; }
function LoadingScreen() { return <main className="loading-screen"><span className="brand-mark">sa</span><p>Opening the club archive…</p></main>; }
function InlineLoading() { return <div className="inline-loading">Loading the archive…</div>; }
function SetupScreen() { return <main className="loading-screen"><span className="brand-mark">sa</span><h2>Supabase connection needed</h2><p>Add the project URL and publishable key to the hosting environment.</p></main>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
