"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { ClubEvent } from "../../../lib/portal-types";
import type { Section } from "../../../lib/sections";

type TalamPattern = { name: string; tradition: "Hindustani" | "Carnatic"; beats: number; divisions: number[] };

const talamPatterns: TalamPattern[] = [
  { name: "Teentaal", tradition: "Hindustani", beats: 16, divisions: [4, 4, 4, 4] },
  { name: "Dadra", tradition: "Hindustani", beats: 6, divisions: [3, 3] },
  { name: "Keharwa", tradition: "Hindustani", beats: 8, divisions: [4, 4] },
  { name: "Adi Talam", tradition: "Carnatic", beats: 8, divisions: [4, 2, 2] },
  { name: "Misra Chapu", tradition: "Carnatic", beats: 7, divisions: [3, 2, 2] },
  { name: "Khanda Chapu", tradition: "Carnatic", beats: 5, divisions: [2, 3] },
];

export function TalamMeasure({ next, nextWhen, onNavigate }: { next?: ClubEvent; nextWhen: string; onNavigate: (section: Section) => void }) {
  const [pattern, setPattern] = useState<TalamPattern | null>(null);
  const [beat, setBeat] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const measureRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setPattern(talamPatterns[Math.floor(Math.random() * talamPatterns.length)]);
  }, []);

  useEffect(() => {
    const node = measureRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setIsActive(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleVisibility() { setIsActive(document.visibilityState === "visible"); }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (!pattern || reduceMotion || !isActive) return;
    const interval = window.setInterval(() => setBeat((current) => (current + 1) % pattern.beats), 700);
    return () => window.clearInterval(interval);
  }, [isActive, pattern, reduceMotion]);

  const beatMarkers = pattern ? pattern.divisions.map((size, divisionIndex) => {
    const offset = pattern.divisions.slice(0, divisionIndex).reduce((total, count) => total + count, 0);
    return <span className="talam-division" key={`${pattern.name}-${divisionIndex}`}>{Array.from({ length: size }, (_, localIndex) => {
      const markerIndex = offset + localIndex;
      const isCurrent = markerIndex === beat;
      return <motion.span className={`talam-track-beat ${markerIndex === 0 ? "downbeat" : ""}`} key={markerIndex} animate={reduceMotion ? { opacity: markerIndex === 0 ? 0.7 : 0.35, scaleY: 1 } : { opacity: isCurrent ? 1 : 0.28, scaleY: isCurrent ? 1.45 : 1 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }} />;
    })}</span>;
  }) : <span className="talam-division"><span className="talam-track-beat downbeat" /></span>;
  const beatLabel = pattern ? `Beat ${beat + 1} of ${pattern.beats}` : "Finding a talam";

  return <section ref={measureRef} className="dashboard-measure" aria-labelledby="next-event-heading"><div className="measure-index"><span>TALA / TAAL</span><strong>{pattern?.beats ?? "—"}</strong><small>{pattern?.name ?? "Rhythm cycle"}</small><span>{pattern?.tradition ?? "Visual study"}</span></div><div className="measure-main"><span id="next-event-heading">Next on the calendar</span><h2>{next?.title || "The next gathering starts here"}</h2><p>{nextWhen}{next?.location ? ` · ${next.location}` : ""}</p><div className="measure-actions"><button type="button" onClick={() => onNavigate("calendar")}>View calendar</button><button type="button" onClick={() => onNavigate("groups")}>Open a group</button></div><div className="measure-track" aria-hidden="true"><div className="talam-track-beats">{beatMarkers}</div><motion.b animate={{ opacity: pattern ? 1 : 0.7 }} transition={{ duration: 0.25 }}>{beatLabel}</motion.b></div></div></section>;
}
