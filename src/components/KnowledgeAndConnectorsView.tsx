import React, { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  CheckCircle2,
  CloudRain,
  Database,
  FileSpreadsheet,
  LogOut,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { getAccessToken, googleSignIn, initAuth, logout } from "../services/googleAuth";
import type { ConnectedGoogleSheet, KnowledgeOverview, RetrievedCitation } from "../types";

const EGYPT_ORGANIC_STATIONS = [
  { label: "البحيرة / النوبارية (مزارع التصدير الأورجانيك)", lat: 30.6667, lon: 30.0667 },
  { label: "الفيوم (الأعشاب الطبية والعطرية الأورجانيك)", lat: 29.3084, lon: 30.8428 },
  { label: "كفر الشيخ / الدلتا (القمح والخضر العضوية)", lat: 31.1107, lon: 30.9388 },
  { label: "المنيا / غرب المنيا (البطاطس والنباتات الطبية)", lat: 28.1099, lon: 30.7503 },
  { label: "الواحات البحرية / الوادي الجديد (أرض بكر خالية من الكيماوي)", lat: 28.3492, lon: 28.8659 },
];

interface KnowledgeAndConnectorsViewProps {
  knowledge: KnowledgeOverview | null;
  onRefreshKnowledge: () => Promise<void>;
}

export const KnowledgeAndConnectorsView: React.FC<KnowledgeAndConnectorsViewProps> = ({
  knowledge,
  onRefreshKnowledge,
}) => {
  // Google Workspace Auth State (strictly in-memory token via googleAuth.ts)
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  // Google Sheets Sync State
  const [connectedSheets, setConnectedSheets] = useState<ConnectedGoogleSheet[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string>("");
  const [activeTabIdx, setActiveTabIdx] = useState<number>(0);
  const [sheetUrlInput, setSheetUrlInput] = useState("");
  const [sheetCustomTitle, setSheetCustomTitle] = useState("");
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [sheetStatusMsg, setSheetStatusMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Live Ag-Weather & Organic Connectors State
  const [selectedStationIdx, setSelectedStationIdx] = useState(0);
  const [customLat, setCustomLat] = useState("30.6667");
  const [customLon, setCustomLon] = useState("30.0667");
  const [customLabel, setCustomLabel] = useState("البحيرة / النوبارية (مزارع التصدير الأورجانيك)");
  const [syncingConnectors, setSyncingConnectors] = useState(false);
  const [connectorReport, setConnectorReport] = useState<
    Array<{ connector: string; status: string; summary: string; chunks_upserted: number }>
  >([]);

  // File Upload State
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ChromaDB Vector Search Tester State
  const [searchQuery, setSearchQuery] = useState(
    "برنامج تسميد الطماطم الأورجانيك ومكافحة دودة التوتا بدون كيماوي"
  );
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RetrievedCitation[]>([]);

  const loadConnectedSheets = useCallback(async () => {
    try {
      const res = await fetch("/api/google-sheets/connected");
      const data = await res.json();
      const list: ConnectedGoogleSheet[] = data.sheets || [];
      setConnectedSheets(list);
      if (list.length > 0) {
        setSelectedSheetId((prev) => prev || list[0].spreadsheet_id);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    const unsub = initAuth(
      (user) => {
        setGoogleUser(user);
        setHasToken(true);
      },
      () => {
        setGoogleUser(null);
        setHasToken(false);
      }
    );
    loadConnectedSheets();
    return () => unsub();
  }, [loadConnectedSheets]);

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setSheetStatusMsg(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setGoogleUser(res.user);
        setHasToken(true);
        setSheetStatusMsg({
          type: "success",
          text: `تم تسجيل الدخول بحساب (${res.user.email || res.user.displayName}) بنجاح. الصق رابط ملف Google Sheet الخاص بك واضغط سحب البيانات.`,
        });
      }
    } catch (err) {
      setSheetStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "تعذر إتمام تسجيل الدخول بحساب Google",
      });
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setGoogleUser(null);
    setHasToken(false);
  };

  const handleSyncGoogleSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrlInput.trim() || syncingSheet) return;
    setSyncingSheet(true);
    setSheetStatusMsg(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch("/api/google-sheets/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({
          spreadsheet_url: sheetUrlInput.trim(),
          custom_title: sheetCustomTitle.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل سحب بيانات الشيت");
      }

      const synced: ConnectedGoogleSheet = data.sheet;
      setSheetStatusMsg({
        type: "success",
        text: `تم سحب وفهرسة شيت «${synced.title}» بنجاح (${synced.rows_indexed} صف في ${synced.tabs.length} تبويب). تقدر تختبر الشات دلوقتي بأسئلة من بيانات الشيت!`,
      });
      setSheetUrlInput("");
      setSheetCustomTitle("");
      await loadConnectedSheets();
      setSelectedSheetId(synced.spreadsheet_id);
      setActiveTabIdx(0);
      await onRefreshKnowledge();
    } catch (err) {
      setSheetStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "حدث خطأ أثناء الاتصال بـ Google Sheets",
      });
    } finally {
      setSyncingSheet(false);
    }
  };

  const handleStationSelect = (idx: number) => {
    setSelectedStationIdx(idx);
    const st = EGYPT_ORGANIC_STATIONS[idx];
    if (st) {
      setCustomLat(String(st.lat));
      setCustomLon(String(st.lon));
      setCustomLabel(st.label);
    }
  };

  const handleSyncExternal = async () => {
    setSyncingConnectors(true);
    try {
      const res = await fetch("/api/connectors/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: Number(customLat),
          longitude: Number(customLon),
          region_label: customLabel,
          sources: ["open_meteo", "soilgrids", "organic_inputs_market"],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل تحديث البيانات الحية");
      setConnectorReport(data.connectors || []);
      await onRefreshKnowledge();
    } catch (err) {
      setUploadNotice(err instanceof Error ? err.message : "تعذر تحديث مصادر الطقس والتربة");
    } finally {
      setSyncingConnectors(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadNotice(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const contentBase64 = btoa(binary);
      const res = await fetch("/api/knowledge/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل رفع الملف");
      setUploadNotice(
        `تمت فهرسة الملف «${data.filename}» داخل قاعدة المعرفة الأورجانيك (${data.chunks} فقرة نشطة).`
      );
      await onRefreshKnowledge();
    } catch (err) {
      setUploadNotice(err instanceof Error ? err.message : "فشل رفع الملف");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleVectorSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, top_k: 5 }),
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } finally {
      setSearching(false);
    }
  };

  const docs = knowledge?.documents || [];
  const activeSheet =
    connectedSheets.find((s) => s.spreadsheet_id === selectedSheetId) || connectedSheets[0] || null;
  const activeSheetTab = activeSheet?.tabs[activeTabIdx] || activeSheet?.tabs[0] || null;

  return (
    <div className="h-full overflow-y-auto bg-[#FAF9F6] p-6 space-y-8">
      {/* Header Metrics Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 border-b border-[#E5E5E0] pb-6">
        <div>
          <div className="text-xs text-[#57534E]">ملفات Google Sheets المتصلة</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#166534] tabular-nums">
            {connectedSheets.length}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#57534E]">إجمالي الصفوف والفقرات المفهرسة</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#18181B] tabular-nums">
            {knowledge?.total_chunks ?? 0}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#57534E]">نموذج التضمين (Embeddings)</div>
          <div className="mt-1 font-mono text-sm font-medium text-[#18181B] tabular-nums" dir="ltr">
            {knowledge?.embedding_model || "gemini-embedding-2-preview"}
            {knowledge?.embedding_dimension ? ` (${knowledge.embedding_dimension}d)` : ""}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#57534E]">إجمالي مصادر البيانات الأورجانيك</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#18181B] tabular-nums">
            {docs.length}
          </div>
        </div>
      </div>

      {/* Section 01: Primary Google Sheets Connector + Official Sign in with Google */}
      <section className="rounded-xl border border-[#E5E5E0] bg-white p-6 space-y-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="max-w-2xl space-y-1">
            <h2 className="text-base font-semibold text-[#18181B]">
              01. ربط ومزامنة ملف Google Sheets للزراعة الأورجانيك (المصدر الأساسي)
            </h2>
            <p className="text-xs text-[#57534E] leading-relaxed">
              تقدر تختبر البرنامج فوراً بالشيت التجريبي المحمّل مسبقاً، أو تلصق رابط أي ملف Google
              Sheet مفتوح للعرض («أي شخص لديه الرابط»)، أو تسجل الدخول بحساب Google لقراءة ملفاتك
              الخاصة مباشرة بإذن قراءة فقط (`spreadsheets.readonly`).
            </p>
          </div>

          {/* Official Google Sign-In Button or Connected Account Controls */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!hasToken ? (
              <button
                type="button"
                disabled={signingIn}
                onClick={handleGoogleLogin}
                className="gsi-material-button"
                dir="ltr"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: "block" }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {signingIn ? "Connecting..." : "Sign in with Google"}
                  </span>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-2.5 text-xs">
                <span className="text-[#166534] font-medium">
                  متصل بحساب: {googleUser?.email || googleUser?.displayName || "Google"}
                </span>
                <button
                  type="button"
                  onClick={handleGoogleLogout}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-2.5 py-1.5 text-xs font-medium text-[#57534E] hover:text-[#18181B] whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>خروج</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Paste Google Sheet URL Form */}
        <form onSubmit={handleSyncGoogleSheet} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-6">
            <label className="block text-xs font-medium text-[#44403C]">
              رابط ملف Google Sheets أو الـ Spreadsheet ID
            </label>
            <input
              type="text"
              dir="ltr"
              value={sheetUrlInput}
              onChange={(e) => setSheetUrlInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
              className="mt-1 w-full rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] px-3.5 py-2 text-xs font-mono text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-[#44403C]">
              اسم توضيحي للشيت (اختياري)
            </label>
            <input
              type="text"
              value={sheetCustomTitle}
              onChange={(e) => setSheetCustomTitle(e.target.value)}
              placeholder="مثلاً: شيت برامج مزرعتي الأورجانيك"
              className="mt-1 w-full rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] px-3 py-2 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
            />
          </div>
          <div className="md:col-span-3 flex items-end">
            <button
              type="submit"
              disabled={syncingSheet || !sheetUrlInput.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#166534] px-4 py-2 text-xs font-medium text-white hover:bg-[#14532D] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>{syncingSheet ? "جاري سحب وفهرسة الشيت..." : "سحب وتحديث بيانات الشيت"}</span>
            </button>
          </div>
        </form>

        {sheetStatusMsg && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
              sheetStatusMsg.type === "success"
                ? "border-[#166534]/30 bg-[#FAF9F6] text-[#166534]"
                : "border-[#DC2626]/30 bg-[#FEF2F2] text-[#991B1B]"
            }`}
          >
            {sheetStatusMsg.type === "success" && (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span>{sheetStatusMsg.text}</span>
          </div>
        )}

        {/* Live Synced Google Sheet Tabs & Rows Preview */}
        {activeSheet && (
          <div className="border-t border-[#E5E5E0] pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[#18181B]">معاينة الشيت النشط حالياً:</span>
                {connectedSheets.length > 1 ? (
                  <select
                    value={activeSheet.spreadsheet_id}
                    onChange={(e) => {
                      setSelectedSheetId(e.target.value);
                      setActiveTabIdx(0);
                    }}
                    className="rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-2.5 py-1 text-xs text-[#18181B]"
                  >
                    {connectedSheets.map((s) => (
                      <option key={s.spreadsheet_id} value={s.spreadsheet_id}>
                        {s.title} ({s.rows_indexed} صف)
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-medium text-[#166534]">{activeSheet.title}</span>
                )}
                <span className="text-[#57534E]" aria-hidden="true">
                  ·
                </span>
                <span className="text-[#57534E] tabular-nums">
                  {activeSheet.rows_indexed} صف مفهرس في ChromaDB
                </span>
              </div>

              {/* Sheet Tabs Segmented Control */}
              <div className="flex items-center gap-1 rounded-lg bg-[#EFECE6] p-1 overflow-x-auto">
                {activeSheet.tabs.map((tab, idx) => (
                  <button
                    key={tab.sheet_name}
                    type="button"
                    onClick={() => setActiveTabIdx(idx)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activeTabIdx === idx
                        ? "bg-white text-[#18181B] shadow-xs"
                        : "text-[#57534E] hover:text-[#18181B]"
                    }`}
                  >
                    {tab.sheet_name} ({tab.row_count})
                  </button>
                ))}
              </div>
            </div>

            {activeSheetTab && activeSheetTab.sample_rows.length > 0 && (
              <div className="overflow-x-auto border-t border-[#F0EEE9] pt-2">
                <table className="w-full text-start border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E5E5E0] text-[#57534E] font-medium">
                      {activeSheetTab.columns.map((col) => (
                        <th key={col} className="py-2 px-3 text-start whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EEE9]">
                    {activeSheetTab.sample_rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#FAF9F6] align-top">
                        {activeSheetTab.columns.map((col) => (
                          <td key={col} className="py-2.5 px-3 text-[#18181B] leading-relaxed">
                            {row[col] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 02: Live Egyptian Weather & Organic Soil Microbiome APIs */}
      <section className="rounded-xl border border-[#E5E5E0] bg-white p-6 space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-[#18181B]">
              02. ربط الطقس الزراعي الحي ومواعيد الرش الحيوي (Open-Meteo + التربة الأورجانيك)
            </h2>
            <p className="mt-1 text-xs text-[#57534E] leading-relaxed">
              يسحب درجات الحرارة وسرعة الرياح والبخر-نتح لمدة 7 أيام لتحديد أنسب توقيت لرش الكائنات
              الحية الدقيقة (باسيلس، ترايكوديرما، زيت النيم) قبل الغروب وحساب مقنن الري للفدان.
            </p>
          </div>
          <button
            type="button"
            disabled={syncingConnectors}
            onClick={handleSyncExternal}
            className="inline-flex items-center gap-2 rounded-lg bg-[#18181B] px-4 py-2 text-xs font-medium text-white hover:bg-[#27272A] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <CloudRain className="h-4 w-4" />
            <span>
              {syncingConnectors ? "جاري التحديث..." : "تحديث طقس المزرعة وأسعار المدخلات العضوية"}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-[#44403C]">
              اختر منطقة زراعية مصرية
            </label>
            <select
              value={selectedStationIdx}
              onChange={(e) => handleStationSelect(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-2 text-xs text-[#18181B]"
            >
              {EGYPT_ORGANIC_STATIONS.map((st, idx) => (
                <option key={st.label} value={idx}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#44403C]">خط العرض (Lat)</label>
            <input
              type="text"
              dir="ltr"
              value={customLat}
              onChange={(e) => setCustomLat(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-2 text-xs font-mono tabular-nums text-[#18181B]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#44403C]">خط الطول (Lon)</label>
            <input
              type="text"
              dir="ltr"
              value={customLon}
              onChange={(e) => setCustomLon(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-2 text-xs font-mono tabular-nums text-[#18181B]"
            />
          </div>
        </div>

        {connectorReport.length > 0 && (
          <div className="divide-y divide-[#E5E5E0] border-t border-[#E5E5E0] pt-3">
            {connectorReport.map((item) => (
              <div key={item.connector} className="py-3 flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#18181B]">{item.connector}</span>
                  <span className="font-mono text-[#166534] tabular-nums">
                    {item.status} · {item.chunks_upserted} فقرة محدّثة
                  </span>
                </div>
                <p className="text-xs text-[#57534E] tabular-nums leading-relaxed">
                  {item.summary}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 03: Indexed ChromaDB Sources & Optional File Upload */}
      <section className="rounded-xl border border-[#E5E5E0] bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#18181B]">
              03. سجل جميع المصادر النشطة في ChromaDB (شيتات جوجل + أدلة الأورجانيك)
            </h2>
            <p className="mt-0.5 text-xs text-[#57534E]">
              يمكنك أيضاً رفع ملفات إضافية (.xlsx, .csv, .pdf, .json) خاصة ببرامج الزراعة العضوية
              فقط.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf,.json,.txt,.md"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3.5 py-2 text-xs font-medium text-[#18181B] hover:bg-[#EFECE6] transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{uploading ? "جاري الفهرسة..." : "رفع ملف إضافي (Excel / PDF / CSV)"}</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                await loadConnectedSheets();
                await onRefreshKnowledge();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-white px-3 py-2 text-xs font-medium text-[#57534E] hover:text-[#18181B] whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {uploadNotice && (
          <div className="rounded-lg bg-[#FAF9F6] border border-[#E5E5E0] px-3.5 py-2.5 text-xs text-[#18181B]">
            {uploadNotice}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="border-b border-[#E5E5E0] text-xs font-medium text-[#57534E]">
                <th className="py-2.5 pe-4 text-start">المصدر / اسم الشيت</th>
                <th className="py-2.5 px-4 text-start">النوع</th>
                <th className="py-2.5 px-4 text-start">أمثلة التبويبات والصفوف</th>
                <th className="py-2.5 px-4 text-end">عدد الفقرات</th>
                <th className="py-2.5 ps-4 text-end">الحجم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9] text-xs">
              {docs.map((doc) => (
                <tr key={doc.source} className="hover:bg-[#FAF9F6]">
                  <td className="py-3 pe-4 font-medium text-[#18181B]">
                    <div className="flex items-center gap-2">
                      {doc.source_type === "google_sheet" ? (
                        <FileSpreadsheet className="h-3.5 w-3.5 text-[#166534] shrink-0" />
                      ) : (
                        <Database className="h-3.5 w-3.5 text-[#57534E] shrink-0" />
                      )}
                      <span>{doc.source}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-[#57534E] whitespace-nowrap" dir="ltr">
                    {doc.format} · {doc.source_type}
                  </td>
                  <td className="py-3 px-4 text-[#57534E] max-w-md truncate">
                    {doc.sample_sections.join(" · ")}
                  </td>
                  <td className="py-3 px-4 text-end font-mono tabular-nums text-[#18181B]">
                    {doc.chunk_count}
                  </td>
                  <td
                    className="py-3 ps-4 text-end font-mono tabular-nums text-[#57534E]"
                    dir="ltr"
                  >
                    {(doc.size_bytes / 1024).toFixed(1)} KB
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 04: Live ChromaDB Retrieval Inspector */}
      <section className="rounded-xl border border-[#E5E5E0] bg-white p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[#18181B]">
            04. اختبار الاسترجاع الدلالي المباشر من Google Sheets وChromaDB
          </h2>
          <p className="mt-0.5 text-xs text-[#57534E]">
            اختبر الفقرات والصفوف التي يستخرجها محرك البحث المتجهي قبل إرسالها إلى Gemini 2.5
            Flash.
          </p>
        </div>

        <form onSubmit={handleVectorSearch} className="flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="اكتب جملة بحث لاختبار استرجاع صفوف الشيت..."
            className="flex-1 rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] px-3.5 py-2 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-2 rounded-lg bg-[#18181B] px-4 py-2 text-xs font-medium text-white hover:bg-[#27272A] whitespace-nowrap shrink-0"
          >
            <Search className="h-3.5 w-3.5" />
            <span>{searching ? "جاري البحث..." : "اختبار الاسترجاع"}</span>
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className="divide-y divide-[#E5E5E0] border-t border-[#E5E5E0] pt-2">
            {searchResults.map((res, idx) => (
              <div key={res.id} className="py-3.5 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#57534E]">
                  <span>
                    النتيجة #{idx + 1} · {res.source} · {res.section}
                  </span>
                  <span className="font-semibold text-[#166534]" dir="ltr">
                    Similarity {res.similarity.toFixed(4)} · {res.format}
                  </span>
                </div>
                <p className="text-xs text-[#18181B] leading-relaxed">{res.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
