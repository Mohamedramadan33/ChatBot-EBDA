import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BarChart3,
  BookOpen,
  Camera,
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
  Link2,
  List,
  LogOut,
  MessageCircle,
  Mic,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sprout,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";
import { getAccessToken, googleSignIn, initAuth, logout } from "./services/googleAuth";
import type {
  ChatMessageRecord,
  ConnectedGoogleSheet,
  EvaluationMetricsOverview,
  FlowUiMode,
  GovernorateItem,
  MemberRegistrationRecord,
  PlantDatabaseItem,
  SessionFlowState,
} from "./types";

type ChannelMode = "whatsapp" | "messenger" | "widget";

const MAIN_STARTER_LABELS: string[] = [
  "تسجيل في الجمعية (EBDA)",
  "عن الجمعية واقتصاد المحبة",
  "موضوعات الزراعة العضوية",
  "الأسئلة الشائعة (FAQs)",
  "هل توجد مشكلة في محصول؟",
  "ترشيح أنسب محصول لأرضي",
  "دليل زراعة محصول كامل",
  "أخرى (سؤال آخر)",
];

const OPENING_GREETING_BY_CHANNEL: Record<ChannelMode, string> = {
  whatsapp:
    "أهلاً وسهلاً بيك في *الجمعية المصرية للزراعة الحيوية (EBDA)* ومبادرة *اقتصاد المحبة*، نقدر نساعدك إزاي؟",
  messenger:
    "أهلاً وسهلاً بيك في الجمعية المصرية للزراعة الحيوية (EBDA) ومبادرة اقتصاد المحبة، نقدر نساعدك إزاي؟",
  widget:
    "أهلاً وسهلاً بحضرتك على الموقع الرسمي لـ **الجمعية المصرية للزراعة الحيوية (EBDA)** ومبادرة **اقتصاد المحبة (Economy of Love)** — يسعدنا مساعدتك في الاستشارات العضوية، ترشيح المحاصيل، أو تسجيل مزرعتك. نقدر نساعدك إزاي النهارده؟",
};

const UI_CHOICE_SHORT_20: Record<string, string> = {
  "تسجيل في الجمعية (EBDA)": "تسجيل بالجمعية",
  "عن الجمعية واقتصاد المحبة": "عن الجمعية والمحبة",
  "موضوعات الزراعة العضوية": "موضوعات العضوية",
  "الأسئلة الشائعة (FAQs)": "الأسئلة الشائعة",
  "هل توجد مشكلة في محصول؟": "مشكلة في محصول؟",
  "ترشيح أنسب محصول لأرضي": "ترشيح محصول لأرضي",
  "دليل زراعة محصول كامل": "دليل زراعة محصول",
  "أخرى (سؤال آخر)": "أخرى (سؤال آخر)",
  "أخرى (نبات غير موجود)": "نبات آخر غير موجود",
  "أخرى (سؤال آخر عن المحصول)": "سؤال آخر عن المحصول",
  "أخرى (محصول أو سؤال آخر)": "محصول أو سؤال آخر",
  "إرشادات عامة للزراعة العضوية": "إرشادات عضوية عامة",
  "توصيات موضوعات لمحصول محدد": "توصيات لمحصول محدد",
  "تطبيق موضوع على محصول محدد": "تطبيق على محصول",
  "تطبيق هذا الموضوع على محصول محدد": "تطبيق على محصول",
  "رجوع للموضوعات العامة": "الموضوعات العامة",
  "شهادة اقتصاد المحبة وشهادات الكربون": "اقتصاد المحبة EoL",
  "التدريبات العملية للمزارعين": "تدريبات المزارعين",
  "كيف يستفيد المزارع من الجمعية؟": "فوائد الانضمام",
  "قواعد الزراعة الحيوية وديميتر": "قواعد ديميتر",
  "إزاي أسوق المنتجات العضوية والحيوية؟": "تسويق المنتج العضوي",
  "عرض باقي الأسئلة الشائعة (7–11)": "باقي الأسئلة (7-11)",
  "رجوع للأسئلة الشائعة (1–6)": "الأسئلة (1-6)",
  "عرض باقي محاصيل القسم": "باقي محاصيل القسم",
  "الرجوع لأول القسم": "أول القسم",
  "رجوع لأقسام المحاصيل": "أقسام المحاصيل",
  "قسم النباتات الطبية والعطرية": "طبية وعطرية",
  "قسم المحاصيل الحقلية": "محاصيل حقلية",
  "قسم أشجار الفاكهة": "أشجار الفاكهة",
  "قسم المحاصيل الزيتية والجذرية": "زيتية وجذرية",
  "إصابة حشرية في المحصول": "إصابة حشرية",
  "إصابة فطرية أو أعفان": "فطريات أو أعفان",
  "ضعف نمو أو تسميد حيوي": "ضعف نمو أو تسميد",
  "مشكلة في الري أو الملوحة": "الري أو الملوحة",
  "مشكلة حشائش في الأرض": "مشكلة الحشائش",
  "1. الاحتياجات البيئية": "1. البيئة والتربة",
  "2. البذور والزراعة وتجهيز الأرض": "2. البذور والزراعة",
  "3. الري والملوحة وتحاليل المياه": "3. الري والملوحة",
  "4. التسميد والكمبوست ومنافذ الشراء": "4. التسميد الحيوي",
  "5. المكافحة الحيوية والحشائش": "5. المكافحة الحيوية",
  "6. طرق ومواعيد الحصاد": "6. طرق الحصاد",
  "7. ما بعد الحصاد والتخزين والتسويق": "7. ما بعد الحصاد",
  "تأكيد وإرسال التسجيل": "تأكيد التسجيل",
};

const UI_CHOICE_SHORT_24: Record<string, string> = {
  "عن الجمعية واقتصاد المحبة": "عن الجمعية والمحبة",
  "أخرى (سؤال آخر عن المحصول)": "سؤال آخر عن المحصول",
  "إرشادات عامة للزراعة العضوية": "إرشادات عضوية عامة",
  "تطبيق موضوع على محصول محدد": "تطبيق على محصول محدد",
  "تطبيق هذا الموضوع على محصول محدد": "تطبيق على محصول محدد",
  "شهادة اقتصاد المحبة وشهادات الكربون": "اقتصاد المحبة والكربون",
  "التدريبات العملية للمزارعين": "تدريبات عملية للمزارعين",
  "كيف يستفيد المزارع من الجمعية؟": "كيف يستفيد المزارع؟",
  "قواعد الزراعة الحيوية وديميتر": "قواعد الحيوية وديميتر",
  "إزاي أسوق المنتجات العضوية والحيوية؟": "تسويق المنتجات العضوية",
  "عرض باقي الأسئلة الشائعة (7–11)": "باقي الأسئلة (7–11)",
  "رجوع للأسئلة الشائعة (1–6)": "الأسئلة الشائعة (1–6)",
  "قسم النباتات الطبية والعطرية": "النباتات الطبية والعطرية",
  "قسم المحاصيل الزيتية والجذرية": "المحاصيل الزيتية والجذرية",
  "2. البذور والزراعة وتجهيز الأرض": "2. البذور وتجهيز الأرض",
  "3. الري والملوحة وتحاليل المياه": "3. الري والملوحة والمياه",
  "4. التسميد والكمبوست ومنافذ الشراء": "4. التسميد والكمبوست",
  "5. المكافحة الحيوية والحشائش": "5. المكافحة والحشائش",
  "7. ما بعد الحصاد والتخزين والتسويق": "7. الحصاد والتسويق",
};

function shortenChoiceTitleUi(rawLabel: string, maxLen: number): string {
  const clean = rawLabel.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  if (maxLen <= 20 && UI_CHOICE_SHORT_20[clean] && UI_CHOICE_SHORT_20[clean].length <= maxLen) {
    return UI_CHOICE_SHORT_20[clean];
  }
  if (maxLen <= 24 && UI_CHOICE_SHORT_24[clean] && UI_CHOICE_SHORT_24[clean].length <= maxLen) {
    return UI_CHOICE_SHORT_24[clean];
  }
  if (UI_CHOICE_SHORT_20[clean] && UI_CHOICE_SHORT_20[clean].length <= maxLen) {
    return UI_CHOICE_SHORT_20[clean];
  }
  if (clean.startsWith("دليل زراعة ")) {
    const cropPart = clean.replace(/^دليل زراعة\s+/, "").replace(/\s*\(.*?\)/g, "").trim();
    const cand = `دليل ${cropPart}`;
    if (cand.length <= maxLen) return cand;
  }
  const withoutParens = clean.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (withoutParens.length >= 4 && withoutParens.length <= maxLen) return withoutParens;
  const source = withoutParens.length >= 4 ? withoutParens : clean;
  const budget = Math.max(4, maxLen - 1);
  const slice = source.slice(0, budget + 1);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLen * 0.45)) {
    return `${slice.slice(0, lastSpace).replace(/[،,:.\-؟?]+$/, "").trim()}…`;
  }
  return `${source.slice(0, budget).trim()}…`;
}

function renderWhatsAppFormattedText(rawText: string): React.ReactNode {
  const normalized = rawText.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  const lines = normalized.split("\n");
  return (
    <div className="space-y-1 text-[13.5px] leading-relaxed text-[#111B21]">
      {lines.map((line, lineIdx) => {
        if (!line.trim()) {
          return <div key={lineIdx} className="h-1.5" />;
        }
        const tokens = line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
        return (
          <div key={lineIdx} className="whitespace-pre-wrap">
            {tokens.map((tok, tokIdx) => {
              if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
                return (
                  <strong key={tokIdx} className="font-bold text-[#111B21]">
                    {tok.slice(1, -1)}
                  </strong>
                );
              }
              if (tok.startsWith("_") && tok.endsWith("_") && tok.length > 2) {
                return (
                  <em key={tokIdx} className="italic text-[#54656F] text-xs">
                    {tok.slice(1, -1)}
                  </em>
                );
              }
              return <React.Fragment key={tokIdx}>{tok}</React.Fragment>;
            })}
          </div>
        );
      })}
    </div>
  );
}

const CHANNELS: Array<{
  id: ChannelMode;
  label: string;
  subLabel: string;
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
    subLabel: "حساب الأعمال الرسمي — أزرار وقوائم تفاعلية وخط عريض *نص* بحد 1024 حرف",
    sessionId: "whatsapp:live-test",
    accentBg: "bg-[#008069]",
    accentHover: "hover:bg-[#016B58]",
    userBubbleBg: "bg-[#D9FDD3] border border-[#C1E8BA]",
    userBubbleText: "text-[#111B21]",
    canvasBg: "bg-[#EFEAE2]",
    placeholder: "اكتب رسالتك على واتساب أو اختر من القائمة التفاعلية...",
  },
  {
    id: "messenger",
    label: "فيسبوك ماسنجر (Facebook)",
    subLabel: "رسائل الصفحة الرسمية — نص عربي صافي بدون رموز Markdown + أزرار رد سريع",
    sessionId: "messenger:live-test",
    accentBg: "bg-[#1D4ED8]",
    accentHover: "hover:bg-[#1E40AF]",
    userBubbleBg: "bg-[#1D4ED8]",
    userBubbleText: "text-white",
    canvasBg: "bg-[#F4F6FB]",
    placeholder: "اكتب رسالتك على فيسبوك ماسنجر أو اختر من الأزرار السريعة...",
  },
  {
    id: "widget",
    label: "موقع الشركة (Website)",
    subLabel: "المساعد المدمج في الموقع الرسمي للجمعية / الشركة — تنسيق غني وصوت وتقييم",
    sessionId: "widget:live-test",
    accentBg: "bg-[#166534]",
    accentHover: "hover:bg-[#14532D]",
    userBubbleBg: "bg-[#166534]",
    userBubbleText: "text-white",
    canvasBg: "bg-[#FAF9F6]",
    placeholder: "اكتب سؤالك الزراعي على الموقع أو اختر من الخدمات...",
  },
];

export default function App() {
  const [channel, setChannel] = useState<ChannelMode>("whatsapp");
  const [webViewMode, setWebViewMode] = useState<"embedded_site" | "fullscreen_chat">(
    "embedded_site"
  );
  const [embedCompanyName, setEmbedCompanyName] = useState(
    "الجمعية المصرية للزراعة الحيوية (EBDA)"
  );
  const [embedPrimaryColor, setEmbedPrimaryColor] = useState("#166534");
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

  // Admin Modals: "plants" | "registrations" | "sheets" | "links" | "tor_docs" | null
  const [activeModal, setActiveModal] = useState<
    "plants" | "registrations" | "sheets" | "links" | "tor_docs" | null
  >(null);
  const [torTab, setTorTab] = useState<"kpis" | "docs">("kpis");
  const [metrics, setMetrics] = useState<EvaluationMetricsOverview | null>(null);
  const [ratingsByMsgId, setRatingsByMsgId] = useState<Record<string, 1 | -1>>({});
  const [syncingConnectors, setSyncingConnectors] = useState(false);
  const [connectorNotice, setConnectorNotice] = useState<string | null>(null);

  // Voice Recording & TTS Read-Aloud State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [playingMsgId, setPlayingMsgId] = useState<string | null>(null);
  const [loadingTtsId, setLoadingTtsId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsCacheRef = useRef<Record<string, string>>({});

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

  // Vision Prediction / Plant Leaf Image Upload State
  const [selectedImage, setSelectedImage] = useState<{
    base64: string;
    mime: string;
    previewUrl: string;
    name: string;
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics");
      if (res.ok) {
        const data = (await res.json()) as EvaluationMetricsOverview;
        setMetrics(data);
      }
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
    loadMetrics();
    return () => {
      unsub();
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      activeAudioRef.current?.pause();
    };
  }, [loadPlantsDb, loadRegistrations, loadConnectedSheets, loadMetrics]);

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

  // Active choices ALWAYS available from turn 0, while respecting explicit [] during open smart-advisor questions
  const activeChoices: string[] = useMemo(() => {
    if (currentMessages.length === 0) {
      return MAIN_STARTER_LABELS;
    }
    if (lastAssistantMsg && Array.isArray(lastAssistantMsg.quick_replies)) {
      return lastAssistantMsg.quick_replies;
    }
    return MAIN_STARTER_LABELS;
  }, [currentMessages.length, lastAssistantMsg]);

  const isWhatsAppThreeButtons = useMemo(() => {
    return activeChoices.length > 0 && activeChoices.length <= 3;
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

  const sendLiveMessage = async (
    rawText: string,
    options?: { imageBase64?: string; imageMime?: string }
  ) => {
    const text = rawText.trim();
    const imageBase64 = options?.imageBase64 || selectedImage?.base64;
    const imageMime = options?.imageMime || selectedImage?.mime || "image/jpeg";
    const hasImage = Boolean(imageBase64);

    if ((!text && !hasImage) || sending) return;

    const targetChannel = channel;
    const targetSessionId = currentChannelCfg.sessionId;

    setInput("");
    setSelectedImage(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
    setErrorMsg(null);
    setWaListExpanded(true);

    const optimisticUserMsg: ChatMessageRecord = {
      message_id: `u_${Date.now()}`,
      session_id: targetSessionId,
      role: "user",
      content: text || "فحص وتشخيص صورة نبات 📷",
      citations: [],
      latency_ms: 0,
      image_base64: hasImage ? imageBase64 : undefined,
      image_mime: hasImage ? imageMime : undefined,
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
        const messageObj = hasImage
          ? {
              from: "live-test",
              id: `wamid.${Date.now()}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: "image",
              image: {
                base64: imageBase64,
                mime_type: imageMime,
                caption: text || "فحص صورة النبات وتشخيص الإصابة 📷",
              },
            }
          : {
              from: "live-test",
              id: `wamid.${Date.now()}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: "text",
              text: { body: text },
            };

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
                      messages: [messageObj],
                    },
                  },
                ],
              },
            ],
          }),
        });
      } else if (targetChannel === "messenger") {
        const messagePayload = hasImage
          ? {
              mid: `m_${Date.now()}`,
              text: text || "فحص صورة النبات وتشخيص الإصابة 📷",
              attachments: [
                {
                  type: "image",
                  payload: {
                    base64: imageBase64,
                    mime_type: imageMime,
                  },
                },
              ],
            }
          : { mid: `m_${Date.now()}`, text };

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
                    message: messagePayload,
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
            message: text || "فحص وتشخيص صورة نبات 📷",
            image_base64: hasImage ? imageBase64 : undefined,
            image_mime: hasImage ? imageMime : undefined,
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
      loadMetrics();
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

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mime = file.type || "image/jpeg";
    const reader = new FileReader();
    reader.onload = (event) => {
      const res = String(event.target?.result || "");
      const base64 = res.includes(",") ? res.split(",")[1] : res;
      setSelectedImage({
        base64,
        mime,
        previewUrl: res,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const clearSelectedImage = () => {
    setSelectedImage(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendLiveMessage(input);
  };

  const stopMediaTracksAndTimer = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const startVoiceRecording = async () => {
    if (sending || isRecording) return;
    setErrorMsg(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg("المتصفح الحالي لا يدعم تسجيل الميكروفون.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      stopMediaTracksAndTimer();
      setErrorMsg("يرجى السماح بصلاحية الميكروفون في المتصفح لتسجيل سؤالك الصوتي.");
    }
  };

  const cancelVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    stopMediaTracksAndTimer();
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const finishAndSendVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cancelVoiceRecording();
      return;
    }

    const targetChannel = channel;
    const targetSessionId = currentChannelCfg.sessionId;
    const mimeType = recorder.mimeType || "audio/webm";

    recorder.onstop = async () => {
      stopMediaTracksAndTimer();
      setIsRecording(false);
      setRecordingSeconds(0);

      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];
      if (audioBlob.size < 300) {
        setErrorMsg("الرسالة الصوتية قصيرة جداً، اضغط على الميكروفون وتحدث بوضوح ثم اضغط إرسال.");
        return;
      }

      setSending(true);
      setErrorMsg(null);
      setWaListExpanded(true);

      try {
        const base64Audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const resStr = String(reader.result || "");
            const commaIdx = resStr.indexOf(",");
            resolve(commaIdx >= 0 ? resStr.slice(commaIdx + 1) : resStr);
          };
          reader.onerror = () => reject(new Error("تعذر قراءة الملف الصوتي"));
          reader.readAsDataURL(audioBlob);
        });

        const attachedImage = selectedImage;
        if (attachedImage) {
          setSelectedImage(null);
          if (imageInputRef.current) imageInputRef.current.value = "";
        }

        const res = await fetch("/api/voice-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: targetSessionId,
            channel: targetChannel,
            external_user_id: "live-test",
            profile_name: "عضو الجمعية (صوتي)",
            audio_base64: base64Audio,
            mime_type: mimeType,
            image_base64: attachedImage ? attachedImage.base64 : undefined,
            image_mime: attachedImage ? attachedImage.mime : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "تعذر تفريغ الرسالة الصوتية");
        }

        const spokenText = String(data.transcribed_text || "رسالة صوتية");
        const userVoiceRecord: ChatMessageRecord = {
          message_id: `uv_${Date.now()}`,
          session_id: targetSessionId,
          role: "user",
          content: `🎤 ${spokenText}`,
          citations: [],
          latency_ms: 0,
          image_base64: attachedImage ? attachedImage.base64 : undefined,
          image_mime: attachedImage ? attachedImage.mime : undefined,
          is_voice: true,
          created_at: new Date().toISOString(),
        };

        const assistantRecord: ChatMessageRecord = {
          message_id: data.message_id || `av_${Date.now()}`,
          session_id: targetSessionId,
          role: "assistant",
          content: data.answer || "",
          citations: data.citations || [],
          latency_ms: data.latency_ms || 0,
          quick_replies: Array.isArray(data.quick_replies) ? data.quick_replies : [],
          ui_mode: data.ui_mode || "default",
          created_at: new Date().toISOString(),
        };

        setMessagesByChannel((prev) => ({
          ...prev,
          [targetChannel]: [...(prev[targetChannel] || []), userVoiceRecord, assistantRecord],
        }));

        if (data.flow_state) {
          setFlowByChannel((prev) => ({
            ...prev,
            [targetChannel]: data.flow_state,
          }));
        }

        if (String(data.answer || "").includes("تم تأكيد وتسجيل انضمامك")) {
          loadRegistrations();
        }
        loadMetrics();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "تعذر إرسال الرسالة الصوتية");
      } finally {
        setSending(false);
      }
    };

    recorder.stop();
  };

  const handleToggleSpeakReply = async (msgId: string, textContent: string) => {
    if (playingMsgId === msgId) {
      activeAudioRef.current?.pause();
      activeAudioRef.current = null;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingMsgId(null);
      return;
    }

    activeAudioRef.current?.pause();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setLoadingTtsId(msgId);
    try {
      let cachedWav = ttsCacheRef.current[msgId];
      if (!cachedWav) {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textContent }),
        });
        const data = await res.json();
        if (res.ok && data.audio_base64) {
          cachedWav = String(data.audio_base64);
          ttsCacheRef.current[msgId] = cachedWav;
        }
      }
      if (cachedWav) {
        const audio = new Audio(`data:audio/wav;base64,${cachedWav}`);
        activeAudioRef.current = audio;
        setPlayingMsgId(msgId);
        audio.onended = () => setPlayingMsgId(null);
        audio.onerror = () => setPlayingMsgId(null);
        await audio.play();
        return;
      }
      throw new Error("fallback-speech");
    } catch {
      if ("speechSynthesis" in window) {
        const cleanText = textContent.replace(/[*#_`~>]+/g, " ");
        const utter = new SpeechSynthesisUtterance(cleanText);
        utter.lang = "ar-EG";
        utter.onend = () => setPlayingMsgId(null);
        utter.onerror = () => setPlayingMsgId(null);
        setPlayingMsgId(msgId);
        window.speechSynthesis.speak(utter);
      } else {
        setErrorMsg("تعذر تشغيل القراءة الصوتية على هذا الجهاز.");
      }
    } finally {
      setLoadingTtsId(null);
    }
  };

  const handleRateMessage = async (msgId: string, rating: 1 | -1) => {
    setRatingsByMsgId((prev) => ({ ...prev, [msgId]: rating }));
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: msgId,
          session_id: currentChannelCfg.sessionId,
          rating,
          category: rating === 1 ? "helpful_farmer_reply" : "needs_improvement",
        }),
      });
      loadMetrics();
    } catch {
      // ignore
    }
  };

  const handleSyncLiveConnectors = async () => {
    if (syncingConnectors) return;
    setSyncingConnectors(true);
    setConnectorNotice(null);
    try {
      const res = await fetch("/api/connectors/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تعذر تحديث الموصلات الحية");
      setConnectorNotice(
        `تم تحديث بيانات الطقس الزراعي والتربة وأسعار المدخلات العضوية بنجاح (${data.total_chunks} مقطع معرفي مفهرس).`
      );
    } catch (err) {
      setConnectorNotice(err instanceof Error ? err.message : "فشل تحديث البيانات الحية");
    } finally {
      setSyncingConnectors(false);
    }
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
    loadMetrics();
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

  const syncSheetByUrl = async (targetUrl: string) => {
    if (!targetUrl.trim() || syncingSheet) return;
    setSyncingSheet(true);
    setSheetNotice(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/google-sheets/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ spreadsheet_url: targetUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل قراءة الشيت");

      setSheetNotice({
        type: "ok",
        text: `تمت المزامنة الحية لشيت «${data.sheet.title}» وتوليد التضمينات بنجاح (${data.sheet.rows_indexed} صف مفهرس).`,
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

  const handleSyncSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    await syncSheetByUrl(sheetUrlInput);
  };

  const copyText = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const origin = window.location.origin;
  const waWebhookUrl = `${origin}/webhooks/whatsapp`;
  const fbWebhookUrl = `${origin}/webhooks/messenger`;
  const webScriptSnippet = `<script src="${origin}/agripulse-widget.js" data-company-name="${embedCompanyName.replace(
    /"/g,
    "&quot;"
  )}" data-primary-color="${embedPrimaryColor}" async></script>`;

  const openingGreetingText = OPENING_GREETING_BY_CHANNEL[channel];

  const renderMessageContent = (rawContent: string) => {
    if (channel === "whatsapp") {
      return renderWhatsAppFormattedText(rawContent);
    }
    if (channel === "messenger") {
      return (
        <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#050505]">
          {rawContent}
        </div>
      );
    }
    return (
      <div className="prose prose-sm max-w-none text-[#111B21] prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-headings:text-sm prose-headings:font-bold">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{rawContent}</ReactMarkdown>
      </div>
    );
  };

  const renderChannelChoices = (choices: string[]) => {
    if (!choices.length || sending) return null;

    // 1. Authentic WhatsApp Interactive Buttons (1..3, <=20 char titles) or Interactive List (4..10, <=24 char titles + subtitle)
    if (channel === "whatsapp") {
      if (isWhatsAppThreeButtons) {
        return (
          <div className="flex justify-end">
            <div className="w-full max-w-md space-y-1.5">
              {choices.map((label) => {
                const shortTitle = shortenChoiceTitleUi(label, 20);
                return (
                  <button
                    key={label}
                    type="button"
                    title={label}
                    onClick={() => sendLiveMessage(label)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#D9D9D4] bg-white px-4 py-2.5 text-sm font-semibold text-[#008069] shadow-2xs hover:bg-[#F5FBF9] transition-colors"
                  >
                    <CornerUpLeft className="h-4 w-4 shrink-0" />
                    <span>{shortTitle}</span>
                  </button>
                );
              })}
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
                {choices.map((label) => {
                  const rowTitle = shortenChoiceTitleUi(label, 24);
                  const showSubtitle = rowTitle !== label;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => sendLiveMessage(label)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-right text-sm text-[#111B21] hover:bg-[#F5FBF9] transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold group-hover:text-[#008069] truncate">
                          {rowTitle}
                        </div>
                        {showSubtitle && (
                          <div className="text-[11px] text-[#667781] truncate mt-0.5">{label}</div>
                        )}
                      </div>
                      <span className="h-4 w-4 shrink-0 rounded-md border-2 border-[#8696A0] group-hover:border-[#008069]" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    // 2. Facebook Messenger Quick Replies (<=20 char titles + full payload on click)
    if (channel === "messenger") {
      return (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {choices.map((label) => {
            const fbShort = shortenChoiceTitleUi(label, 20);
            return (
              <button
                key={label}
                type="button"
                title={label}
                onClick={() => sendLiveMessage(label)}
                className="rounded-xl border border-[#1D4ED8]/40 bg-white px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] hover:bg-[#1D4ED8] hover:text-white transition-colors shadow-2xs"
              >
                {fbShort}
              </button>
            );
          })}
        </div>
      );
    }

    // 3. Company / Association Website Rich Choices
    return (
      <div className="flex flex-wrap justify-end gap-1.5 pt-1">
        {choices.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => sendLiveMessage(label)}
            className="rounded-xl border border-[#166534]/35 bg-white px-3 py-1.5 text-xs font-semibold text-[#166534] hover:bg-[#166534] hover:text-white transition-colors shadow-2xs"
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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#166534] text-white">
            <Sprout className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-[#18181B] truncate">
              الجمعية المصرية للزراعة الحيوية (EBDA)
            </h1>
            <p className="text-xs text-[#57534E] truncate">
              مبادرة اقتصاد المحبة (EoL) · ديميتر · {plantsDb.length || 67} محصول · تفاعل نصي وصوتي
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

        {/* Admin Inspection, KPIs & Integration Actions */}
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
            <span>التسجيلات ({registrations.length})</span>
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
            onClick={() => {
              loadMetrics();
              setActiveModal("tor_docs");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18181B] hover:border-[#166534] transition-colors whitespace-nowrap shrink-0"
          >
            <BarChart3 className="h-3.5 w-3.5 text-[#166534]" />
            <span>التقييم والدليل</span>
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

      {/* Channel Context Strip (WhatsApp · Facebook Messenger · Company Website) */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E5E0] px-4 py-2 sm:px-6 text-xs shrink-0 ${
          channel === "whatsapp"
            ? "bg-[#008069] text-white"
            : channel === "messenger"
            ? "bg-[#1D4ED8] text-white"
            : "bg-[#F3F2EC] text-[#18181B]"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold truncate">
            {channel === "whatsapp"
              ? "واتساب للأعمال — الجمعية المصرية للزراعة الحيوية (EBDA)"
              : channel === "messenger"
              ? "فيسبوك ماسنجر — الصفحة الرسمية للجمعية المصرية للزراعة الحيوية"
              : `${embedCompanyName} — المساعد الذكي للموقع الإلكتروني`}
          </span>
          <span className="hidden md:inline opacity-80">·</span>
          <span className="hidden md:inline opacity-90 truncate">{currentChannelCfg.subLabel}</span>
        </div>

        {channel === "widget" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1 rounded-lg border border-[#D6D3CD] bg-white p-0.5">
              <button
                type="button"
                onClick={() => setWebViewMode("embedded_site")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  webViewMode === "embedded_site"
                    ? "bg-[#166534] text-white"
                    : "text-[#57534E] hover:text-[#18181B]"
                }`}
              >
                معاينة داخل موقع الشركة
              </button>
              <button
                type="button"
                onClick={() => setWebViewMode("fullscreen_chat")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  webViewMode === "fullscreen_chat"
                    ? "bg-[#166534] text-white"
                    : "text-[#57534E] hover:text-[#18181B]"
                }`}
              >
                شاشة المحادثة الكاملة
              </button>
            </div>
            <button
              type="button"
              onClick={() => copyText("web_header", webScriptSnippet)}
              className="inline-flex items-center gap-1 rounded-lg border border-[#166534]/35 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#166534] hover:bg-[#F0FDF4]"
            >
              {copiedKey === "web_header" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedKey === "web_header" ? "تم نسخ الكود" : "نسخ كود الموقع"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Conversational Stream (or Split Company Website + Docked Chat Widget when in embedded_site mode) */}
      <main
        className={`flex min-h-0 flex-1 ${
          channel === "widget" && webViewMode === "embedded_site"
            ? "flex-col lg:flex-row bg-[#FAF9F6]"
            : `flex-col ${currentChannelCfg.canvasBg}`
        }`}
      >
        {/* Left/Right Company Website Landing Preview (Visible when channel === 'widget' && webViewMode === 'embedded_site') */}
        {channel === "widget" && webViewMode === "embedded_site" && (
          <section className="hidden lg:flex lg:flex-1 flex-col overflow-y-auto border-l border-[#E5E5E0] bg-white p-6 xl:p-8 justify-between">
            <div className="max-w-xl space-y-6">
              <div className="flex items-center justify-between border-b border-[#E5E5E0] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#166534] text-white">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[#18181B]">{embedCompanyName}</div>
                    <div className="text-xs text-[#57534E]">
                      البوابة الرسمية لخدمات الزراعة العضوية والحيوية · اقتصاد المحبة (EoL) · ديميتر
                    </div>
                  </div>
                </div>
                <span className="rounded-md border border-[#166534]/25 bg-[#F0FDF4] px-2.5 py-1 text-[11px] font-semibold text-[#166534]">
                  موقع الشركة / الجمعية
                </span>
              </div>

              <div className="space-y-2.5">
                <h2 className="text-xl font-bold text-[#18181B] leading-snug">
                  الإرشاد الزراعي العضوي والحيوي ودعم المزارعين نحو شهادة «اقتصاد المحبة» و«ديميتر»
                </h2>
                <p className="text-xs text-[#57534E] leading-relaxed">
                  منذ عام 1990 تدعم الجمعية المصرية للزراعة الحيوية (EBDA) بالتعاون مع مشروع (SI/EoL)
                  المزارعين والشركات الزراعية في التحول للزراعة الحيوية النظيفة 100%، اجتياز التفتيش
                  الدولي، وتعظيم العائد عبر التسويق العادل وشهادات الكربون. اضغط على أي خدمة بالأسفل
                  لتجربتها مباشرة في نافذة شات الموقع المقابلة:
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    title: "تسجيل مزرعة جديدة (EBDA / EoL)",
                    desc: "سجّل بيانات مزرعتك ومحافظتك للحصول على المتابعة الفنية والتدريبات والاعتماد.",
                    trigger: "تسجيل في الجمعية (EBDA)",
                  },
                  {
                    title: "استشارة فنية لـ 67 محصولاً",
                    desc: "تشخيص فوري للإصابات الحشرية والفطرية وبرامج الكمبوست والتسميد الحيوي للفدان.",
                    trigger: "هل توجد مشكلة في محصول؟",
                  },
                  {
                    title: "ترشيح أنسب محصول لأرضك",
                    desc: "تحليل ذكي حسب نوع التربة وملوحة المياه وموعد الزراعة ونظام الري لديك.",
                    trigger: "ترشيح أنسب محصول لأرضي",
                  },
                  {
                    title: "شهادات الكربون واقتصاد المحبة",
                    desc: "تعرّف على عوائد Carbon Credits وشروط ديميتر وتسويق المنتجات الحيوية.",
                    trigger: "شهادة اقتصاد المحبة وشهادات الكربون",
                  },
                ].map((card) => (
                  <button
                    key={card.title}
                    type="button"
                    disabled={sending}
                    onClick={() => sendLiveMessage(card.trigger)}
                    className="flex flex-col justify-between rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 text-right hover:border-[#166534] hover:bg-[#F0FDF4]/50 transition-colors disabled:opacity-50"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-[#166534]">{card.title}</div>
                      <p className="text-[11px] text-[#57534E] leading-relaxed">{card.desc}</p>
                    </div>
                    <div className="mt-3 text-[11px] font-semibold text-[#18181B]">
                      ابدأ في شات الموقع ←
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-3.5 flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="font-semibold text-[#18181B]">تركيب الشات على موقع الشركة بسطر واحد</div>
                <div dir="ltr" className="font-mono text-[11px] text-[#57534E] truncate mt-0.5">
                  {webScriptSnippet}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal("links")}
                className="rounded-lg bg-[#166534] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#14532D] shrink-0"
              >
                تخصيص ونسخ
              </button>
            </div>
          </section>
        )}

        {/* Chat Stream + Composer Column */}
        <div
          className={`flex min-h-0 flex-col ${
            channel === "widget" && webViewMode === "embedded_site"
              ? "flex-1 lg:w-[460px] lg:flex-none bg-[#FAF9F6]"
              : "flex-1"
          }`}
        >
          {channel === "widget" && webViewMode === "embedded_site" && (
            <div className="flex items-center justify-between bg-[#166534] px-4 py-2.5 text-white shrink-0">
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">{embedCompanyName}</div>
                <div className="text-[11px] text-white/85 truncate">
                  نافذة المساعد الذكي على الموقع الإلكتروني · نصي وصوتي
                </div>
              </div>
              <span className="rounded-md bg-white/15 px-2 py-0.5 text-[10px] font-semibold shrink-0">
                مباشر
              </span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-2xl space-y-3">
              {/* Opening Message Tailored to Active Channel */}
              <div className="flex justify-end">
                <div
                  className={`w-full max-w-md rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-2xs space-y-2 ${
                    channel === "messenger"
                      ? "bg-[#F0F2F5] border border-[#E4E6EB] text-[#050505]"
                      : "bg-white border border-[#E5E5E0] text-[#111B21]"
                  }`}
                >
                  {renderMessageContent(openingGreetingText)}
                  <div className="flex items-center justify-between border-t border-black/5 pt-1.5 text-[11px]">
                    <button
                      type="button"
                      disabled={loadingTtsId === "opening_greeting"}
                      onClick={() => handleToggleSpeakReply("opening_greeting", openingGreetingText)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[#166534] hover:bg-[#F0FDF4] transition-colors font-medium disabled:opacity-50"
                    >
                      {playingMsgId === "opening_greeting" ? (
                        <>
                          <Square className="h-3 w-3 fill-current" />
                          <span>إيقاف الصوت</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5" />
                          <span>
                            {loadingTtsId === "opening_greeting"
                              ? "جاري تجهيز الصوت..."
                              : "سماع الترحيب"}
                          </span>
                        </>
                      )}
                    </button>
                    <span className="text-[10px] text-[#78716C] font-mono tabular-nums">
                      {channel === "whatsapp"
                        ? "WhatsApp"
                        : channel === "messenger"
                        ? "Messenger"
                        : "Website"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Starter Choices Right From Turn 0 */}
              {currentMessages.length === 0 && renderChannelChoices(activeChoices)}

              {/* Back-and-Forth Conversation */}
              {currentMessages.map((msg) => {
                const isUser = msg.role === "user";
                const timeStr = (() => {
                  try {
                    return new Date(msg.created_at).toLocaleTimeString("ar-EG", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  } catch {
                    return "";
                  }
                })();

                if (isUser) {
                  return (
                    <div key={msg.message_id} className="flex justify-start">
                      <div
                        className={`max-w-md rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-2xs ${currentChannelCfg.userBubbleBg} ${currentChannelCfg.userBubbleText}`}
                      >
                        {msg.image_base64 && (
                          <div className="mb-2 overflow-hidden rounded-xl border border-black/10 bg-black/5">
                            <img
                              src={
                                msg.image_base64.startsWith("data:")
                                  ? msg.image_base64
                                  : `data:${msg.image_mime || "image/jpeg"};base64,${msg.image_base64}`
                              }
                              alt="صورة النبات المرفقة للفحص"
                              className="max-h-60 w-auto rounded-lg object-contain"
                            />
                          </div>
                        )}
                        <div>{msg.content}</div>
                        {channel === "whatsapp" && (
                          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#54656F] tabular-nums">
                            <span>{timeStr}</span>
                            <span className="text-[#027EB5] font-bold">✓✓</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                const currentRating = ratingsByMsgId[msg.message_id];
                const isSpeaking = playingMsgId === msg.message_id;
                const isTtsLoading = loadingTtsId === msg.message_id;

                return (
                  <div key={msg.message_id} className="flex justify-end">
                    <div
                      className={`w-full max-w-lg rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-2xs space-y-2.5 ${
                        channel === "messenger"
                          ? "bg-[#F0F2F5] border border-[#E4E6EB] text-[#050505]"
                          : "bg-white border border-[#E5E5E0] text-[#111B21]"
                      }`}
                    >
                      {renderMessageContent(msg.content)}

                      {/* Voice Read-Aloud & Farmer Satisfaction Feedback Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-2 text-[11px] text-[#57534E]">
                        <button
                          type="button"
                          disabled={isTtsLoading}
                          onClick={() => handleToggleSpeakReply(msg.message_id, msg.content)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[#166534] hover:bg-[#F0FDF4] transition-colors font-medium disabled:opacity-50"
                        >
                          {isSpeaking ? (
                            <>
                              <Square className="h-3 w-3 fill-current" />
                              <span>إيقاف الصوت</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-3.5 w-3.5" />
                              <span>{isTtsLoading ? "جاري تجهيز الصوت..." : "سماع الرد"}</span>
                            </>
                          )}
                        </button>

                        <div className="flex items-center gap-1">
                          <span className="text-[#78716C] ml-1">تقييم:</span>
                          <button
                            type="button"
                            onClick={() => handleRateMessage(msg.message_id, 1)}
                            title="رد مفيد"
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                              currentRating === 1
                                ? "bg-[#DCFCE7] text-[#166534] font-semibold"
                                : "hover:bg-white/80 text-[#57534E]"
                            }`}
                          >
                            <ThumbsUp className="h-3 w-3" />
                            <span>مفيد</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRateMessage(msg.message_id, -1)}
                            title="يحتاج تحسين"
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                              currentRating === -1
                                ? "bg-red-50 text-red-700 font-semibold"
                                : "hover:bg-white/80 text-[#57534E]"
                            }`}
                          >
                            <ThumbsDown className="h-3 w-3" />
                            <span>غير دقيق</span>
                          </button>
                        </div>
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
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#166534]" />
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

          {/* Contextual Format Helper & Message Input Bar (Text + Voice) */}
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
                    اكتب اسم المحافظة مباشرة (مطابقة تلقائية لـ 27 محافظة مصرية) أو اختر من القائمة
                  </span>
                </div>
              )}
              {activeFlow.mode === "topics_hub" && (
                <div className="flex items-center justify-between text-xs text-[#166534]">
                  <span>
                    موضوعات الزراعة العضوية الـ 7: يمكنك قراءة الدليل العام أو تطبيقه على أي محصول من الـ 67 محصولاً
                  </span>
                </div>
              )}
              {activeFlow.mode === "faq" && (
                <div className="flex items-center justify-between text-xs text-[#166534]">
                  <span>
                    الأسئلة الشائعة الـ 11 المعتمدة للجمعية (EBDA): اختر السؤال من القائمة أو اسأل نصياً أو صوتياً
                  </span>
                </div>
              )}
              {activeFlow.mode === "smart_advisor" && (
                <div className="flex items-center justify-between text-xs text-[#166534]">
                  <span>
                    المستشار الزراعي الذكي: اكتب أو سجّل صوتياً مواصفات أرضك (نوع التربة، شهر الزراعة، المساحة ونظام الري)
                  </span>
                </div>
              )}
              {activeFlow.mode === "general_ai" && (
                <div className="flex items-center justify-between text-xs text-[#166534]">
                  <span>
                    اسأل نصياً أو صوتياً باللهجة المصرية — الإجابات عضوية وحيوية (Organic 100%) ومبسطة
                  </span>
                </div>
              )}

              {selectedImage && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#166534]/30 bg-[#F0FDF4] p-2.5 text-xs text-[#166534]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={selectedImage.previewUrl}
                      alt="صورة النبات المحددة"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover border border-[#166534]/30"
                    />
                    <div className="min-w-0">
                      <div className="font-bold truncate">صورة نبات جاهزة للتشخيص الفوري 📷</div>
                      <div className="text-[11px] text-[#57534E] truncate">
                        اضغط إرسال للتشخيص أو اكتب سؤالك أو سجل صوتك
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => sendLiveMessage("شخص المرض الظاهر في الصورة وقدم العلاج العضوي 100%")}
                      className="hidden sm:inline-flex rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-[#166534] border border-[#166534]/30 hover:bg-[#DCFCE7]"
                    >
                      تشخيص فوري 🌿
                    </button>
                    <button
                      type="button"
                      onClick={clearSelectedImage}
                      title="إلغاء الصورة"
                      className="rounded-lg p-1 text-[#78716C] hover:bg-[#DCFCE7] hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {isRecording ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#166534]/40 bg-[#F0FDF4] px-4 py-2.5">
                  <div className="flex items-center gap-2.5 text-xs font-semibold text-[#166534]">
                    <Mic className="h-4 w-4 text-red-600 animate-pulse" />
                    <span>
                      جاري تسجيل رسالتك الصوتية...{" "}
                      <span dir="ltr" className="font-mono tabular-nums">
                        {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
                        {String(recordingSeconds % 60).padStart(2, "0")}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={cancelVoiceRecording}
                      className="rounded-lg border border-[#D6D3CD] bg-white px-3 py-1.5 text-xs font-medium text-[#57534E] hover:bg-[#EFECE6]"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={finishAndSendVoiceRecording}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold text-white ${currentChannelCfg.accentBg} ${currentChannelCfg.accentHover}`}
                    >
                      <span>إرسال الصوت</span>
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageFileSelect}
                  />

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
                      selectedImage
                        ? "اكتب تفاصيل إضافية عن الصورة أو اضغط إرسال فوراً..."
                        : activeFlow.mode === "register" && activeFlow.step === "ask_phone"
                        ? "01012345678"
                        : currentChannelCfg.placeholder
                    }
                    className="flex-1 rounded-xl border border-[#D6D3CD] bg-[#FAF9F6] px-4 py-3 text-sm text-[#18181B] placeholder:text-[#78716C] focus:border-[#166534] focus:bg-white focus:outline-none disabled:opacity-60"
                  />

                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => imageInputRef.current?.click()}
                    title="رفع صورة نبات للتشخيص الفوري وتحديد الأمراض 📷"
                    className={`inline-flex items-center justify-center rounded-xl border px-3.5 py-3 transition-colors shrink-0 disabled:opacity-45 ${
                      selectedImage
                        ? "border-[#166534] bg-[#F0FDF4] text-[#166534] ring-2 ring-[#166534]/30"
                        : "border-[#D6D3CD] bg-[#FAF9F6] text-[#166534] hover:border-[#166534] hover:bg-[#F0FDF4]"
                    }`}
                  >
                    <Camera className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    disabled={sending}
                    onClick={startVoiceRecording}
                    title="تسجيل رسالة صوتية باللهجة المصرية"
                    className="inline-flex items-center justify-center rounded-xl border border-[#D6D3CD] bg-[#FAF9F6] px-3.5 py-3 text-[#166534] hover:border-[#166534] hover:bg-[#F0FDF4] transition-colors shrink-0 disabled:opacity-45"
                  >
                    <Mic className="h-4 w-4" />
                  </button>

                  <button
                    type="submit"
                    disabled={sending || (!input.trim() && !selectedImage)}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-45 shrink-0 ${currentChannelCfg.accentBg} ${currentChannelCfg.accentHover}`}
                  >
                    <span>إرسال</span>
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              )}
            </div>
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

            {connectedSheets.length > 0 && (
              <div className="space-y-2">
                {connectedSheets.slice(0, 3).map((sh) => (
                  <div
                    key={sh.spreadsheet_id}
                    className="rounded-xl border border-[#166534]/25 bg-[#F0FDF4] p-3.5 text-xs text-[#14532D] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-bold min-w-0">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#166534]" />
                        <span className="truncate">{sh.title}</span>
                      </div>
                      {sh.auth_mode !== "builtin_demo" && (
                        <button
                          type="button"
                          disabled={syncingSheet}
                          onClick={() => syncSheetByUrl(sh.url)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#166534]/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#166534] hover:bg-[#DCFCE7] disabled:opacity-50 shrink-0"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>مزامنة حية</span>
                        </button>
                      )}
                    </div>
                    <p className="text-[#166534]/90">
                      الصفوف المفهرسة في قاعدة الـ Vector RAG: {sh.rows_indexed} صف · التبويبات:{" "}
                      {sh.tabs?.map((t) => t.sheet_name).join("، ") || "افتراضي"}
                    </p>
                  </div>
                ))}
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
              تتم تهيئة صياغة وتنسيق الردود تلقائياً لتناسب كل منصة: <strong>واتساب</strong> (خط عريض{" "}
              <code className="font-mono">*نص*</code> وحد 1024 حرف وأزرار/قوائم تفاعلية أصلية)،{" "}
              <strong>فيسبوك ماسنجر</strong> (نص عربي صافي بدون رموز Markdown وأزرار رد سريع Quick Replies)، و
              <strong>الموقع الرسمي للشركة/الجمعية</strong> (تنسيق غني مع تسجيل صوتي وقراءة صوتية).
            </p>

            {/* WhatsApp */}
            <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#008069]">
                  <MessageCircle className="h-4 w-4" />
                  <span>1. واتساب للأعمال (Meta WhatsApp Cloud Webhook)</span>
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
                  <span>2. فيسبوك ماسنجر (Facebook Page Messenger Webhook)</span>
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

            {/* Company / Association Website Embed */}
            <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#166534]">
                  <Globe className="h-4 w-4" />
                  <span>3. الموقع الخاص بالشركة / الجمعية (كود التضمين الجاهز)</span>
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-[#57534E] mb-1">
                    اسم الشركة / الجمعية على نافذة الشات:
                  </label>
                  <input
                    type="text"
                    value={embedCompanyName}
                    onChange={(e) => setEmbedCompanyName(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CD] bg-white px-2.5 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#57534E] mb-1">اللون الرئيسي:</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={embedPrimaryColor}
                    onChange={(e) => setEmbedPrimaryColor(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CD] bg-white px-2.5 py-1.5 font-mono text-xs text-[#18181B] focus:border-[#166534] focus:outline-none"
                  />
                </div>
              </div>

              <div
                dir="ltr"
                className="rounded-lg bg-white px-3 py-2 font-mono text-xs text-[#18181B] border border-[#E5E5E0] break-all"
              >
                {webScriptSnippet}
              </div>
              <p className="text-[11px] text-[#57534E]">
                انسخ هذا السطر وضعه قبل وسم <code className="font-mono">&lt;/body&gt;</code> في موقع الشركة
                (WordPress أو HTML أو Next.js) ليظهر زر الشات العائم بدعم الكتابة والتسجيل الصوتي وقراءة
                الردود.
              </p>
            </div>

            {/* Python Modular RAG + FastAPI + ChromaDB + Streamlit Bundle */}
            <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#166534]">
                  <Database className="h-4 w-4" />
                  <span>4. حزمة Python المعيارية (FastAPI + ChromaDB + Google Sheets + Streamlit)</span>
                </span>
                <a
                  href="/api/python-bundle.zip"
                  download="agripulse-organic-python-rag.zip"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#166534] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#14532D] shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>تحميل حزمة Python ZIP</span>
                </a>
              </div>
              <p className="text-[11px] text-[#57534E] leading-relaxed">
                تحتوي على تكامل <code className="font-mono">google-genai</code> (<code className="font-mono">gemini-2.5-flash</code>) + مزامنة <code className="font-mono">gspread / google-api-python-client</code> الحية + مخزن متجهات <code className="font-mono">chromadb</code> + واجهات اختبار <code className="font-mono">Streamlit</code> و<code className="font-mono">CLI</code> وويبهوكس <code className="font-mono">FastAPI</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal 5: ToR Evaluation Criteria (KPIs) & Installation / Configuration / Maintenance Guide */}
      {activeModal === "tor_docs" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[#E5E5E0] bg-white shadow-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E5E0] px-5 py-4 shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-[#166534]" />
                <div>
                  <h2 className="text-base font-bold text-[#18181B]">
                    معايير التقييم والدليل التشغيلي — مشروع (SI/EoL & EBDA)
                  </h2>
                  <p className="text-xs text-[#57534E]">
                    مقاييس التفاعل ورضا المزارعين + دليل التثبيت والإعداد والصيانة الدورية
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

            <div className="flex items-center gap-2 border-b border-[#E5E5E0] bg-[#FAF9F6] px-5 py-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setTorTab("kpis")}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  torTab === "kpis"
                    ? "bg-[#166534] text-white"
                    : "bg-white text-[#57534E] border border-[#E5E5E0] hover:text-[#18181B]"
                }`}
              >
                1. مقاييس التفاعل ورضا المستخدمين (KPIs)
              </button>
              <button
                type="button"
                onClick={() => setTorTab("docs")}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  torTab === "docs"
                    ? "bg-[#166534] text-white"
                    : "bg-white text-[#57534E] border border-[#E5E5E0] hover:text-[#18181B]"
                }`}
              >
                2. دليل التثبيت والإعداد والصيانة
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs leading-relaxed">
              {torTab === "kpis" ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-3.5 space-y-1">
                      <div className="text-[#57534E]">المستخدمون النشطون</div>
                      <div className="text-xl font-bold text-[#18181B] font-mono tabular-nums">
                        {metrics?.active_users_count ?? 0}
                      </div>
                      <div className="text-[11px] text-[#78716C] tabular-nums">
                        إجمالي الرسائل: {metrics?.total_messages_count ?? 0}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-3.5 space-y-1">
                      <div className="text-[#57534E]">مستوى رضا المستخدمين</div>
                      <div className="text-xl font-bold text-[#166534] font-mono tabular-nums">
                        {metrics?.satisfaction_rate_pct ?? 100}%
                      </div>
                      <div className="text-[11px] text-[#78716C] tabular-nums">
                        إيجابي: {metrics?.thumbs_up ?? 0} · سلبي: {metrics?.thumbs_down ?? 0}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-3.5 space-y-1">
                      <div className="text-[#57534E]">معدل الاحتفاظ والتفاعل</div>
                      <div className="text-xl font-bold text-[#18181B] font-mono tabular-nums">
                        {metrics?.retention_rate_pct ?? 0}%
                      </div>
                      <div className="text-[11px] text-[#78716C] tabular-nums">
                        جلسات متعددة الاستفسارات ({metrics?.retained_users_count ?? 0})
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-3.5 space-y-1">
                      <div className="text-[#57534E]">مزارع مسجلة (EBDA/EoL)</div>
                      <div className="text-xl font-bold text-[#166534] font-mono tabular-nums">
                        {metrics?.registered_farms_count ?? registrations.length}
                      </div>
                      <div className="text-[11px] text-[#78716C] tabular-nums">
                        رسائل صوتية: {metrics?.voice_messages_count ?? 0}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2">
                    <div className="font-bold text-[#18181B]">
                      توزيع الاستفسارات عبر القنوات (واتساب · فيسبوك ماسنجر · الموقع)
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div className="rounded-lg border border-[#E5E5E0] bg-white p-2.5">
                        <div className="text-[#008069] font-semibold">واتساب (WhatsApp)</div>
                        <div className="text-sm font-bold font-mono tabular-nums mt-0.5">
                          {metrics?.channels_breakdown.whatsapp ?? 0} استفسار
                        </div>
                      </div>
                      <div className="rounded-lg border border-[#E5E5E0] bg-white p-2.5">
                        <div className="text-[#1D4ED8] font-semibold">فيسبوك (Messenger)</div>
                        <div className="text-sm font-bold font-mono tabular-nums mt-0.5">
                          {metrics?.channels_breakdown.messenger ?? 0} استفسار
                        </div>
                      </div>
                      <div className="rounded-lg border border-[#E5E5E0] bg-white p-2.5">
                        <div className="text-[#166534] font-semibold">الموقع (Web Widget)</div>
                        <div className="text-sm font-bold font-mono tabular-nums mt-0.5">
                          {metrics?.channels_breakdown.widget ?? 0} استفسار
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-[#18181B]">
                          مزامنة قواعد البيانات الخارجية الحية (الطقس الزراعي + التربة + أسعار المدخلات)
                        </div>
                        <p className="text-[#57534E]">
                          تحديث بيانات Open-Meteo مصر وخصوبة التربة ومؤشر المدخلات العضوية داخل محرك الـ RAG
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={syncingConnectors}
                        onClick={handleSyncLiveConnectors}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#166534] px-3 py-2 text-xs font-semibold text-white hover:bg-[#14532D] disabled:opacity-50 shrink-0"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${syncingConnectors ? "animate-spin" : ""}`} />
                        <span>{syncingConnectors ? "جاري التحديث..." : "تحديث البيانات الحية"}</span>
                      </button>
                    </div>
                    {connectorNotice && (
                      <div className="rounded-lg border border-[#166534]/25 bg-[#F0FDF4] px-3 py-2 text-[#14532D]">
                        {connectorNotice}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-3 text-[#18181B]">
                  <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-1.5">
                    <div className="font-bold text-[#166534]">
                      1. خلفية المشروع والشركاء (EBDA & SI/EoL)
                    </div>
                    <p className="text-[#57534E]">
                      يدعم المشروع الألماني-المصري لتعزيز المسار المهني في القطاع البيئي في مصر (مشروع{" "}
                      <strong>SI/EoL</strong>) الممول من الوزارة الاتحادية الألمانية للتعاون الاقتصادي والتنمية (
                      <strong>BMZ</strong>) والمنفذ عبر <strong>bbw gGmbH</strong> و<strong>sequa gGmbH</strong> شريكه{" "}
                      <strong>الجمعية المصرية للزراعة الحيوية (EBDA)</strong> (المؤسسة عام 1990 والمسجلة بوزارة التضامن
                      الاجتماعي) لضم المزارع لمعايير <strong>اقتصاد المحبة (Economy of Love)</strong> وعلامة{" "}
                      <strong>ديميتر (DEMETER)</strong> باللهجة المصرية نصياً وصوتياً.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-1.5">
                    <div className="font-bold text-[#166534]">2. إرشادات التثبيت والتشغيل (Installation)</div>
                    <p className="text-[#57534E]">
                      - <strong>بيئة Node.js + React المتكاملة:</strong> تثبيت الحزم عبر{" "}
                      <code className="font-mono">npm install</code>، ضبط مفتاح{" "}
                      <code className="font-mono">GEMINI_API_KEY</code> في الخادم، ثم التشغيل عبر{" "}
                      <code className="font-mono">npm run build && npm start</code> على المنفذ 3000.
                      <br />- <strong>حزمة Python المعيارية (FastAPI + ChromaDB + Streamlit):</strong> متاحة للتحميل
                      الكامل بصيغة ZIP من نافذة «روابط الربط» وتشغيلها عبر{" "}
                      <code className="font-mono">uvicorn python_backend.main:app --port 8000</code>.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-1.5">
                    <div className="font-bold text-[#166534]">
                      3. إعداد القنوات والصوت وقواعد البيانات (Configuration)
                    </div>
                    <p className="text-[#57534E]">
                      - <strong>واتساب وفيسبوك ماسنجر:</strong> ربط عناوين Webhook الموجودة في نافذة «روابط الربط» في
                      لوحة Meta Developers مع إضافة <code className="font-mono">WHATSAPP_ACCESS_TOKEN</code> و
                      <code className="font-mono">MESSENGER_PAGE_ACCESS_TOKEN</code> (يدعم الرسائل النصية، القوائم
                      التفاعلية، والرسائل الصوتية تلقائياً).
                      <br />- <strong>تحديث المحاصيل والأسئلة الشائعة:</strong> يدعم النظام 67 محصولاً معتمداً، المحاور
                      الـ 7 للزراعة العضوية (عام أو لمحصول)، الـ 11 سؤالاً شائعاً (بما فيها شهادات الكربون وتحاليل
                      المياه)، والمزامنة الفورية مع <strong>Google Sheets</strong>.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#E5E5E0] bg-[#FAF9F6] p-4 space-y-1.5">
                    <div className="font-bold text-[#166534]">4. الصيانة الدورية والتحسين المستمر (Maintenance)</div>
                    <p className="text-[#57534E]">
                      - متابعة مؤشرات رضا المزارعين (مفيد / غير دقيق) أسبوعياً ومراجعة الأسئلة الجديدة لتحديث شيتات
                      الجمعية دون الحاجة لتعديل الكود البرمجي.
                      <br />- تصدير قوائم المزارعين المسجلين بصيغة CSV بضغطة زر من نافذة «التسجيلات» لمتابعة فرق التفتيش
                      والتدريب الميداني.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
