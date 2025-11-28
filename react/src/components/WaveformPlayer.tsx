import React, { useRef, useEffect, useState } from "react";

interface WaveformPlayerProps {
  src: string;
  name: string;
}

export default function WaveformPlayer({ src, name }: WaveformPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);

  // Draw waveform
  useEffect(() => {
    if (!src) return;
    fetch(src)
      .then(res => res.arrayBuffer())
      .then(buffer => {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        return ctx.decodeAudioData(buffer);
      })
      .then(audioBuffer => {
        const rawData = audioBuffer.getChannelData(0);
        const samples = 200;
        const blockSize = Math.floor(rawData.length / samples);
        const peaksArr = [];
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          peaksArr.push(sum / blockSize);
        }
        setPeaks(peaksArr);
      });
  }, [src]);

  useEffect(() => {
    if (!canvasRef.current || peaks.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Normalize peaks so the tallest bar fills the canvas
    const maxPeak = Math.max(...peaks);
    ctx.fillStyle = "#fff"; // White accent
    const width = canvas.width;
    const height = canvas.height;
    const barWidth = width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const peak = maxPeak > 0 ? peaks[i] / maxPeak : 0;
      const barHeight = peak * height;
      ctx.fillRect(i * barWidth, height - barHeight, barWidth, barHeight);
    }
    // Draw progress overlay
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    const progress = (currentTime / duration) * width;
    ctx.fillRect(0, 0, progress, height);
  }, [peaks, currentTime, duration]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  // Ensure play/x button resets if another audio starts playing
  useEffect(() => {
    const onPlay = (e: Event) => {
      if (!audioRef.current) return;
      if (e.target !== audioRef.current) {
        setPlaying(false);
      }
    };
    window.addEventListener("play", onPlay, true);
    return () => {
      window.removeEventListener("play", onPlay, true);
    };
  }, []);

  // Utility to stop all other audio players
  function stopAllAudioExcept(current: HTMLAudioElement | null) {
    const audios = document.querySelectorAll("audio");
    audios.forEach(audio => {
      if (audio !== current) {
        (audio as HTMLAudioElement).pause();
        (audio as HTMLAudioElement).currentTime = 0;
      }
    });
  }

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    audioRef.current.currentTime = percent * duration;
    setCurrentTime(audioRef.current.currentTime);
    stopAllAudioExcept(audioRef.current);
    audioRef.current.play();
    setPlaying(true);
  };

  return (
    <div className="w-full flex flex-col items-start mb-2">
      <div className="flex items-center gap-2 mb-1">
        <button onClick={handlePlayPause} className="text-[#818cf8] hover:text-[#a5b4fc]">
          {playing ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v18l15-9-15-9z" />
            </svg>
          )}
        </button>
        <span className="text-xs text-[#e8e8e8] font-mono">{name}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={300}
        height={40}
        className="w-full h-10 bg-[#181818] rounded cursor-pointer"
        onClick={handleSeek}
      />
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setPlaying(false)}
        style={{ display: "none" }}
      />
    </div>
  );
}
