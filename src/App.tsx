import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  CornerUpLeft,
  Database,
  Download,
  FileSpreadsheet,
  Globe,
  Home,
  List,
  Link2,
  LogOut,
  MessageCircle,
  RotateCcw,
  Search,
  Send,
  Sprout,
  X,
} from "lucide-react";
import { getAccessToken, googleSignIn, initAuth, logout } from "./services/googleAuth";
import type {
  ChatMessageRecord,
  ConnectedGoogleSheet,
  FlowUiMode,
  GovernorateItem,
  MemberRegistrationRecord,
  PlantDatabaseItem,
  SessionFlowState,
} from "./types";

type ChannelMode = "whatsapp" | "messenger" | "widget";

const MAIN_STARTER_LABELS: string[] = [
  "تسجيل في الجمعية",
  "ما هي الجمعية؟",
  "هل توجد مشكلة في محصول؟",
  "ترشيح أنسب محصول لأرضي",
  "دليل زراعة محصول كامل",
  "أخرى (سؤال آخر)",
];

const OPENING_GREETING =
  "أهلاً وسهلاً بيك في الجمعية المصرية للزراعة الحيوية، نقدر نساعدك إزاي؟";

const CHANNELS: Array<{
  id: ChannelMode;
  label: string;
  sessionId: string;
  accentBg: string;
  accentHover: string;
  userBubbleBg: string;
  userBubbleText: string;
  canvasBg: string;
  placeholder: string;
}> = [
  {
    id: "whatsapp",
    label: "واتساب (WhatsApp)",
    sessionId: "whatsapp:live-test",
    accentBg: "bg-[#008069]",
    accentHover: "hover:bg-[#016B58]",
    userBubbleBg: "bg-[#D9FDD3] border border-[#C1E8BA]",
    userBubbleText: "text-[#111B21]",
    canvasBg: "bg-[#EFEAE2]",
    placeholder: "اكتب رسالتك على واتساب أو اختر من الأزرار...",
  },
  {
    id: "messenger",
    label: "فيسبوك (Facebook)",
    sessionId: "messenger:live-test",
    accentBg: "bg-[#1D4ED8]",
    accentHover: "hover:bg-[#1E40AF]",
    userBubbleBg: "bg-[#1D4ED8]",
    userBubbleText: "text-white",
    canvasBg: "bg-[#F4F6FB]",
    placeholder: "اكتب رسالتك على ماسنجر أو اختر من الاختيارات...",
  },
  {
    id: "widget",
    label: "الموقع (Web)",
    sessionId: "widget:live-test",
    accentBg: "bg-[#166534]",
    accentHover: "hover:bg-[#14532D]",
    userBubbleBg: "bg-[#166534]",
    userBubbleText: "text-white",
    canvasBg: "bg-[#FAF9F6]",
    placeholder: "اكتب رسالتك هنا أو اختر من الاختيارات...",
  },
];

export default function App() {
  const [channel, setChannel] = useState<ChannelMode>("whatsapp");
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<ChannelMode, ChatMessageRecord[]>
  >({
    whatsapp: [],
    messenger: [],
    widget: [],
  });
  const [flowByChannel, setFlowByChannel] = useState<
    Record<ChannelMode, SessionFlowState | undefined>
  >({
    whatsapp: { mode: "idle" },
    messenger: { mode: "idle" },
    widget: { mode: "idle" },
  });
  const [waListExpanded, setWaListExpanded] = useState(true);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Plants Database, Official 27 Governorates & Registrations
  const [plantsDb, setPlantsDb] = useState<PlantDatabaseItem[]>([]);
  const [plantCategories, setPlantCategories] = useState<string[]>([]);
  const [governoratesDb, setGovernoratesDb] = useState<GovernorateItem[]>([]);
  const [registrations, setRegistrations] = useState<MemberRegistrationRecord[]>([]);

  // Admin Modals: "plants" | "registrations" | "sheets" | "links" | null
  const [activeModal, setActiveModal] = useState<
    "plants" | "registrations" | "sheets" | "links" | null
  >(null);
  const [modalPlantSearch, setModalPlantSearch] = useState("");
  const [modalPlantCategory, setModalPlantCategory] = useState("الكل");
  const [inspectedPlant, setInspectedPlant] = useState<PlantDatabaseItem | null>(null);

  // Admin Registration Inspection Filters
  const [regSearch, setRegSearch] = useState("");
  const [regGovFilter, setRegGovFilter] = useState("الكل");

  // Google Sheets OAuth & Sync State
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [connectedSheets, setConnectedSheets] = useState<ConnectedGoogleSheet[]>([]);
  const [sheetUrlInput, setSheetUrlInput] = useState("");
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [sheetNotice, setSheetNotice] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentChannelCfg = CHANNELS.find((c) => c.id === channel) || CHANNELS[0];

  const loadSession = useCallback(async (ch: ChannelMode, sid: string) => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (data.session) {
        setMessagesByChannel((prev) => ({
          ...prev,
          [ch]: Array.isArray(data.session.messages) ? data.session.messages : [],
        }));
        setFlowByChannel((prev) => ({
          ...prev,
          [ch]: data.session.flow_state || { mode: "idle" },
        }));
      }
    } catch {
      // ignore
    }
  }, []);

  const loadPlantsDb = useCallback(async () => {
    try {
      const res = await fetch("/api/plants-db");
      const data = await res.json();
      if (Array.isArray(data.plants)) {
        setPlantsDb(data.plants);
        setPlantCategories(data.categories || []);
        if (data.plants.length > 0) {
          setInspectedPlant(data.plants[0]);
        }
      }
      if (Array.isArray(data.governorates)) {
        setGovernoratesDb(data.governorates);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadRegistrations = useCallback(async () => {
    try {
      const res = await fetch("/api/registrations");
      const data = await res.json();
      if (Array.isArray(data.registrations)) {
        setRegistrations(data.registrations);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadConnectedSheets = useCallback(async () => {
    try {
      const res = await fetch("/api/google-sheets/connected");
      const data = await res.json();
      setConnectedSheets(data.sheets || []);
    } catch {
      // ignore
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
    loadPlantsDb();
    loadRegistrations();
    loadConnectedSheets();
    return () => unsub();
  }, [loadPlantsDb, loadRegistrations, loadConnectedSheets]);

  useEffect(() => {
    setErrorMsg(null);
    setWaListExpanded(true);
    loadSession(channel, currentChannelCfg.sessionId);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [channel, currentChannelCfg.sessionId, loadSession]);

  const currentMessages = messagesByChannel[channel] || [];
  const activeFlow = flowByChannel[channel] || { mode: "idle" };

  const lastAssistantMsg = useMemo(() => {
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      if (currentMessages[i].role === "assistant") return currentMessages[i];
    }
    return null;
  }, [currentMessages]);

  // Active choices ALWAYS available right from turn 0 through every journey step
  const activeChoices: string[] = useMemo(() => {
    if (currentMessages.length === 0) {
      return MAIN_STARTER_LABELS;
    }
    if (lastAssistantMsg?.quick_replies && lastAssistantMsg.quick_replies.length > 0) {
      return lastAssistantMsg.quick_replies;
    }
    return MAIN_STARTER_LABELS;
  }, [currentMessages.length, lastAssistantMsg]);

  const isWhatsAppThreeButtons = useMemo(() => {
    return activeChoices.length > 0 && activeChoices.length <= 3 && activeChoices.every((c) => c.length <= 22);
  }, [activeChoices]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages.length, sending, channel, waListExpanded]);

  const filteredModalPlants = useMemo(() => {
    const q = modalPlantSearch.trim().toLowerCase();
    return plantsDb.filter((p) => {
      const catOk = modalPlantCategory === "الكل" || p.category === modalPlantCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.raw_name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [plantsDb, modalPlantCategory, modalPlantSearch]);

  const filteredRegistrations = useMemo(() => {
    const q = regSearch.trim().toLowerCase();
    return registrations.filter((r) => {
      const govName = r.governorate || r.location;
      const govOk = regGovFilter === "الكل" || govName === regGovFilter;
      if (!govOk) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        govName.toLowerCase().includes(q) ||
        r.registration_id.toLowerCase().includes(q) ||
        r.crops.toLowerCase().includes(q)
      );
    });
  }, [registrations, regGovFilter, regSearch]);

  const registeredGovOptions = useMemo(() => {
    const fromRegs = Array.from(
      new Set(registrations.map((r) => r.governorate).filter(Boolean))
    );
    return fromRegs.length > 0
      ? fromRegs
      : governoratesDb.map((g) => g.name);
  }, [registrations, governoratesDb]);

  const sendLiveMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || sending) return;

    const targetChannel = channel;
    const targetSessionId = currentChannelCfg.sessionId;

    setInput("");
    setErrorMsg(null);
    setWaListExpanded(true);

    const optimisticUserMsg: ChatMessageRecord = {
      message_id: `u_${Date.now()}`,
      session_id: targetSessionId,
      role: "user",
      content: text,
      citations: [],
      latency_ms: 0,
      created_at: new Date().toISOString(),
    };

    setMessagesByChannel((prev) => ({
      ...prev,
      [targetChannel]: [...(prev[targetChannel] || []), optimisticUserMsg],
    }));

    setSending(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      let res: Response;

      if (targetChannel === "whatsapp") {
        res = await fetch("/webhooks/whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            object: "whatsapp_business_account",
            entry: [
              {
                id: "WABA_ORGANIC_LIVE",
                changes: [
                  {
                    field: "messages",
                    value: {
                      messaging_product: "whatsapp",
                      contacts: [{ profile: { name: "عضو الجمعية" }, wa_id: "live-test" }],
                      messages: [
                        {
                          from: "live-test",
                          id: `wamid.${Date.now()}`,
                          timestamp: String(Math.floor(Date.now() / 1000)),
                          type: "text",
                          text: { body: text },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          }),
        });
      } else if (targetChannel === "messenger") {
        res = await fetch("/webhooks/messenger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            object: "page",
            entry: [
              {
                id: "PAGE_ORGANIC_LIVE",
                time: Date.now(),
                messaging: [
                  {
                    sender: { id: "live-test" },
                    recipient: { id: "PAGE_ORGANIC_LIVE" },
                    timestamp: Date.now(),
                    message: { mid: `m_${Date.now()}`, text },
                  },
                ],
              },
            ],
          }),
        });
      } else {
        res = await fetch("/webhooks/widget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            session_id: "widget:live-test",
            channel: "widget",
            external_user_id: "live-test",
            profile_name: "عضو الجمعية",
            message: text,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "تعذر الحصول على الرد، حاول مرة أخرى.");
      }

      const payload = data.results?.[0] || data;
      const answerText: string = payload.answer || "لم يتم استلام نص الرد.";
      const replyId: string = payload.message_id || `a_${Date.now()}`;
      const latencyMs: number = payload.latency_ms || 0;
      const quickReplies: string[] = Array.isArray(payload.quick_replies)
        ? payload.quick_replies
        : [];
      const uiMode: FlowUiMode = payload.ui_mode || "default";

      const assistantMsg: ChatMessageRecord = {
        message_id: replyId,
        session_id: targetSessionId,
        role: "assistant",
        content: answerText,
        citations: [],
        latency_ms: latencyMs,
        quick_replies: quickReplies,
        ui_mode: uiMode,
        created_at: new Date().toISOString(),
      };

      setMessagesByChannel((prev) => ({
        ...prev,
        [targetChannel]: [...(prev[targetChannel] || []), assistantMsg],
      }));
      if (payload.flow_state) {
        setFlowByChannel((prev) => ({
          ...prev,
          [targetChannel]: payload.flow_state,
        }));
      }

      if (answerText.includes("تم تأكيد وتسجيل انضمامك")) {
        loadRegistrations();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setErrorMsg("استغرق الرد وقتاً أطول من المعتاد، جرب إرسال الرسالة مرة تانية.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "حصل خطأ في الاتصال");
      }
    } finally {
      clearTimeout(timeoutId);
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendLiveMessage(input);
  };

  const handleClearChat = async () => {
    if (sending) return;
    setMessagesByChannel((prev) => ({ ...prev, [channel]: [] }));
    setFlowByChannel((prev) => ({ ...prev, [channel]: { mode: "idle" } }));
    setErrorMsg(null);
    setWaListExpanded(true);
    await fetch(`/api/sessions/${encodeURIComponent(currentChannelCfg.sessionId)}`, {
      method: "DELETE",
    });
    inputRef.current?.focus();
  };

  const exportRegistrationsCsv = () => {
    if (!registrations.length) return;
    const headers = [
      "رقم العضوية",
      "الاسم الكامل",
      "رقم التليفون (مفحوص 11 رقم)",
      "المحافظة الرسمية",
      "العنوان التفصيلي",
      "المساحة ونظام الري",
      "المحاصيل",
      "الدعم المطلوب",
      "القناة",
      "تاريخ التسجيل",
    ];
    const rows = registrations.map((r) => [
      r.registration_id,
      r.full_name,
      r.phone,
      r.governorate || r.location,
      r.location,
      r.land_and_irrigation,
      r.crops,
      r.support_needed || "",
      r.channel,
      r.created_at,
    ]);
    const csvLines = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csvLines], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `farmer_registrations_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setSheetNotice(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setGoogleUser(res.user);
        setHasToken(true);
        setSheetNotice({
          type: "ok",
          text: `تم تسجيل الدخول (${res.user.email || res.user.displayName}). الصق رابط الشيت واضغط تحديث.`,
        });
      }
    } catch (err) {
      setSheetNotice({
        type: "err",
        text: err instanceof Error ? err.message : "تعذر تسجيل الدخول بحساب Google",
      });
    } finally {
      setSigningIn(false);
    }
  };

  const handleSyncSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrlInput.trim() || syncingSheet) return;
    setSyncingSheet(true);
    setSheetNotice(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/google-sheets/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ spreadsheet_url: sheetUrlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل قراءة الشيت");

      setSheetNotice({
        type: "ok",
        text: `تم ربط شيت «${data.sheet.title}» بنجاح (${data.sheet.rows_indexed} صف).`,
      });
      setSheetUrlInput("");
      await loadConnectedSheets();
    } catch (err) {
      setSheetNotice({
        type: "err",
        text: err instanceof Error ? err.message : "حدث خطأ أثناء سحب الشيت",
      });
    } finally {
      setSyncingSheet(false);
    }
  };

  const copyText = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const origin = window.location.origin;
  const waWebhookUrl = `${origin}/webhooks/whatsapp`;
  const fbWebhookUrl = `${origin}/webhooks/messenger`;
  const webScriptSnippet = `<script src="${origin}/agripulse-widget.js" async></script>`;
  const activeSheet = connectedSheets[0] || null;

  const renderChannelChoices = (choices: string[]) => {
    if (!choices.length || sending) return null;

    // 1. Authentic WhatsApp Interactive Buttons (1..3) or WhatsApp Interactive List (4..10)
    if (channel === "whatsapp") {
      if (isWhatsAppThreeButtons) {
        return (
          <div className="flex justify-end">
            <div className="w-full max-w-md space-y-1.5">
              {choices.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => sendLiveMessage(label)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#D9D9D4] bg-white px-4 py-2.5 text-sm font-semibold text-[#008069] shadow-2xs hover:bg-[#F5FBF9] transition-colors"
                >
                  <CornerUpLeft className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className="flex justify-end">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-[#D9D9D4] bg-white shadow-2xs">
            <button
              type="button"
              onClick={() => setWaListExpanded((prev) => !prev)}
              className="flex w-full items-center justify-center gap-2 border-b border-[#E9EDEF] bg-white px-4 py-2.5 text-sm font-semibold text-[#008069] hover:bg-[#F5FBF9] transition-colors"
            >
              <List className="h-4 w-4 shrink-0" />
              <span>اختر من القائمة ({choices.length})</span>
            </button>

            {waListExpanded && (
              <div className="divide-y divide-[#F0F2F5] bg-white">
                {choices.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => sendLiveMessage(label)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-right text-sm text-[#111B21] hover:bg-[#F5FBF9] transition-colors group"
                  >
                    <span className="font-medium group-hover:text-[#008069]">{label}</span>
                    <span className="h-4 w-4 shrink-0 rounded-full border-2 border-[#8696A0] group-hover:border-[#008069]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // 2. Facebook Messenger Quick Replies
    if (channel === "messenger") {
      return (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {choices.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => sendLiveMessage(label)}
              className="rounded-xl border border-[#1D4ED8]/35 bg-white px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] hover:bg-[#1D4ED8] hover:text-white transition-colors shadow-2xs"
            >
              {label}
            </button>
          ))}
        </div>
      );
    }

    // 3. Website Chat Choices
    return (
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {choices.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => sendLiveMessage(label)}
            className="rounded-xl border border-[#166534]/35 bg-white px-3.5 py-2 text-xs font-semibold text-[#166534] hover:bg-[#166534] hover:text-white transition-colors shadow-2xs"
          >
            {label}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#FAF9F6] text-[#18181B]">
      {/* Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E5E0] bg-white px-4 py-3 sm:px-6 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#166534] text-white">
            <Sprout className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-[#18181B] truncate">
              الجمعية المصرية للزراعة الحيوية
            </h1>
            <p className="text-xs text-[#57534E] truncate">
              إرشاد وتدريب المزارعين · {plantsDb.length || 67} محصول · {governoratesDb.length || 27} محافظة رسمية
            </p>
          </div>
        </div>

        {/* Channel Switcher: WhatsApp · Facebook · Web */}
        <div className="flex items-center gap-1 rounded-lg bg-[#EFECE6] p-1">
          {CHANNELS.map((ch) => {
            const active = channel === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => setChannel(ch.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? "bg-white text-[#18181B] shadow-xs"
                    : "text-[#57534E] hover:text-[#18181B]"
                }`}
              >
                {ch.label}
              </button>
            );
          })}
        </div>

        {/* Admin Inspection & Integration Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleClearChat}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-2.5 py-1.5 text-xs font-medium text-[#57534E] hover:bg-[#EFECE6] hover:text-[#18181B] transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>بداية جديدة</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal("plants")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18181B] hover:border-[#166534] transition-colors whitespace-nowrap shrink-0"
          >
            <Database className="h-3.5 w-3.5 text-[#166534]" />
            <span>قاعدة النباتات ({plantsDb.length || 67})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              loadRegistrations();
              setActiveModal("registrations");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18181B] hover:border-[#166534] transition-colors whitespace-nowrap shrink-0"
          >
            <ClipboardList className="h-3.5 w-3.5 text-[#166534]" />
            <span>فحص التسجيلات ({registrations.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal("sheets")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18181B] hover:border-[#166534] transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-[#166534]" />
            <span>شيت جوجل</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal("links")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#166534] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#14532D] transition-colors whitespace-nowrap shrink-0"
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>روابط الربط</span>
          </button>
        </div>
      </header>

      {/* Main Conversational Stream */}
      <main className={`flex min-h-0 flex-1 flex-col ${currentChannelCfg.canvasBg}`}>
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-2xl space-y-3">
            {/* Opening Message Speaking on Behalf of the Association */}
            <div className="flex justify-end">
              <div className="w-full max-w-md rounded-2xl rounded-tl-sm border border-[#E5E5E0] bg-white px-4 py-3 text-sm text-[#111B21] leading-relaxed shadow-2xs">
                {OPENING_GREETING}
              </div>
            </div>

            {/* Starter Choices Right From Turn 0 */}
            {currentMessages.length === 0 && renderChannelChoices(activeChoices)}

            {/* Back-and-Forth Conversation */}
            {currentMessages.map((msg) => {
              const isUser = msg.role === "user";
              if (isUser) {
                return (
                  <div key={msg.message_id} className="flex justify-start">
                    <div
                      className={`max-w-md rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-2xs ${currentChannelCfg.userBubbleBg} ${currentChannelCfg.userBubbleText}`}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.message_id} className="flex justify-end">
                  <div className="w-full max-w-lg rounded-2xl rounded-tl-sm border border-[#E5E5E0] bg-white px-4 py-3 text-sm text-[#111B21] leading-relaxed shadow-2xs">
                    <div className="prose prose-sm max-w-none text-[#111B21] prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-headings:text-sm prose-headings:font-bold">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Active Journey Buttons / WhatsApp List Below the Latest Assistant Reply */}
            {currentMessages.length > 0 && renderChannelChoices(activeChoices)}

            {sending && (
              <div className="flex justify-end">
                <div className="inline-flex items-center gap-2 rounded-2xl border border-[#E5E5E0] bg-white px-4 py-2.5 text-xs text-[#57534E] shadow-2xs">
                  <span className="h-2 w-2 rounded-full bg-[#166534] animate-pulse" />
                  <span>جاري تجهيز رد الجمعية...</span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
                {errorMsg}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Contextual Format Helper & Message Input Bar */}
        <div className="border-t border-[#E5E5E0] bg-white px-4 py-3 sm:px-6 shrink-0">
          <div className="mx-auto max-w-2xl space-y-2">
            {activeFlow.mode === "register" && activeFlow.step === "ask_phone" && (
              <div className="flex items-center justify-between text-xs text-[#166534]">
                <span>
                  الصيغة المطلوبة لرقم التليفون: 11 رقماً يبدأ بـ 010 أو 011 أو 012 أو 015 (مثال: 01012345678)
                </span>
              </div>
            )}
            {activeFlow.mode === "register" && activeFlow.step === "ask_location" && (
              <div className="flex items-center justify-between text-xs text-[#57534E]">
                <span>
                  اكتب اسم المحافظة مباشرة (يتم مطابقة وتصحيح الأخطاء الإملائية تلقائياً لـ 27 محافظة رسمية) أو اختر من القائمة
                </span>
              </div>
            )}
            {activeFlow.mode === "smart_advisor" && (
              <div className="flex items-center justify-between text-xs text-[#166534]">
                <span>
                  المستشار الزراعي الذكي: اكتب مواصفات أرضك بحرية (نوع التربة، شهر الزراعة، المساحة ونظام الري) ليرشح لك أنسب المحاصيل
                </span>
              </div>
            )}
            {activeFlow.mode === "general_ai" && (
              <div className="flex items-center justify-between text-xs text-[#166534]">
                <span>
                  اسأل عن أي نبات أو موضوع زراعي مفتوح — الإجابات عضوية وحيوية (Organic 100%) ومبسطة
                </span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
              {currentMessages.length > 0 && (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => sendLiveMessage("القائمة الرئيسية")}
                  title="الرجوع للقائمة الرئيسية"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#D6D3CD] bg-[#FAF9F6] px-3 py-3 text-xs font-semibold text-[#18181B] hover:bg-[#EFECE6] transition-colors shrink-0 disabled:opacity-50"
                >
                  <Home className="h-4 w-4 text-[#166534]" />
                  <span className="hidden sm:inline">القائمة الرئيسية</span>
                </button>
              )}

              <input
                ref={inputRef}
                type="text"
                dir={
                  activeFlow.mode === "register" && activeFlow.step === "ask_phone"
                    ? "ltr"
                    : "rtl"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={sending}
                placeholder={
                  activeFlow.mode === "register" && activeFlow.step === "ask_phone"
                    ? "01012345678"
                    : currentChannelCfg.placeholder
                }
                className="flex-1 rounded-xl border border-[#D6D3CD] bg-[#FAF9F6] px-4 py-3 text-sm text-[#18181B] placeholder:text-[#78716C] focus:border-[#166534] focus:bg-white focus:outline-none disabled:opacity-60"
              />

              <button
                type="submit"
                disabled={sending || !input.trim()}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-45 shrink-0 ${currentChannelCfg.accentBg} ${currentChannelCfg.accentHover}`}
              >
                <span>إرسال</span>
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Modal 1: Association 67-Plant Database Explorer */}
      {activeModal === "plants" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-[#E5E5E0] bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E5E5E0] px-5 py-4 shrink-0">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-[#166534]" />
                <div>
                  <h2 className="text-base font-bold text-[#18181B]">
                    قاعدة بيانات محاصيل الجمعية المصرية للزراعة الحيوية ({plantsDb.length} نبات)
                  </h2>
                  <p className="text-xs text-[#57534E]">
                    مرجع المحاصيل المعتمد لتشخيص المشاكل ودليل الزراعة عبر واتساب وفيسبوك والموقع
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="rounded-lg p-1.5 text-[#57534E] hover:bg-[#FAF9F6] hover:text-[#18181B]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-12 overflow-hidden">
              <div className="flex flex-col border-b md:border-b-0 md:border-l border-[#E5E5E0] md:col-span-5 bg-[#FAF9F6] overflow-hidden">
                <div className="p-3 space-y-2 border-b border-[#E5E5E0] bg-white">
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]" />
                    <input
                      type="text"
                      value={modalPlantSearch}
                      onChange={(e) => setModalPlantSearch(e.target.value)}
                      placeholder="ابحث عن محصول..."
                      className="w-full rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] py-2 pr-8 pl-3 text-xs focus:border-[#166534] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {["الكل", ...plantCategories].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setModalPlantCategory(c)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                          modalPlantCategory === c
                            ? "bg-[#166534] text-white"
                            : "bg-[#EFECE6] text-[#57534E]"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {filteredModalPlants.map((p) => {
                    const selected = inspectedPlant?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setInspectedPlant(p)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-xs transition-colors ${
                          selected
                            ? "bg-[#166534] text-white font-semibold"
                            : "bg-white text-[#18181B] hover:bg-[#EFECE6]"
                        }`}
                      >
                        <span className="truncate">{p.name}</span>
                        <span
                          className={`text-[10px] shrink-0 ${
                            selected ? "text-white/85" : "text-[#78716C]"
                          }`}
                        >
                          {p.category}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col md:col-span-7 overflow-y-auto p-5 space-y-4">
                {inspectedPlant ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E5E0] pb-3">
                      <div>
                        <h3 className="text-base font-bold text-[#18181B]">
                          {inspectedPlant.name}
                        </h3>
                        <p className="text-xs text-[#57534E]">{inspectedPlant.category}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const targetName = inspectedPlant.name;
                          setActiveModal(null);
                          sendLiveMessage(targetName);
                        }}
                        className="rounded-lg bg-[#166534] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#14532D]"
                      >
                        استفسر عن {inspectedPlant.name} في الشات
                      </button>
                    </div>

                    {[
                      { title: "الأهمية والقيمة الاقتصادية", val: inspectedPlant.importance },
                      { title: "التربة والاحتياجات البيئية", val: inspectedPlant.environment },
                      {
                        title: "التقاوي والشتلات ومواعيد الزراعة",
                        val: inspectedPlant.seeds_and_nursery,
                      },
                      {
                        title: "تجهيز الأرض والممارسات الزراعية",
                        val: inspectedPlant.agricultural_practices,
                      },
                      { title: "نظام الري والملوحة", val: inspectedPlant.irrigation },
                      { title: "التسميد العضوي والحيوي", val: inspectedPlant.fertilization },
                      {
                        title: "الوقاية والمكافحة الحيوية للآفات والأمراض",
                        val: inspectedPlant.pest_and_disease_control,
                      },
                      { title: "طرق ومواعيد الحصاد والإنتاج", val: inspectedPlant.harvest },
                      { title: "معاملات ما بعد الحصاد والتخزين", val: inspectedPlant.post_harvest },
                      { title: "معلومات إضافية", val: inspectedPlant.extra_notes },
                    ]
                      .filter((sec) => sec.val && sec.val.trim().length > 1)
                      .map((sec) => (
                        <div
                          key={sec.title}
                          className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-3.5 space-y-1"
                        >
                          <div className="text-xs font-bold text-[#166534]">{sec.title}</div>
                          <p className="text-xs text-[#18181B] whitespace-pre-wrap leading-relaxed">
                            {sec.val}
                          </p>
                        </div>
                      ))}
                  </>
                ) : (
                  <p className="text-xs text-[#57534E]">اختر محصولاً من القائمة لعرض بياناته.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Admin Inspection of Validated Farmer Registrations */}
      {activeModal === "registrations" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-[#E5E5E0] bg-white p-6 shadow-xl space-y-4 max-h-[88vh] flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E5E0] pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-[#166534]" />
                <div>
                  <h2 className="text-base font-bold text-[#18181B]">
                    فحص تسجيلات مزارعي الجمعية المصرية للزراعة الحيوية ({registrations.length})
                  </h2>
                  <p className="text-xs text-[#57534E]">
                    أرقام تليفونات مفحوصة (11 رقم) · محافظات مطابقة رسمياً لـ 27 محافظة مصرية
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {registrations.length > 0 && (
                  <button
                    type="button"
                    onClick={exportRegistrationsCsv}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#166534] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#14532D]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>تصدير CSV</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg p-1.5 text-[#57534E] hover:bg-[#FAF9F6] hover:text-[#18181B]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {registrations.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 shrink-0">
                <div className="relative sm:col-span-2">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]" />
                  <input
                    type="text"
                    value={regSearch}
                    onChange={(e) => setRegSearch(e.target.value)}
                    placeholder="ابحث بالاسم أو رقم التليفون أو المحصول..."
                    className="w-full rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] py-2 pr-8 pl-3 text-xs focus:border-[#166534] focus:bg-white focus:outline-none"
                  />
                </div>
                <select
                  value={regGovFilter}
                  onChange={(e) => setRegGovFilter(e.target.value)}
                  className="rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-2 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
                >
                  <option value="الكل">كل المحافظات</option>
                  {registeredGovOptions.map((gov) => (
                    <option key={gov} value={gov}>
                      {gov}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3">
              {filteredRegistrations.length === 0 ? (
                <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-6 text-center space-y-2">
                  <p className="text-sm font-medium text-[#18181B]">
                    لا توجد تسجيلات مطابقة حالياً
                  </p>
                  <p className="text-xs text-[#57534E]">
                    اختر «تسجيل في الجمعية» من الشات لتجربة رحلة التسجيل وفحص رقم التليفون والمحافظة.
                  </p>
                </div>
              ) : (
                filteredRegistrations.map((reg) => {
                  const isPhoneValid = /^01[0125]\d{8}$/.test(reg.phone);
                  return (
                    <div
                      key={reg.registration_id}
                      className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E5E0] pb-2 text-[#57534E]">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#166534]">#{reg.registration_id}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {reg.channel === "whatsapp"
                              ? "واتساب"
                              : reg.channel === "messenger"
                              ? "فيسبوك"
                              : "الموقع"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={isPhoneValid ? "text-[#166534] font-medium" : "text-amber-700"}>
                            {isPhoneValid ? "رقم تليفون مفحوص (11 رقم)" : "يرجى مراجعة الرقم"}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => copyText(`ph_${reg.registration_id}`, reg.phone)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#E5E5E0] bg-white px-2.5 py-1 text-xs font-medium text-[#18181B] hover:bg-[#EFECE6]"
                        >
                          {copiedKey === `ph_${reg.registration_id}` ? (
                            <Check className="h-3.5 w-3.5 text-[#166534]" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {copiedKey === `ph_${reg.registration_id}`
                              ? "تم نسخ الرقم"
                              : "نسخ التليفون"}
                          </span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[#18181B]">
                        <div>
                          <span className="font-semibold text-[#57534E]">الاسم: </span>
                          {reg.full_name}
                        </div>
                        <div>
                          <span className="font-semibold text-[#57534E]">التليفون: </span>
                          <span dir="ltr" className="font-mono font-semibold">
                            {reg.phone}
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold text-[#57534E]">المحافظة الرسمية: </span>
                          <span className="font-semibold text-[#166534]">
                            {reg.governorate || reg.location}
                          </span>
                          {reg.location &&
                            reg.governorate &&
                            reg.location !== reg.governorate && (
                              <span className="text-[#57534E]"> ({reg.location})</span>
                            )}
                        </div>
                        <div>
                          <span className="font-semibold text-[#57534E]">المساحة والري: </span>
                          {reg.land_and_irrigation}
                        </div>
                        <div>
                          <span className="font-semibold text-[#57534E]">المحاصيل: </span>
                          {reg.crops}
                        </div>
                        <div>
                          <span className="font-semibold text-[#57534E]">الدعم المطلوب: </span>
                          {reg.support_needed || "شامل (نصائح + تدريبات)"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Google Sheets Sync */}
      {activeModal === "sheets" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#E5E5E0] bg-white p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E5E5E0] pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-[#166534]" />
                <h2 className="text-base font-bold text-[#18181B]">ربط وتحديث شيت جوجل إضافي</h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="rounded-lg p-1.5 text-[#57534E] hover:bg-[#FAF9F6] hover:text-[#18181B]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {activeSheet && (
              <div className="rounded-xl border border-[#166534]/25 bg-[#F0FDF4] p-3.5 text-xs text-[#14532D] space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="h-4 w-4 text-[#166534]" />
                  <span>الشيت المفعّل بجانب قاعدة النباتات: {activeSheet.title}</span>
                </div>
                <p className="text-[#166534]/90">عدد الصفوف المسحوبة: {activeSheet.rows_indexed} صف</p>
              </div>
            )}

            <div className="space-y-2.5">
              <p className="text-xs text-[#57534E] leading-relaxed">
                سجّل الدخول بحساب Google لو الشيت خاص، أو الصق رابط الشيت مباشرة للتحديث الفوري:
              </p>

              {googleUser && hasToken ? (
                <div className="flex items-center justify-between rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] px-3.5 py-2.5 text-xs">
                  <span className="font-medium text-[#18181B] truncate">
                    متصل: {googleUser.email || googleUser.displayName}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await logout();
                      setGoogleUser(null);
                      setHasToken(false);
                    }}
                    className="inline-flex items-center gap-1 text-red-700 hover:underline shrink-0"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>خروج</span>
                  </button>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={signingIn}
                    className="gsi-material-button"
                  >
                    <div className="gsi-material-button-state" />
                    <div className="gsi-material-button-content-wrapper">
                      <div className="gsi-material-button-icon">
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
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
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">
                        {signingIn ? "Signing in..." : "Sign in with Google"}
                      </span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <form onSubmit={handleSyncSheet} className="space-y-3">
              <input
                type="text"
                dir="ltr"
                value={sheetUrlInput}
                onChange={(e) => setSheetUrlInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full rounded-xl border border-[#D6D3CD] bg-[#FAF9F6] px-3.5 py-2.5 text-xs font-mono text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={syncingSheet || !sheetUrlInput.trim()}
                className="w-full rounded-xl bg-[#166534] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#14532D] disabled:opacity-50"
              >
                {syncingSheet ? "جاري سحب بيانات الشيت..." : "ربط وتحديث الشيت الآن"}
              </button>
            </form>

            {sheetNotice && (
              <div
                className={`rounded-xl p-3 text-xs ${
                  sheetNotice.type === "ok"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border border-red-200 bg-red-50 text-red-900"
                }`}
              >
                {sheetNotice.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal 4: WhatsApp · Facebook · Web Webhook & Embed Links */}
      {activeModal === "links" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-[#E5E5E0] bg-white p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E5E5E0] pb-3">
              <div className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-[#166534]" />
                <h2 className="text-base font-bold text-[#18181B]">
                  روابط تشغيل واتساب وفيسبوك والموقع
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="rounded-lg p-1.5 text-[#57534E] hover:bg-[#FAF9F6] hover:text-[#18181B]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-[#57534E] leading-relaxed">
              يدعم رابط واتساب أزرار الرد التفاعلية (Reply Buttons) وقوائم الاختيار الأصلية في واتساب
              (Interactive List Messages) تلقائياً بدون أي واجهات ويب خارجية:
            </p>

            {/* WhatsApp */}
            <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#008069]">
                  <MessageCircle className="h-4 w-4" />
                  <span>1. واتساب (Meta WhatsApp Cloud Webhook)</span>
                </span>
                <button
                  type="button"
                  onClick={() => copyText("wa", waWebhookUrl)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E5E5E0] bg-white px-2.5 py-1 text-xs font-medium hover:bg-[#EFECE6]"
                >
                  {copiedKey === "wa" ? (
                    <Check className="h-3.5 w-3.5 text-[#166534]" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedKey === "wa" ? "تم النسخ" : "نسخ الرابط"}</span>
                </button>
              </div>
              <div
                dir="ltr"
                className="rounded-lg bg-white px-3 py-2 font-mono text-xs text-[#18181B] border border-[#E5E5E0] break-all"
              >
                {waWebhookUrl}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#57534E]">
                <span>
                  Verify Token:{" "}
                  <code className="font-mono text-[#18181B]">agripulse_wa_verify_2026</code>
                </span>
                <button
                  type="button"
                  onClick={() => copyText("wa_tok", "agripulse_wa_verify_2026")}
                  className="text-[#008069] hover:underline"
                >
                  {copiedKey === "wa_tok" ? "تم نسخ التوكن" : "نسخ التوكن"}
                </button>
              </div>
            </div>

            {/* Facebook Messenger */}
            <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1D4ED8]">
                  <MessageCircle className="h-4 w-4" />
                  <span>2. فيسبوك ماسنجر (Facebook Page Webhook)</span>
                </span>
                <button
                  type="button"
                  onClick={() => copyText("fb", fbWebhookUrl)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E5E5E0] bg-white px-2.5 py-1 text-xs font-medium hover:bg-[#EFECE6]"
                >
                  {copiedKey === "fb" ? (
                    <Check className="h-3.5 w-3.5 text-[#166534]" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedKey === "fb" ? "تم النسخ" : "نسخ الرابط"}</span>
                </button>
              </div>
              <div
                dir="ltr"
                className="rounded-lg bg-white px-3 py-2 font-mono text-xs text-[#18181B] border border-[#E5E5E0] break-all"
              >
                {fbWebhookUrl}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#57534E]">
                <span>
                  Verify Token:{" "}
                  <code className="font-mono text-[#18181B]">agripulse_fb_verify_2026</code>
                </span>
                <button
                  type="button"
                  onClick={() => copyText("fb_tok", "agripulse_fb_verify_2026")}
                  className="text-[#1D4ED8] hover:underline"
                >
                  {copiedKey === "fb_tok" ? "تم نسخ التوكن" : "نسخ التوكن"}
                </button>
              </div>
            </div>

            {/* Website Embed */}
            <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#18181B]">
                  <Globe className="h-4 w-4" />
                  <span>3. الموقع الإلكتروني (كود الإضافة للموقع)</span>
                </span>
                <button
                  type="button"
                  onClick={() => copyText("web", webScriptSnippet)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E5E5E0] bg-white px-2.5 py-1 text-xs font-medium hover:bg-[#EFECE6]"
                >
                  {copiedKey === "web" ? (
                    <Check className="h-3.5 w-3.5 text-[#166534]" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedKey === "web" ? "تم النسخ" : "نسخ الكود"}</span>
                </button>
              </div>
              <div
                dir="ltr"
                className="rounded-lg bg-white px-3 py-2 font-mono text-xs text-[#18181B] border border-[#E5E5E0] break-all"
              >
                {webScriptSnippet}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
