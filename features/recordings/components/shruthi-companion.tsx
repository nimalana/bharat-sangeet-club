"use client";

// The drone that keeps the tonic close while the studio records. tone is imported here and only here (see waveform-player.tsx).
import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { TONICS } from "../model";

export function ShruthiCompanion() {
  const [tonic, setTonic] = useState(TONICS[0]);
  const [pattern, setPattern] = useState<"pa" | "ma">("pa");
  const [volume, setVolume] = useState(45);
  const [active, setActive] = useState(false);
  const synth = useRef<Tone.Synth | null>(null);
  const event = useRef<number | null>(null);
  const step = useRef(0);

  function stop() {
    if (event.current !== null) Tone.Transport.clear(event.current);
    event.current = null; Tone.Transport.stop(); synth.current?.triggerRelease(); synth.current?.dispose(); synth.current = null; setActive(false);
  }

  async function toggle() {
    if (active) { stop(); return; }
    await Tone.start();
    const nextSynth = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.08, decay: 0.7, sustain: 0.2, release: 1.2 } }).toDestination();
    nextSynth.volume.value = -34 + volume * 0.28; synth.current = nextSynth; step.current = 0;
    const fifth = pattern === "pa" ? tonic.frequency * 1.5 : tonic.frequency * 1.3335;
    const notes = [tonic.frequency, fifth, tonic.frequency * 2, fifth];
    event.current = Tone.Transport.scheduleRepeat((time) => { nextSynth.triggerAttackRelease(notes[step.current % notes.length], 1.25, time); step.current += 1; }, 1.5);
    Tone.Transport.start(); setActive(true);
  }

  useEffect(() => { if (synth.current) synth.current.volume.value = -34 + volume * 0.28; }, [volume]);
  useEffect(() => () => stop(), []);

  return <section className={`shruthi-companion ${active ? "active" : ""}`}><div className="shruthi-heading"><div><span className="shruthi-mark">Sa</span><div><strong>Sruthi companion</strong><small>Keep your tonic close while you record.</small></div></div><button type="button" onClick={() => void toggle()} className="shruthi-toggle">{active ? "Stop drone" : "Start drone"}</button></div><div className="shruthi-controls"><label><span>Sa</span><select value={tonic.label} onChange={(event) => { const next = TONICS.find((item) => item.label === event.target.value); if (next) { if (active) stop(); setTonic(next); } }}>{TONICS.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}</select></label><label><span>Pattern</span><select value={pattern} onChange={(event) => { const next = event.target.value as "pa" | "ma"; if (active) stop(); setPattern(next); }}><option value="pa">Sa · Pa · Sa</option><option value="ma">Sa · Ma · Sa</option></select></label><label className="shruthi-volume"><span>Volume</span><input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label></div><p className="shruthi-note">Use headphones during recording so the drone does not bleed into the microphone.</p></section>;
}
