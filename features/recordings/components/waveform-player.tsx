"use client";

// The audio player with the waveform. wavesurfer.js is imported here and only here, so it travels with the recordings workspace
// (loaded on demand by the shell), never with the main bundle.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import WaveSurfer from "wavesurfer.js";
import { formatDuration } from "../model";

export function WaveformPlayer({ url, compact = false }: { url: string; compact?: boolean }) {
  const container = useRef<HTMLDivElement | null>(null);
  const wave = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const instance = WaveSurfer.create({ container: container.current, url, height: compact ? 52 : 86, waveColor: "#b8d3e5", progressColor: "#4b9cd3", cursorColor: "#13294b", barWidth: 2, barGap: 2, barRadius: 0, normalize: true });
    wave.current = instance;
    const onReady = () => { setDuration(instance.getDuration()); setReady(true); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFinish = () => { setPlaying(false); setTime(instance.getDuration()); };
    const onTime = (value: number) => setTime(value);
    instance.on("ready", onReady); instance.on("play", onPlay); instance.on("pause", onPause); instance.on("finish", onFinish); instance.on("timeupdate", onTime);
    return () => { instance.destroy(); wave.current = null; };
  }, [compact, url]);

  function seekBy(amount: number) {
    if (!wave.current) return;
    wave.current.setTime(Math.max(0, Math.min(duration, wave.current.getCurrentTime() + amount)));
  }

  function changeSpeed(event: ChangeEvent<HTMLSelectElement>) {
    const value = Number(event.target.value); setSpeed(value); wave.current?.setPlaybackRate(value);
  }

  return <div className={`waveform-player ${compact ? "compact" : ""}`}><div className="waveform-canvas" ref={container} /><div className="waveform-controls"><button type="button" className="waveform-play" onClick={() => wave.current?.playPause()} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>{playing ? "Ⅱ" : "▶"}</button><button type="button" onClick={() => seekBy(-10)} disabled={!ready}>−10</button><span className="waveform-time">{formatDuration(time)} / {formatDuration(duration)}</span><button type="button" onClick={() => seekBy(10)} disabled={!ready}>＋10</button><label><span>Speed</span><select value={speed} onChange={changeSpeed} disabled={!ready}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label></div></div>;
}
