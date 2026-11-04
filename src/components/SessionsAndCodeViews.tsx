import React, { useEffect, useState } from "react";
import { Check, Copy, Download, MessageSquare, Search, Trash2 } from "lucide-react";
import type { PythonSourceFile, SessionSummaryItem } from "../types";

interface SessionHistoryViewProps {
  sessions: SessionSummaryItem[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

const CHANNEL_LABELS: Record<string, string> = {
  all: "الكل",
  widget: "الموقع / الاختبار",
  whatsapp: "واتساب",
  messenger: "ماسنجر",
};

export const SessionHistoryView: React.FC<SessionHistoryViewProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
}) => {
  const [channelFilter, setChannelFilter] = useState<"all" | "widget" | "whatsapp" | "messenger">(
    "all"
  );
  const [search, setSearch] = useState("");

  const filtered = sessions.filter((s) => {
    if (channelFilter !== "all" && s.channel !== channelFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.session_id.toLowerCase().includes(q) ||
      s.profile_name.toLowerCase().includes(q) ||
      s.farm_context.farm_name.toLowerCase().includes(q) ||
      s.farm_context.primary_crops.toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full overflow-y-auto bg-[#FAF9F6] p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E5E0] pb-5">
        <div>
          <h2 className="text-base font-semibold text-[#18181B]">
            سجل جلسات الاختبار ومحادثات المزارعين المحفوظة
          </h2>
          <p className="mt-0.5 text-xs text-[#57534E]">
            كل جلسة تحتفظ بتاريخ المحادثة وبيانات المزرعة الأورجانيك (المساحة بالفدان والمحاصيل)
            عبر الموقع وواتساب وماسنجر.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-2.5 h-3.5 w-3.5 text-[#78716C]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث باسم الجلسة أو المحصول..."
              className="rounded-lg border border-[#E5E5E0] bg-white ps-8 pe-3 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-[#EFECE6] p-1">
            {(["all", "widget", "whatsapp", "messenger"] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  channelFilter === ch
                    ? "bg-white text-[#18181B] shadow-xs"
                    : "text-[#57534E] hover:text-[#18181B]"
                }`}
              >
                {CHANNEL_LABELS[ch]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E5E0] bg-white overflow-x-auto">
        <table className="w-full text-start border-collapse">
          <thead>
            <tr className="border-b border-[#E5E5E0] text-xs font-medium text-[#57534E]">
              <th className="py-3 ps-5 pe-4 text-start">معرف الجلسة والمستخدم</th>
              <th className="py-3 px-4 text-start">القناة</th>
              <th className="py-3 px-4 text-start">ملخص بيانات الأرض الأورجانيك</th>
              <th className="py-3 px-4 text-end">الرسائل</th>
              <th className="py-3 px-4 text-end">آخر تحديث</th>
              <th className="py-3 ps-4 pe-5 text-end">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EEE9] text-xs">
            {filtered.map((s) => (
              <tr
                key={s.session_id}
                className={s.session_id === activeSessionId ? "bg-[#FAF9F6]" : "hover:bg-[#FAF9F6]"}
              >
                <td className="py-3.5 ps-5 pe-4">
                  <div className="font-mono font-medium text-[#18181B]" dir="ltr">
                    {s.session_id}
                  </div>
                  <div className="text-[#57534E]">{s.profile_name}</div>
                </td>
                <td className="py-3.5 px-4 text-[#44403C]">
                  {CHANNEL_LABELS[s.channel] || s.channel}
                </td>
                <td className="py-3.5 px-4 text-[#57534E] tabular-nums">
                  {s.farm_context.farm_name} · {s.farm_context.farm_size_ha} فدان · pH{" "}
                  {s.farm_context.soil_ph} · {s.farm_context.primary_crops}
                </td>
                <td className="py-3.5 px-4 text-end font-mono tabular-nums text-[#18181B]">
                  {s.message_count}
                </td>
                <td
                  className="py-3.5 px-4 text-end font-mono tabular-nums text-[#57534E]"
                  dir="ltr"
                >
                  {s.updated_at.slice(0, 16).replace("T", " ")}
                </td>
                <td className="py-3.5 ps-4 pe-5 text-end whitespace-nowrap">
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectSession(s.session_id)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#E5E5E0] bg-white px-2.5 py-1 text-xs font-medium text-[#18181B] hover:border-[#166534] whitespace-nowrap shrink-0"
                    >
                      <MessageSquare className="h-3 w-3" />
                      <span>فتح المحادثة</span>
                    </button>
                    {sessions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteSession(s.session_id)}
                        className="rounded-md p-1.5 text-[#78716C] hover:text-[#B91C1C]"
                        title="حذف الجلسة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const PythonSourceView: React.FC = () => {
  const [files, setFiles] = useState<PythonSourceFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("python_backend/main.py");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/python-source")
      .then((r) => r.json())
      .then((d) => {
        const list = d.files || [];
        setFiles(list);
        if (list.length > 0 && !list.some((f: PythonSourceFile) => f.path === selectedPath)) {
          setSelectedPath(list[0].path);
        }
      })
      .catch(() => {});
  }, []);

  const currentFile = files.find((f) => f.path === selectedPath) || files[0];

  const handleCopy = () => {
    if (!currentFile) return;
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FAF9F6] p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#18181B]">
            الكود الكامل لنسخة Python FastAPI + ChromaDB + Google Sheets
          </h2>
          <p className="mt-0.5 text-xs text-[#57534E]">
            نسخة Python المتكاملة شاملة `google_sheets_connector.py` وقواعد الأورجانيك 100% جاهزة
            للتحميل والتشغيل على سيرفرك أو Cloud Run في أي وقت.
          </p>
        </div>
        <a
          href="/api/python-bundle.zip"
          download="agripulse-organic-python-fastapi.zip"
          className="inline-flex items-center gap-2 rounded-lg bg-[#166534] px-4 py-2 text-xs font-medium text-white hover:bg-[#14532D] transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          <span>تحميل حزمة Python كاملة (.zip)</span>
        </a>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E5E5E0] bg-white lg:flex-row"
        dir="ltr"
      >
        {/* File List */}
        <div className="w-full border-b border-[#E5E5E0] bg-[#FAF9F6] p-3 lg:w-64 lg:border-b-0 lg:border-r overflow-y-auto shrink-0 space-y-1">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setSelectedPath(f.path)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left font-mono text-xs transition-colors ${
                currentFile?.path === f.path
                  ? "bg-white font-semibold text-[#166534] border border-[#E5E5E0]"
                  : "text-[#44403C] hover:bg-[#EFECE6]"
              }`}
            >
              <span className="truncate">{f.path.replace("python_backend/", "")}</span>
              <span className="text-[10px] text-[#78716C] tabular-nums ml-2 shrink-0">
                {(f.size_bytes / 1024).toFixed(1)}K
              </span>
            </button>
          ))}
        </div>

        {/* Code Viewer */}
        <div className="flex min-h-0 flex-1 flex-col bg-[#18181B]">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-xs font-mono text-zinc-300">
            <span>{currentFile?.path}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700 whitespace-nowrap shrink-0"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? "تم النسخ" : "نسخ الملف"}</span>
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-5 font-mono text-xs leading-relaxed text-zinc-100">
            {currentFile?.content || "جاري تحميل ملفات Python..."}
          </pre>
        </div>
      </div>
    </div>
  );
};
