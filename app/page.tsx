"use client";

import { useMemo, useState } from "react";

type Section = "home" | "recordings" | "documents" | "gallery" | "finances";

const recordings = [
  { title: "Spring Concert — Main Set", detail: "Kalyani · Adi Tala · 42:18", date: "May 18, 2026", type: "Concert" },
  { title: "Ensemble Rehearsal 08", detail: "Varnam & kriti run-through · 31:04", date: "May 11, 2026", type: "Rehearsal" },
  { title: "Thani Avarthanam Workshop", detail: "Mridangam session · 24:52", date: "Apr 27, 2026", type: "Workshop" },
  { title: "Winter Sabha — Archive", detail: "Full recital · 1:16:09", date: "Dec 12, 2025", type: "Concert" },
];

const documents = [
  { title: "2026–27 Club Constitution", meta: "PDF · Updated Jun 2", tag: "Governance" },
  { title: "Concert Planning Checklist", meta: "DOCX · Updated May 20", tag: "Events" },
  { title: "Repertoire & Shruti Sheet", meta: "XLSX · Updated May 12", tag: "Music" },
  { title: "New Member Guide", meta: "PDF · Updated Apr 30", tag: "Members" },
];

const gallery = [
  { src: "https://asianartsagency.co.uk/wp-content/uploads/2021/08/Trio-WP.jpg", alt: "Carnatic trio performing with veena and percussion", label: "Spring concert" },
  { src: "https://static.wixstatic.com/media/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg/v1/fill/w_2500,h_1203,al_c/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg", alt: "Carnatic ensemble recital", label: "Ensemble evening" },
  { src: "https://www.shrutilaya.org/events/04-10-2010-nivedita/header.jpg", alt: "Veena recital on stage", label: "Archive highlight" },
];

const money = [
  { label: "School arts allocation", amount: "+$1,250.00", kind: "income" },
  { label: "Spring concert venue", amount: "−$420.00", kind: "expense" },
  { label: "Mridangam maintenance", amount: "−$86.50", kind: "expense" },
  { label: "Member donations", amount: "+$310.00", kind: "income" },
];

export default function Home() {
  const [section, setSection] = useState<Section>("home");
  const [role, setRole] = useState<"member" | "executive">("member");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const filteredRecordings = useMemo(() => recordings.filter((item) =>
    `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(query.toLowerCase())), [query]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  const navigate = (next: Section) => { setSection(next); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Bharat Sangeet home">
          <span className="brand-mark">sa</span>
          <span><b>Bharat Sangeet</b><small>Carnatic Music Club</small></span>
        </button>
        <nav aria-label="Main navigation">
          {(["home", "recordings", "documents", "gallery"] as Section[]).map((item) => (
            <button key={item} className={section === item ? "active" : ""} onClick={() => navigate(item)}>{item === "home" ? "Club Home" : item}</button>
          ))}
          {role === "executive" && <button className={section === "finances" ? "active" : ""} onClick={() => navigate("finances")}>Finances</button>}
        </nav>
        <div className="account">
          <button className="role-button" onClick={() => { setRole(role === "member" ? "executive" : "member"); setSection("home"); }}>
            <span className="avatar">{role === "member" ? "AM" : "EX"}</span>
            <span><b>{role === "member" ? "Anika Menon" : "Executive view"}</b><small>{role === "member" ? "Club member" : "Management access"}</small></span>
          </button>
        </div>
      </header>

      {section === "home" && (
        <>
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">2026–27 SEASON · CAMPUS CHAPTER</p>
              <h1>Music remembered.<br /><em>Community connected.</em></h1>
              <p className="lede">One shared home for our recordings, repertoire, club resources, concert memories, and the people who keep the music alive.</p>
              <div className="hero-actions">
                <button className="primary" onClick={() => navigate("recordings")}>Listen to the archive <span>→</span></button>
                <button className="secondary" onClick={() => navigate("documents")}>Browse club resources</button>
              </div>
            </div>
            <div className="hero-image">
              <img src={gallery[0].src} alt={gallery[0].alt} />
              <div className="image-caption"><span>Now in the archive</span><b>Spring Concert · May 2026</b></div>
            </div>
          </section>

          <section className="welcome-strip">
            <p><span className="dot" /> Welcome back, Anika</p>
            <p className="quote">“Where melody becomes memory.”</p>
            <p>Next rehearsal <b>Wed · 4:15 PM</b></p>
          </section>

          <section className="section-shell overview">
            <div className="section-heading">
              <div><p className="eyebrow">YOUR CLUB SPACE</p><h2>Everything in its place</h2></div>
              {role === "executive" && <button className="primary small" onClick={() => setShowUpload(true)}>＋ Add to archive</button>}
            </div>
            <div className="feature-grid">
              <button className="feature-card large" onClick={() => navigate("recordings")}>
                <span className="line-icon">◉</span><span className="count">24 recordings</span>
                <h3>Listen & revisit</h3><p>Concerts, rehearsals, and workshops—organized by season and raga.</p><b>Open recordings →</b>
              </button>
              <button className="feature-card" onClick={() => navigate("documents")}>
                <span className="line-icon">▤</span><span className="count">18 files</span>
                <h3>Club library</h3><p>Constitution, repertoire, event plans, and member resources.</p><b>Browse documents →</b>
              </button>
              <button className="feature-card photo-card" onClick={() => navigate("gallery")}>
                <img src={gallery[1].src} alt={gallery[1].alt} /><span><small>PHOTO ARCHIVE</small><b>Moments from the stage</b></span>
              </button>
              <div className="feature-card next-card">
                <p className="eyebrow">UP NEXT</p><div className="calendar-date"><b>21</b><span>MAY</span></div>
                <div><h3>Ensemble rehearsal</h3><p>Music Room 204 · 4:15–5:45 PM</p></div>
              </div>
            </div>
          </section>

          <section className="raga-banner">
            <div><p className="eyebrow">RAGA OF THE MONTH</p><h2>Kalyani</h2><p>Expansive, luminous, and full of possibility—a raga that invites both discipline and imagination.</p></div>
            <div className="swara" aria-label="Kalyani ascending scale"><small>AROHANAM</small><b>Sa Ri₂ Ga₃ Ma₂ Pa Da₂ Ni₃ Sa</b><small>AVAROHANAM</small><b>Sa Ni₃ Da₂ Pa Ma₂ Ga₃ Ri₂ Sa</b></div>
          </section>
        </>
      )}

      {section === "recordings" && (
        <section className="section-shell page-section">
          <PageTitle eyebrow="LISTENING ROOM" title="Recordings archive" text="Concerts, rehearsals, workshops, and musical moments from every season." />
          <div className="toolbar"><label className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, raga, or type" /></label>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Upload recording</button>}</div>
          <div className="recording-list">
            {filteredRecordings.map((item, index) => <article className="recording-row" key={item.title}>
              <button className="play" onClick={() => notify(`Playing “${item.title}”`)}>▶</button>
              <div className="track-no">{String(index + 1).padStart(2, "0")}</div><div className="track-main"><h3>{item.title}</h3><p>{item.detail}</p></div>
              <span className="pill">{item.type}</span><time>{item.date}</time><button className="more" aria-label={`More options for ${item.title}`}>•••</button>
            </article>)}
          </div>
        </section>
      )}

      {section === "documents" && (
        <section className="section-shell page-section">
          <PageTitle eyebrow="SHARED LIBRARY" title="Club documents" text="The practical side of our community—easy for every member to find and use." />
          <div className="toolbar"><p className="access-note">✓ All club members can view and download shared files</p>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Add document</button>}</div>
          <div className="document-grid">{documents.map((item) => <article className="document-card" key={item.title}>
            <div className="file-top"><span className="file-icon">▤</span><span className="pill">{item.tag}</span></div><h3>{item.title}</h3><p>{item.meta}</p><button onClick={() => notify(`Downloading “${item.title}”`)}>Download <span>↓</span></button>
          </article>)}</div>
        </section>
      )}

      {section === "gallery" && (
        <section className="section-shell page-section">
          <PageTitle eyebrow="CLUB MEMORIES" title="Photo archive" text="The rehearsals, stages, and friendships that shape Bharat Sangeet." />
          <div className="gallery-grid">{gallery.map((item, index) => <figure key={item.label} className={index === 0 ? "wide" : ""}><img src={item.src} alt={item.alt} /><figcaption><b>{item.label}</b><span>2025–26 season</span></figcaption></figure>)}</div>
        </section>
      )}

      {section === "finances" && role === "executive" && (
        <section className="section-shell page-section">
          <PageTitle eyebrow="EXECUTIVE ACCESS" title="Club finances" text="A private, clear record of the funds that support our music." />
          <div className="finance-summary"><div><small>AVAILABLE BALANCE</small><strong>$1,053.50</strong><span>As of May 20, 2026</span></div><div><small>THIS YEAR</small><b className="income">+$1,560.00</b><span>Income</span></div><div><small>THIS YEAR</small><b>−$506.50</b><span>Expenses</span></div><button className="primary" onClick={() => setShowUpload(true)}>＋ Add transaction</button></div>
          <div className="ledger"><div className="ledger-head"><b>Recent activity</b><span>2026–27 season</span></div>{money.map((item) => <div className="ledger-row" key={item.label}><span className={`money-mark ${item.kind}`}>{item.kind === "income" ? "+" : "−"}</span><b>{item.label}</b><span>May 2026</span><strong className={item.kind}>{item.amount}</strong></div>)}</div>
        </section>
      )}

      <footer><div className="footer-brand"><span className="brand-mark">sa</span><div><b>Bharat Sangeet</b><small>Practice · Perform · Preserve</small></div></div><p>Made for our music, and the community around it.</p><p>2026–27 Season</p></footer>

      {showUpload && <div className="modal-backdrop" onMouseDown={() => setShowUpload(false)}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); setShowUpload(false); notify("Saved to the club archive"); }}><button type="button" className="modal-close" onClick={() => setShowUpload(false)}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>Add to club archive</h2><label>Item type<select><option>Recording</option><option>Document</option><option>Photo</option><option>Financial transaction</option></select></label><label>Title<input required placeholder="Give this item a clear name" /></label><label>Choose file<input type="file" /></label><label>Who can access this?<select><option>All club members</option><option>Executives only</option></select></label><button className="primary" type="submit">Save to archive</button></form></div>}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>;
}
