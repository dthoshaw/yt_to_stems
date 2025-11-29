"use client";
import React, { useState, useEffect, useRef } from "react";
import WaveformPlayer from "../components/WaveformPlayer";

export default function Home() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [songName, setSongName] = useState<string | null>(null);
  const [downloadLinks, setDownloadLinks] = useState<{url: string, name: string}[]>([]);
  const [outputFolder, setOutputFolder] = useState<string | null>(null);
  const [bpm, setBpm] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [queue, setQueue] = useState<any[]>([]);
  const [currentJob, setCurrentJob] = useState<any>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completedJobs, setCompletedJobs] = useState<any[]>([]);

  // State to control completed jobs polling
  const [shouldPollCompleted, setShouldPollCompleted] = useState(false);

  // Polling ref to track if we should continue polling
  const pollingRef = useRef(false);

  // Add mode state
  const [mode, setMode] = useState<'youtube' | 'stem'>('stem');

  // Poll job status
  useEffect(() => {
    if (!jobId || !pollingRef.current) return;

    const pollStatus = async () => {
      try {
        const res = await fetch(`http://localhost:8000/status/${jobId}`);
        if (!res.ok) {
          console.error("Failed to fetch status");
          return;
        }
        const data = await res.json();
        
        if (data.status === "done") {
          setIsLoading(false);
          setStatus("done");
          pollingRef.current = false;
          
          if (data.bpm) setBpm(data.bpm);
          if (data.key) setKey(data.key);
          
          if (songName) {
            const filesRes = await fetch(`http://localhost:8000/files/${jobId}/${songName}`);
            if (filesRes.ok) {
              const filesData = await filesRes.json();
              setDownloadLinks(filesData.files || []);
            }
          }
          
          setTimeout(() => setShowResults(true), 150);
        } else if (data.status === "error") {
          setIsLoading(false);
          setStatus("error");
          setError(data.error || "An error occurred during processing");
          pollingRef.current = false;
        } else if (data.status === "downloading" || data.status === "splitting" || data.status === "cleaning" || data.status === "separating") {
          setStatus(data.status);
        }
      } catch (err) {
        console.error("Error polling status:", err);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 500); 
    return () => {
      clearInterval(interval);
    };
  }, [jobId, songName]);

  // Poll job queue
  useEffect(() => {
    const pollQueue = async () => {
      try {
        const res = await fetch("http://localhost:8000/queue");
        if (res.ok) {
          const data = await res.json();
          setQueue(data.queue || []);
          setCurrentJob(data.current_job || null);
        }
      } catch (err) {
        console.error("Error polling queue:", err);
      }
    };
    pollQueue();
    const interval = setInterval(pollQueue, 500);
    return () => clearInterval(interval);
  }, []);

  // Poll completed jobs only when shouldPollCompleted is true
  useEffect(() => {
    if (!shouldPollCompleted) return;
    const pollCompleted = async () => {
      try {
        const res = await fetch("http://localhost:8000/completed");
        if (res.ok) {
          const data = await res.json();
          setCompletedJobs(data.completed || []);
        }
      } catch {}
    };
    pollCompleted();
    const interval = setInterval(pollCompleted, 500); 
    return () => clearInterval(interval);
  }, [shouldPollCompleted]);

  // Start conversion
  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setStatus("downloading");
    setJobId(null);
    setSongName(null);
    setOutputFolder(null);
    setDownloadLinks([]);
    setBpm(null);
    setKey(null);
    setShowResults(false);
    pollingRef.current = false;
    setShouldPollCompleted(true);
    
    try {
      const formData = new FormData();
      formData.append("url", url);
      formData.append("name", name);
      formData.append("mode", mode);
      const res = await fetch("http://localhost:8000/start", {
        method: "POST",
        body: formData
      });
      if (!res.ok) {
        setError("Failed to start conversion");
        setIsLoading(false);
        return;
      }
      const data = await res.json();
      if (data.job_id && data.song_name) {
        setJobId(data.job_id);
        setSongName(data.song_name);
        setOutputFolder(data.output_folder);
        pollingRef.current = true;
      } else {
        setError("Failed to start conversion");
        setIsLoading(false);
      }
    } catch (err) {
      setError("Failed to start conversion");
      setIsLoading(false);
      console.error("Fetch error:", err);
    }
  };

  // Remove job from queue
  const handleRemoveJob = async (jobId: string) => {
    try {
      await fetch(`http://localhost:8000/remove_job/${jobId}`, { method: "POST" });
    } catch {}
  };

  // Reset form
  const handleReset = () => {
    setUrl("");
    setName("");
    setStatus(null);
    setError(null);
    setIsLoading(false);
    setJobId(null);
    setSongName(null);
    setDownloadLinks([]);
    setOutputFolder(null);
    setBpm(null);
    setKey(null);
    setShowResults(false);
    pollingRef.current = false;
  };

  // Remove spinner and show form when no job is running
  useEffect(() => {
    if (!isLoading && (status === "done" || status === null) && queue.length === 0) {
      setShowResults(false); // Always show the form when no job is running
      setStatus(null);
      setJobId(null);
      setSongName(null);
      setOutputFolder(null);
      setDownloadLinks([]);
      setBpm(null);
      setKey(null);
      pollingRef.current = false;
    }
  }, [isLoading, status, queue]);

  // Only show spinner when a job is running
  const renderSpinner = () => {
    if (!isLoading || !status) return null;
    return (
      <div className="mt-10">
        <div className="flex flex-col items-center">
          <div className="relative w-10 h-10 mb-6">
            <div className="absolute inset-0 border border-[#3a3a3a] rounded-full opacity-50"></div>
            <div className="absolute inset-0 border border-transparent border-t-[#8a8a8a] rounded-full animate-spin" style={{ animationDuration: '1s' }}></div>
            <div className="absolute inset-2 border border-transparent border-r-[#6a6a6a] rounded-full animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }}></div>
          </div>
          <p className="text-[#8a8a8a] text-xs font-light tracking-wider uppercase">
            {getStatusText(status, currentJob?.name)}
          </p>
        </div>
      </div>
    );
  };

  // Status text mapping
  const getStatusText = (status: string | null, jobName?: string | null): string => {
    if (!status) return "";
    const statusMap: Record<string, string> = {
      downloading: "Downloading",
      splitting: "Splitting",
      cleaning: "Processing",
      separating: "Splitting",
      done: "Complete",
      error: "Error",
    };
    let base = statusMap[status] || status;
    if (jobName) base += ` (${jobName})`;
    return base;
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-4">
      <div className="w-full max-w-md relative">
        {queueOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-30 flex items-center justify-end transition-opacity duration-300 animate-fadeIn"
            onClick={() => setQueueOpen(false)}
          >
            <div
              className="w-96 bg-[#252525] border-l border-[#3a3a3a] h-full shadow-2xl flex flex-col animate-slideInRight"
              onClick={e => e.stopPropagation()}
            >
              <div className="relative flex flex-col items-center justify-center px-5 py-6 border-b border-[#3a3a3a]">
                <button
                  onClick={() => setQueueOpen(false)}
                  className="absolute top-4 right-4 text-[#e8e8e8] text-xs px-2 py-1 rounded hover:bg-[#2a2a2a]"
                >
                  Close
                </button>
                <span className="text-[#8a8a8a] text-xs font-light uppercase tracking-wider mb-2">Currently Processing</span>
                {currentJob ? (
                  <div className="text-[#e8e8e8] text-lg font-bold font-mono text-center mb-2">{currentJob.name}</div>
                ) : (
                  <div className="text-[#6a6a6a] text-lg font-light font-mono text-center mb-2">Idle</div>
                )}
              </div>

              <div className="flex flex-col px-5 py-6 flex-1">
                <span className="text-[#8a8a8a] text-xs font-light uppercase tracking-wider mb-3">Queue</span>
                <div className="space-y-0">
                  {queue.length > 0 ? (
                    queue.map((job, idx) => (
                      <div key={job.job_id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-[#818cf8] text-base font-bold font-mono">{idx + 1}</span>
                          <span className="text-[#e8e8e8] text-base font-bold font-mono truncate">{job.name}</span>
                        </div>
                        <button
                          className="ml-2 px-2 py-1 text-xs bg-[#252525] border border-[#3a3a3a] rounded text-[#d4a4a4] hover:bg-[#3a1f1f] hover:border-[#4a2a2a]"
                          onClick={() => handleRemoveJob(job.job_id)}
                        >Remove</button>
                      </div>
                    ))
                  ) : (
                    <div className="text-[#6a6a6a] text-sm font-light font-mono">Queue is empty</div>
                  )}

                  {queue.length > 1 && queue.map((_, idx) => idx < queue.length - 1 && (
                    <div key={"sep-" + idx} className="w-4/5 mx-auto border-t border-[#3a3a3a] opacity-60"></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}


        {completedOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 flex items-center justify-end transition-opacity duration-300 animate-fadeIn"
            onClick={() => setCompletedOpen(false)}
          >
            <div
              className="w-96 bg-[#252525] border-l border-[#3a3a3a] h-full shadow-2xl flex flex-col animate-slideInRight"
              onClick={e => e.stopPropagation()}
            >
              <div className="relative flex flex-col items-center justify-center px-5 py-6 border-b border-[#3a3a3a]">
                <button
                  onClick={() => setCompletedOpen(false)}
                  className="absolute top-4 right-4 text-[#e8e8e8] text-xs px-2 py-1 rounded hover:bg-[#2a2a2a]"
                >
                  Close
                </button>
                <span className="text-[#8a8a8a] text-xs font-light uppercase tracking-wider mb-2">Completed Jobs</span>
              </div>
              <div className="flex flex-col px-5 py-6 flex-1 overflow-y-auto">
                {completedJobs.length > 0 ? (
                  completedJobs.map((job, idx) => (
                    <div key={job.job_id} className="mb-6 transition-transform duration-300 ease-in-out hover:scale-[1.02] hover:shadow-lg animate-fadeIn">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-[#818cf8] text-base font-bold font-mono">{idx + 1}</span>
                        <span className="text-[#e8e8e8] text-base font-bold font-mono truncate">{job.song_name}</span>
                        {job.url && (
                          <a href={job.url} target="_blank" rel="noopener noreferrer" title="Go to YouTube" className="ml-1 text-[#818cf8] hover:text-[#a5b4fc]">
                            <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ verticalAlign: 'middle' }}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14 3h7m0 0v7m0-7L10 14m-4 0h4v4" />
                            </svg>
                          </a>
                        )}
                      </div>
\
                      {(job.bpm || job.key) && (
                        <div className="flex gap-3 ml-7 mb-2">
                          {job.bpm && (
                            <div className="px-3 py-1 bg-[#1f1f1f] border border-[#3a3a3a] rounded text-[#e8e8e8] text-xs font-mono">BPM: {job.bpm}</div>
                          )}
                          {job.key && (
                            <div className="px-3 py-1 bg-[#1f1f1f] border border-[#3a3a3a] rounded text-[#e8e8e8] text-xs font-mono">Key: {job.key}</div>
                          )}
                        </div>
                      )}
                      <div className="ml-7 space-y-2">
                        {job.stems && job.stems.length > 0 ? (
                          [...job.stems].sort((a, b) => {
                            if (a.name.endsWith('[full].mp3')) return -1;
                            if (b.name.endsWith('[full].mp3')) return 1;
                            return a.name.localeCompare(b.name);
                          }).map((stem: any) => (
                            <div key={stem.url} className="flex items-center gap-2 ml-2 mb-2">
                              <WaveformPlayer src={`http://localhost:8000${stem.url}`} name={stem.name} />
                              <span className="text-[#e8e8e8] text-sm font-mono truncate flex-1">{stem.name}</span>
                              <a href={`http://localhost:8000${stem.url}`} download className="text-[#fff] hover:text-[#a5b4fc]">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </a>
                            </div>
                          ))
                        ) : (
                          <span className="text-[#6a6a6a] text-xs font-mono">No stems found</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-[#6a6a6a] text-sm font-light font-mono">No completed jobs yet</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-8 shadow-lg transition-transform duration-200 hover:scale-[1.01] hover:shadow-xl">
          {!showResults && (
            <form onSubmit={async (e) => {
              await handleConvert(e);
              setUrl("");
              setName("");
            }} className="space-y-5">
              <div className="flex justify-center mb-6">
                <div className="flex items-center gap-4">
                  <span className={`text-xs font-mono ${mode === 'youtube' ? 'text-[#818cf8]' : 'text-[#8a8a8a]'}`}>YouTube Mode</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={mode === 'stem'} onChange={e => setMode(e.target.checked ? 'stem' : 'youtube')} className="sr-only peer" />
                    <div className="w-11 h-6 bg-[#222] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#818cf8] rounded-full peer peer-checked:bg-[#818cf8] transition-all duration-200"></div>
                    <div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${mode === 'stem' ? 'translate-x-5' : ''}`}></div>
                  </label>
                  <span className={`text-xs font-mono ${mode === 'stem' ? 'text-[#818cf8]' : 'text-[#8a8a8a]'}`}>Stem Mode</span>
                </div>
              </div>

              <div className="relative">
                <input
                  type="url"
                  required
                  placeholder="YouTube URL"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  className="w-full px-4 py-3.5 bg-[#1f1f1f] border border-[#3a3a3a] rounded text-[#e8e8e8] placeholder-[#6a6a6a] text-sm focus:outline-none focus:border-[#818cf8] focus:bg-[#222222] transition-all duration-200 hover:scale-[1.01] hover:shadow-lg"
                />
              </div>

              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Track Name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-3.5 bg-[#1f1f1f] border border-[#3a3a3a] rounded text-[#e8e8e8] placeholder-[#6a6a6a] text-sm focus:outline-none focus:border-[#818cf8] focus:bg-[#222222] transition-all duration-200 hover:scale-[1.01] hover:shadow-lg"
                />
              </div>

              <button
                type="submit"
                className="button-animated-border w-full py-3.5 bg-[#2a2a2a] border border-[#3a3a3a] text-[#e8e8e8] text-sm font-light hover:bg-[#2f2f2f] hover:border-[#4a4a4a] active:bg-[#252525] active:scale-[0.98] transition-all duration-200 shadow-sm hover:shadow-md focus:scale-105 focus:ring-2 focus:ring-[#818cf8] relative"
              >
                <span className="relative z-10">Submit</span>
                <div className="border-anim left"></div>
                <div className="border-anim top"></div>
                <div className="border-anim right"></div>
                <div className="border-anim bottom"></div>
              </button>

              <div className="flex justify-center mt-4 gap-2">
                <button
                  type="button"
                  onClick={() => setQueueOpen(true)}
                  className="button-animated-border px-3 py-2 bg-[#252525] border border-[#3a3a3a] rounded text-[#e8e8e8] text-xs font-light hover:bg-[#2f2f2f] hover:border-[#4a4a4a] transition-all duration-200 focus:scale-105 focus:ring-2 focus:ring-[#818cf8] relative"
                >
                  <span className="relative z-10">Show Queue</span>
                  <div className="border-anim left"></div>
                  <div className="border-anim top"></div>
                  <div className="border-anim right"></div>
                  <div className="border-anim bottom"></div>
                </button>
                <button
                  type="button"
                  onClick={() => setCompletedOpen(true)}
                  className="button-animated-border px-3 py-2 bg-[#252525] border border-[#3a3a3a] rounded text-[#e8e8e8] text-xs font-light hover:bg-[#2f2f2f] hover:border-[#4a4a4a] transition-all duration-200 focus:scale-105 focus:ring-2 focus:ring-[#818cf8] relative"
                >
                  <span className="relative z-10">Show Completed</span>
                  <div className="border-anim left"></div>
                  <div className="border-anim top"></div>
                  <div className="border-anim right"></div>
                  <div className="border-anim bottom"></div>
                </button>
              </div>
            </form>
          )}

          {renderSpinner()}

          {error && !isLoading && (
            <div className="mt-8">
              <div className="text-center py-3 px-4 bg-[#2a1f1f] border border-[#4a2a2a] rounded text-[#d4a4a4] text-sm">
                {error}
              </div>
              <button
                onClick={handleReset}
                className="mt-4 w-full py-2.5 bg-[#2a2a2a] border border-[#3a3a3a] text-[#8a8a8a] text-sm font-light hover:text-[#e8e8e8] hover:border-[#4a4a4a] transition-all duration-200 rounded"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
