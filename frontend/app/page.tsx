"use client";

import { useState, useRef, useCallback } from "react";

const API_BASE = "http://127.0.0.1:8008";

type Status = "idle" | "pending" | "transcribing" | "generating" | "done" | "error";

type Segment = {
  id: string;
  speaker: string;
  start: number;
  text: string;
  language: string;
  needs_review?: boolean;
};

type Notes = {
  summary: string;
  action_items: { task: string; owner: string; deadline: string }[];
  decisions: { decision: string; context: string }[];
  languages: Record<string, number>;
};

type Comment = {
  id: string;
  author: string;
  text: string;
  flagged: boolean;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", nl: "Dutch", ru: "Russian", zh: "Chinese", ja: "Japanese",
  ko: "Korean", ar: "Arabic", hi: "Hindi", tr: "Turkish", pl: "Polish",
  sv: "Swedish", fi: "Finnish", no: "Norwegian", da: "Danish", el: "Greek",
  he: "Hebrew", th: "Thai", vi: "Vietnamese", id: "Indonesian", uk: "Ukrainian",
  cs: "Czech", ro: "Romanian", hu: "Hungarian",
};

function langName(code: string) {
  return LANGUAGE_NAMES[code?.toLowerCase()] || code;
}

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function slugify(s: string) {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "meeting"
  );
}

function formatTime(start: number) {
  const mm = Math.floor(start / 60);
  const ss = String(Math.floor(start % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

function buildTranscriptFile(
  meetingName: string,
  meetingDate: string,
  notes: Notes,
  segments: Segment[],
  flaggedSegments: Set<string>,
  comments: Comment[]
) {
  const lines: string[] = [];
  lines.push(`MEETING: ${meetingName}`);
  lines.push(`DATE: ${meetingDate}`);
  lines.push("");
  lines.push("— SUMMARY —");
  lines.push(notes.summary || "No summary generated.");
  lines.push("");
  lines.push("— ACTION ITEMS —");
  if (notes.action_items?.length) {
    notes.action_items.forEach((item) => {
      const owner = item.owner && item.owner !== "Unknown" ? ` (${item.owner})` : "";
      const deadline = item.deadline ? ` — due ${item.deadline}` : "";
      lines.push(`- ${item.task}${owner}${deadline}`);
    });
  } else {
    lines.push("None detected.");
  }
  lines.push("");
  lines.push("— DECISIONS —");
  if (notes.decisions?.length) {
    notes.decisions.forEach((d) => {
      lines.push(`- ${d.decision}${d.context ? ` — ${d.context}` : ""}`);
    });
  } else {
    lines.push("None detected.");
  }
  lines.push("");
  lines.push("— TRANSCRIPT —");
  segments.forEach((s) => {
    const flag = flaggedSegments.has(s.id) ? " [FLAGGED]" : "";
    lines.push(`[${formatTime(s.start)}] ${s.text.trim()} (${langName(s.language)})${flag}`);
  });
  lines.push("");
  lines.push("— VIEWER NOTES —");
  if (comments.length) {
    comments.forEach((c) => {
      const flag = c.flagged ? " [FLAGGED]" : "";
      lines.push(`- ${c.author}${flag}: ${c.text}`);
    });
  } else {
    lines.push("No viewer notes added.");
  }

  return lines.join("\n");
}

function DownloadModal({
  defaultName,
  onCancel,
  onConfirm,
}: {
  defaultName: string;
  onCancel: () => void;
  onConfirm: (name: string, date: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [date, setDate] = useState(todayISO());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6">
      <div className="w-full max-w-sm bg-white border border-[#E4E1F5] rounded-2xl p-6 shadow-xl shadow-indigo-100">
        <h3 className="font-serif text-lg text-[#1E1B2E] mb-1">Save transcript</h3>
        <p className="text-sm text-[#6B6685] mb-6">
          Name the file and confirm the meeting date.
        </p>

        <label className="block text-xs font-semibold uppercase tracking-wide text-[#6D5FE8] mb-2">
          File name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q3 planning sync"
          className="w-full mb-5 bg-[#FAF9FE] border border-[#E4E1F5] rounded-lg px-3 py-2 text-sm text-[#1E1B2E] focus:outline-none focus:border-[#6D5FE8] transition-colors"
        />

        <label className="block text-xs font-semibold uppercase tracking-wide text-[#6D5FE8] mb-2">
          Meeting date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full mb-6 bg-[#FAF9FE] border border-[#E4E1F5] rounded-lg px-3 py-2 text-sm text-[#1E1B2E] focus:outline-none focus:border-[#6D5FE8] transition-colors"
        />

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="text-sm text-[#6B6685] hover:text-[#1E1B2E] px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(name.trim() || defaultName, date)}
            className="text-sm font-semibold bg-[#6D5FE8] text-white rounded-lg px-4 py-2 hover:bg-[#5A4CD6] transition-colors"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveNoteModal({
  draft,
  onCancel,
  onConfirm,
}: {
  draft: string;
  onCancel: () => void;
  onConfirm: (author: string, flagged: boolean) => void;
}) {
  const [author, setAuthor] = useState("");
  const [flagged, setFlagged] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6">
      <div className="w-full max-w-sm bg-white border border-[#E4E1F5] rounded-2xl p-6 shadow-xl shadow-indigo-100">
        <h3 className="font-serif text-lg text-[#1E1B2E] mb-1">Save note</h3>
        <p className="text-sm text-[#6B6685] mb-5 line-clamp-2">&ldquo;{draft}&rdquo;</p>

        <label className="block text-xs font-semibold uppercase tracking-wide text-[#6D5FE8] mb-2">
          Your name
        </label>
        <input
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="e.g. Priya"
          autoFocus
          className="w-full mb-5 bg-[#FAF9FE] border border-[#E4E1F5] rounded-lg px-3 py-2 text-sm text-[#1E1B2E] focus:outline-none focus:border-[#6D5FE8] transition-colors"
        />

        <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={flagged}
            onChange={(e) => setFlagged(e.target.checked)}
            className="accent-orange-500 w-4 h-4"
          />
          <span className="text-sm text-[#4B4667]">Flag this note for follow-up</span>
        </label>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="text-sm text-[#6B6685] hover:text-[#1E1B2E] px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(author.trim() || "Anonymous", flagged)}
            className="text-sm font-semibold bg-[#6D5FE8] text-white rounded-lg px-4 py-2 hover:bg-[#5A4CD6] transition-colors"
          >
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}

const CHIP_LANGS = ["EN", "ES", "HI", "FR"];

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [notes, setNotes] = useState<Notes | null>(null);
  const [error, setError] = useState<string>("");
  const [showDownload, setShowDownload] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingNoteText, setPendingNoteText] = useState<string | null>(null);
  const [flaggedSegments, setFlaggedSegments] = useState<Set<string>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(
    (id: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/meetings/${id}/status`);
          const data = await res.json();
          setStatus(data.status);

          if (data.status === "done") {
            stopPolling();
            const notesRes = await fetch(`${API_BASE}/meetings/${id}/notes`);
            const notesData = await notesRes.json();
            setSegments(notesData.segments || []);
            setNotes(notesData.notes || null);
          }
          if (data.status === "error") {
            stopPolling();
            setError("Something went wrong while processing this meeting.");
          }
        } catch {
          stopPolling();
          setError("Lost connection to the server.");
        }
      }, 2000);
    },
    [stopPolling]
  );

  const handleFile = async (file: File) => {
    setError("");
    setFileName(file.name);
    setStatus("pending");
    setNotes(null);
    setSegments([]);
    setComments([]);
    setFlaggedSegments(new Set());

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", file.name);

    try {
      const res = await fetch(`${API_BASE}/meetings/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      pollStatus(data.meeting_id);
    } catch {
      setStatus("error");
      setError("Could not reach the backend. Is it running on port 8008?");
    }
  };

  const reset = () => {
    stopPolling();
    setStatus("idle");
    setFileName("");
    setSegments([]);
    setNotes(null);
    setError("");
    setComments([]);
    setFlaggedSegments(new Set());
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const downloadTranscript = (name: string, date: string) => {
    if (!notes) return;
    const content = buildTranscriptFile(name, date, notes, segments, flaggedSegments, comments);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(name)}-${date}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setShowDownload(false);
  };

  const toggleSegmentFlag = (id: string) => {
    setFlaggedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startSaveNote = () => {
    if (!noteDraft.trim()) return;
    setPendingNoteText(noteDraft.trim());
  };

  const confirmSaveNote = (author: string, flagged: boolean) => {
    if (!pendingNoteText) return;
    setComments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), author, text: pendingNoteText, flagged },
    ]);
    setPendingNoteText(null);
    setNoteDraft("");
  };

  const steps: { key: Status; label: string }[] = [
    { key: "pending", label: "Uploading" },
    { key: "transcribing", label: "Transcribing" },
    { key: "generating", label: "Generating notes" },
    { key: "done", label: "Done" },
  ];
  const currentStepIndex = steps.findIndex((s) => s.key === status);
  const isProcessing = status !== "idle" && status !== "done" && status !== "error";

  return (
    <div className="min-h-screen flex flex-col items-center">
      {/* top bar */}
      <div className="w-full max-w-5xl flex items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#6D5FE8] flex items-center justify-center text-white text-[10px] font-bold">
            ML
          </span>
          <span className="font-semibold tracking-tight text-[#1E1B2E]">MeetLing</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-[#6B6685]">
          <span>Nithya Vangala</span>
          <span className="w-7 h-7 rounded-full bg-[#E4E1F5] text-[#6D5FE8] text-xs font-semibold flex items-center justify-center">
            NV
          </span>
        </div>
      </div>

      <div className="w-full max-w-2xl px-6 pt-16 pb-24 flex flex-col items-center text-center">
        {status === "idle" && (
          <div className="relative w-full mb-10">
            <span className="absolute -top-2 left-2 bg-white text-[#185FA5] text-[11px] px-2.5 py-1 rounded-full -rotate-6 shadow-sm">
              hola
            </span>
            <span className="absolute top-6 right-4 bg-white text-[#0F6E56] text-[11px] px-2.5 py-1 rounded-full rotate-6 shadow-sm">
              bonjour
            </span>
            <span className="absolute top-24 left-8 bg-white text-[#993C1D] text-[11px] px-2.5 py-1 rounded-full rotate-3 shadow-sm">
              こんにちは
            </span>
            <span className="absolute top-0 right-24 bg-white text-[#712B13] text-[11px] px-2.5 py-1 rounded-full -rotate-4 shadow-sm">
              hallo
            </span>

            <div className="text-center pt-14">
              <span className="inline-flex items-center gap-2 bg-white text-[#185FA5] text-xs font-semibold px-3.5 py-1.5 rounded-full mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-[#378ADD]" />
                Multilingual meeting AI
              </span>

              <h1 className="font-serif text-4xl text-[#042C53] leading-tight mb-1">
                One meeting.
              </h1>
              <h1 className="font-serif text-4xl text-[#378ADD] leading-tight mb-5">
                Every language.
              </h1>

              <p className="text-[#185FA5] text-sm max-w-md mx-auto mb-8 leading-relaxed">
                Upload a recording in any language. Get a translated
                transcript, a summary, and clear next steps.
              </p>
            </div>
          </div>
        )}

        {status === "idle" && (
          <div className="w-full">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center gap-3 bg-white rounded-2xl py-14 cursor-pointer transition-colors border-2 ${
                dragActive ? "border-[#378ADD]" : "border-transparent hover:border-[#B5D4F4]"
              }`}
            >
              <div className="flex items-end gap-1 h-7 mb-1">
                <span className="w-1 h-[40%] bg-[#85B7EB] rounded-full" />
                <span className="w-1 h-[90%] bg-[#378ADD] rounded-full" />
                <span className="w-1 h-[60%] bg-[#185FA5] rounded-full" />
                <span className="w-1 h-full bg-[#378ADD] rounded-full" />
                <span className="w-1 h-[50%] bg-[#85B7EB] rounded-full" />
              </div>
              <span className="text-[#042C53] font-semibold text-sm">
                Drop your recording here
              </span>
              <span className="text-[#6B6685] text-xs">MP3, WAV or M4A · up to 500 MB</span>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>

            <button
              onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
              className="w-full mt-4 bg-[#378ADD] text-white rounded-xl py-3 text-sm font-semibold hover:bg-[#185FA5] transition-colors"
            >
              Generate meeting notes →
            </button>
          </div>
        )}

        {isProcessing && (
          <div className="w-full border border-[#E4E1F5] rounded-2xl p-8 bg-white text-left">
            <p className="text-sm text-[#6B6685] mb-6 truncate font-mono">{fileName}</p>
            <div className="flex flex-col gap-4">
              {steps.map((step, i) => (
                <div key={step.key} className="flex items-center gap-3">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      i <= currentStepIndex ? "bg-[#6D5FE8]" : "bg-[#E4E1F5]"
                    }`}
                  />
                  <span
                    className={`text-sm ${
                      i <= currentStepIndex ? "text-[#1E1B2E]" : "text-[#B9B5D4]"
                    }`}
                  >
                    {step.label}
                  </span>
                  {i === currentStepIndex && (
                    <span className="ml-1 w-3 h-3 border-2 border-[#6D5FE8] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="w-full border border-red-200 bg-red-50 rounded-2xl p-8 text-left">
            <p className="text-red-600 text-sm mb-4">{error || "Something went wrong."}</p>
            <button
              onClick={reset}
              className="text-sm font-semibold text-[#1E1B2E] border border-[#E4E1F5] rounded-lg px-4 py-2 hover:border-[#6D5FE8] transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {status === "done" && notes && (
        <div className="w-full max-w-5xl px-6 pb-24 flex flex-col gap-5 text-left">
          {segments.some((s) => s.needs_review) && (
            <div className="flex items-center gap-3 border border-red-200 bg-red-50 rounded-xl px-4 py-3">
              <span className="text-red-500">⚠</span>
              <p className="text-sm text-red-700">
                Not everything in this meeting could be confidently transcribed or
                translated. Lines marked <span className="font-semibold">&ldquo;review&rdquo;</span> in
                the transcript below should be checked manually.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#6D5FE8]">
              Results
            </span>
            <button
              onClick={() => setShowDownload(true)}
              className="text-sm font-semibold bg-[#6D5FE8] text-white rounded-lg px-4 py-2 hover:bg-[#5A4CD6] transition-colors"
            >
              Download transcript
            </button>
          </div>

          <div className="border border-[#E4E1F5] rounded-2xl p-6 bg-white">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6D5FE8] mb-3">
              Summary
            </h2>
            <p className="text-[#2A2640] text-sm leading-relaxed">{notes.summary}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="border border-[#E4E1F5] rounded-2xl p-6 bg-white">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6D5FE8] mb-3">
                Action items
              </h2>
              {notes.action_items?.length ? (
                <ul className="flex flex-col gap-2">
                  {notes.action_items.map((item, i) => (
                    <li key={i} className="text-sm text-[#2A2640] flex gap-2">
                      <span className="text-[#6D5FE8]">→</span>
                      <span>
                        {item.task}
                        {item.owner && item.owner !== "Unknown" && (
                          <span className="text-[#9490AD]"> — {item.owner}</span>
                        )}
                        {item.deadline && (
                          <span className="text-[#9490AD]"> · {item.deadline}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[#9490AD] text-sm">No action items detected.</p>
              )}
            </div>

            <div className="border border-[#E4E1F5] rounded-2xl p-6 bg-white">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6D5FE8] mb-3">
                Decisions
              </h2>
              {notes.decisions?.length ? (
                <ul className="flex flex-col gap-2">
                  {notes.decisions.map((d, i) => (
                    <li key={i} className="text-sm text-[#2A2640]">
                      <span className="font-medium">{d.decision}</span>
                      {d.context && <span className="text-[#9490AD]"> — {d.context}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[#9490AD] text-sm">No decisions detected.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div className="border border-[#E4E1F5] rounded-2xl p-6 bg-white">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6D5FE8] mb-3">
                Transcript
              </h2>
              <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-2">
                {segments.map((s) => {
                  const isFlagged = flaggedSegments.has(s.id);
                  return (
                    <div
                      key={s.id}
                      className={`text-sm flex gap-3 items-start rounded-md px-2 py-1.5 -mx-2 transition-colors ${
                        isFlagged ? "bg-orange-50" : ""
                      }`}
                    >
                      <span className="text-[#B9B5D4] font-mono text-xs shrink-0 pt-0.5">
                        {formatTime(s.start)}
                      </span>
                      <span className="text-[#2A2640] flex-1">{s.text}</span>
                      <span className="text-[#B9B5D4] text-xs shrink-0 uppercase font-mono">
                        {langName(s.language)}
                      </span>
                      <button
                        onClick={() => toggleSegmentFlag(s.id)}
                        title={isFlagged ? "Remove flag" : "Flag this line"}
                        className={`shrink-0 text-xs rounded px-1.5 py-0.5 border transition-colors ${
                          isFlagged
                            ? "border-orange-400 text-orange-500"
                            : "border-[#E4E1F5] text-[#B9B5D4] hover:border-orange-400 hover:text-orange-500"
                        }`}
                      >
                        ⚑
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border border-[#E4E1F5] rounded-2xl p-6 bg-white flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6D5FE8]">
                Notes
              </h2>

              <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pr-1">
                {comments.length ? (
                  comments.map((c) => (
                    <div
                      key={c.id}
                      className={`text-sm rounded-lg px-3 py-2 border ${
                        c.flagged
                          ? "border-orange-300 bg-orange-50"
                          : "border-[#EFEDFA] bg-[#FAF9FE]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-[#6D5FE8]">{c.author}</span>
                        {c.flagged && <span className="text-xs text-orange-500">⚑ flagged</span>}
                      </div>
                      <p className="text-[#2A2640]">{c.text}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-[#9490AD] text-sm">
                    No notes yet — add one below while you review the transcript.
                  </p>
                )}
              </div>

              <div className="mt-auto pt-2 border-t border-[#EFEDFA]">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Write a note about this meeting..."
                  rows={3}
                  className="w-full resize-none bg-[#FAF9FE] border border-[#E4E1F5] rounded-lg px-3 py-2 text-sm text-[#1E1B2E] focus:outline-none focus:border-[#6D5FE8] transition-colors"
                />
                <button
                  onClick={startSaveNote}
                  disabled={!noteDraft.trim()}
                  className="mt-2 text-sm font-semibold bg-[#6D5FE8] text-white rounded-lg px-4 py-2 hover:bg-[#5A4CD6] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save note
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={reset}
            className="self-start text-sm font-semibold text-[#1E1B2E] border border-[#E4E1F5] rounded-lg px-4 py-2 hover:border-[#6D5FE8] transition-colors"
          >
            Upload another meeting
          </button>
        </div>
      )}

      {showDownload && notes && (
        <DownloadModal
          defaultName={fileName.replace(/\.[^/.]+$/, "") || "meeting"}
          onCancel={() => setShowDownload(false)}
          onConfirm={downloadTranscript}
        />
      )}

      {pendingNoteText && (
        <SaveNoteModal
          draft={pendingNoteText}
          onCancel={() => setPendingNoteText(null)}
          onConfirm={confirmSaveNote}
        />
      )}
    </div>
  );
}
