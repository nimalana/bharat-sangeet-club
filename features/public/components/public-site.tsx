"use client";

import { useEffect, useState } from "react";
import type { ArchiveItem } from "../../../lib/portal-types";
import type { PublicConcert } from "../../../lib/public-concerts";
import { listPublicConcertRecordings, publicSiteAvailable, signPublicConcertUrl } from "../../../lib/api/public";
import { EmptyState } from "../../../components/ui/empty-state";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";
import { heroPhotos } from "../hero-photos";

export function PublicSite({ onSignIn, initialRecordings }: { onSignIn: () => void; initialRecordings: PublicConcert[] | null }) {
  // The list comes from the server (cached five minutes). Only when the server
  // could not read it does the browser load it, as it always did.
  const [recordings, setRecordings] = useState<ArchiveItem[]>(() => (initialRecordings || []) as ArchiveItem[]);
  const [loading, setLoading] = useState(initialRecordings === null);
  useEffect(() => {
    if (!publicSiteAvailable() || initialRecordings !== null) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => { if (!cancelled) setLoading(false); }, 7000);
    const loadPublicRecordings = async () => {
      try {
        // A read that fails is the same as an empty archive here (the catch below).
        const data = await listPublicConcertRecordings();
        if (!cancelled) setRecordings((data || []) as ArchiveItem[]);
      } catch {
        if (!cancelled) setRecordings([]);
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    };
    void loadPublicRecordings();
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [initialRecordings]);
  async function watch(item: ArchiveItem) {
    if (!publicSiteAvailable()) return;
    const signedUrl = await signPublicConcertUrl(item.storage_path);
    if (signedUrl) window.open(signedUrl, "_blank", "noopener,noreferrer");
  }
  return <main className="public-site"><header className="public-header"><button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button><nav><a href="#about">About</a><a href="#concerts">Concerts</a></nav><button className="primary small" onClick={onSignIn}>Member sign in →</button></header><section className="public-hero"><div><span className="public-season">UNC CHAPEL HILL · CARNATIC + HINDUSTANI</span><h1>Indian classical music.<br /><em>Carolina community.</em></h1><p className="lede">Bharat Sangeet brings students together across Carnatic and Hindustani traditions to learn, rehearse, perform, and listen at UNC Chapel Hill.</p><div className="hero-actions"><a className="primary public-link" href="#concerts">Watch our concerts <span>→</span></a><button className="secondary" onClick={onSignIn}>Join or sign in</button></div></div><div className="hero-image"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div className="image-caption"><span>Music at Carolina</span><b>Many traditions, one community</b></div></div></section><section className="public-about" id="about"><div><h2>A home for Indian classical music at UNC</h2></div><p>We are a student community for vocalists, instrumentalists, percussionists, listeners, and anyone curious about Carnatic or Hindustani music. Through rehearsals, subgroups, workshops, and concerts, members learn from both traditions and build lasting friendships.</p></section><section className="section-shell public-concerts" id="concerts"><PageTitle eyebrow="FROM THE STAGE" title="Concert recordings" text="Public performances shared by Bharat Sangeet. Rehearsals and other club materials remain private to members." />{loading ? <LoadingBlock>Loading the archive…</LoadingBlock> : recordings.length ? <div className="public-recording-grid">{recordings.map((item) => <article key={item.id}><p className="recording-kind">Concert recording</p><h3>{item.title}</h3><p>{[item.raga, item.tala, item.description].filter(Boolean).join(" · ")}</p><button className="secondary" onClick={() => watch(item)}>Watch or listen →</button></article>)}</div> : <EmptyState title="Concert archive coming soon" text="Public concert recordings selected by club executives will appear here." />}</section><section className="public-join"><h2>Make music with us.</h2><p>Whether your practice is Carnatic, Hindustani, both, or completely new, there is a place for you here.</p><button className="primary" onClick={onSignIn}>Join Bharat Sangeet →</button></section><footer><div className="footer-brand"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><div><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></div></div><p>Carnatic and Hindustani music at UNC Chapel Hill.</p><p>2026–27 Season</p></footer></main>;
}
