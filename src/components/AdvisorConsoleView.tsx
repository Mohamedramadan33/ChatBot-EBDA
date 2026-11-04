import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Send,
  SlidersHorizontal,
  Sprout,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { ChatMessageRecord, FarmContext, FeedbackItem, SessionRecord } from "../types";

const ADVISOR_AVATAR_URL = "/src/assets/images/avatar_agronomy_advisor_1793692880509.jpg";

const QUICK_TEST_PROMPTS = [
  {
    shortLabel: "اختبار رفض الكيماوي (يوريا ومبيد)",
    prompt:
      "الزرع عندي ضعيف في الـ 10 فدادين وفيه دودة ورق.. أحط كام شيكارة يوريا ونترات وأرش مبيد كيماوي إيه يخلص عليها فوراً؟",
  },
  {
    shortLabel: "تجهيز بطاطس أورجانيك للتصدير",
    prompt:
      "عايز أزرع بطاطس أورجانيك للتصدير في الـ 10 فدادين بتوعي.. إيه مقادير الكمبوست والفيرمي وصخر الفوسفات والفلسبار وصافي الربح المتوقع؟",
  },
  {
    shortLabel: "خلطة دودة الحشد والندوة طبيعياً",
    prompt:
      "ظهرت دودة الحشد الخريفية وبداية ندوة متأخرة في الغيط.. اديني برنامج المكافحة الحيوية الأورجانيك بالمقادير للفدان بدون نقطة كيماوي.",
  },
  {
    shortLabel: "جدوى البابونج والقمح الأورجانيك",
    prompt:
      "قارن لي بين زراعة القمح الأورجانيك والبابونج الطبي الأورجانيك على مساحة 10 فدادين من حيث الخدمة العضوية وصافي العائد بالجنيه.",
  },
];

const FEEDBACK_CATEGORIES = [
  { value: "accurate_actionable", label: "دقيق ومفيد وأورجانيك 100%" },
  { value: "missing_local_data", label: "ينقصه تفصيل من شيت المزرعة" },
  { value: "unit_or_math_issue", label: "ملاحظة في حسبة الفدان أو التكلفة" },
  { value: "outdated_market_price", label: "تحديث سعر مدخل عضوي" },
  { value: "incomplete_citation", label: "يحتاج استشهاد أدق من الشيت" },
];

interface AdvisorConsoleViewProps {
  session: SessionRecord | null;
  feedbackByMessageId: Record<string, FeedbackItem>;
  onSendMessage: (text: string) => Promise<void>;
  onSaveContext: (patch: FarmContext) => Promise<void>;
  onSubmitFeedback: (
    messageId: string,
    rating: 1 | -1,
    category: string,
    comment: string
  ) => Promise<void>;
  onOpenGoogleSheets?: () => void;
  sending: boolean;
  errorMsg: string | null;
}

export const AdvisorConsoleView: React.FC<AdvisorConsoleViewProps> = ({
  session,
  feedbackByMessageId,
  onSendMessage,
  onSaveContext,
  onSubmitFeedback,
  onOpenGoogleSheets,
  sending,
  errorMsg,
}) => {
  const [input, setInput] = useState("");
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});
  const [activeFeedbackForm, setActiveFeedbackForm] = useState<{
    messageId: string;
    rating: 1 | -1;
    category: string;
    comment: string;
  } | null>(null);
  const [submittingFb, setSubmittingFb] = useState(false);
  const [showContextDrawer, setShowContextDrawer] = useState(true);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const [draftCtx, setDraftCtx] = useState<FarmContext>({
    farm_name: "مزرعة الخير الأورجانيك (وضع الاختبار)",
    region: "البحيرة / النوبارية - أرض عضوية",
    latitude: 30.6667,
    longitude: 30.0667,
    farm_size_ha: 10,
    primary_crops: "طماطم أورجانيك، قمح عضوي، بطاطس، أعشاب طبية (بابونج ونعناع)",
    soil_type: "رملية طميية مخدومة بالكمبوست والفيرمي كمبوست",
    soil_ph: 7.5,
    irrigation_type: "ري بالتنقيط مع حقن شاي الكمبوست والبكتيريا الحيوية",
    currency: "EGP",
  });
  const [ctxSavedToast, setCtxSavedToast] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (session?.farm_context) {
      setDraftCtx(session.farm_context);
    }
  }, [session?.session_id, session?.farm_context]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, sending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    await onSendMessage(text);
  };

  const handleQuickPrompt = async (q: string) => {
    if (sending) return;
    await onSendMessage(q);
  };

  const handleContextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveContext(draftCtx);
    setCtxSavedToast(true);
    setTimeout(() => setCtxSavedToast(false), 2000);
  };

  const openRating = (msg: ChatMessageRecord, rating: 1 | -1) => {
    const existing = feedbackByMessageId[msg.message_id];
    setActiveFeedbackForm({
      messageId: msg.message_id,
      rating,
      category:
        existing?.category || (rating === 1 ? "accurate_actionable" : "missing_local_data"),
      comment: existing?.comment || "",
    });
  };

  const saveRating = async () => {
    if (!activeFeedbackForm) return;
    setSubmittingFb(true);
    try {
      await onSubmitFeedback(
        activeFeedbackForm.messageId,
        activeFeedbackForm.rating,
        activeFeedbackForm.category,
        activeFeedbackForm.comment
      );
      setActiveFeedbackForm(null);
    } finally {
      setSubmittingFb(false);
    }
  };

  const messages = session?.messages || [];

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Main RAG Conversation Column */}
      <div className="flex min-h-0 flex-1 flex-col bg-[#FAF9F6]">
        {/* Sub-toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E5E0] bg-white px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {!avatarFailed ? (
              <img
                src={ADVISOR_AVATAR_URL}
                alt="المهندس الزراعي الأورجانيك"
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className="h-9 w-9 shrink-0 rounded-full object-cover border border-[#E5E5E0]"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534]">
                <Sprout className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#18181B] truncate">
                المستشار الزراعي الأورجانيك 100% — وضع الاختبار الشخصي المباشر
              </h2>
              <p className="text-xs text-[#57534E] tabular-nums truncate">
                جلسة الاختبار: {session?.session_id || "widget:organic-test"} · المساحة{" "}
                {draftCtx.farm_size_ha} فدان · pH التربة {draftCtx.soil_ph} · ممنوع الكيماويات نهائياً
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenGoogleSheets && (
              <button
                type="button"
                onClick={onOpenGoogleSheets}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#166534]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#166534] hover:bg-[#FAF9F6] transition-colors whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>ربط Google Sheet الخاص بك</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowContextDrawer((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-[#18181B] hover:bg-[#EFECE6] transition-colors whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#57534E]" />
              <span>{showContextDrawer ? "إخفاء بيانات المزرعة" : "تعديل بيانات المزرعة"}</span>
            </button>
          </div>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl py-6">
              <h3 className="text-lg font-semibold text-[#18181B] text-balance">
                جاهز للاختبار الشخصي الآن قبل إتاحة النظام للمزارعين
              </h3>
              <p className="mt-1.5 text-sm text-[#57534E] leading-relaxed">
                البرنامج مربوط حالياً بشيت جوجل التجريبي للزراعة الأورجانيك وقواعد المكافحة الحيوية
                المعتمدة. جرّب أي سؤال بالعامية المصرية أو اختبره بطلب سماد أو مبيد كيماوي للتأكد من
                رفضه القاطع وإعطاء البديل العضوي للفدان.
              </p>
            </div>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const citationsOpen = !!expandedCitations[msg.message_id];
            const existingFb = feedbackByMessageId[msg.message_id];
            const isEditingThisFb = activeFeedbackForm?.messageId === msg.message_id;

            if (isUser) {
              return (
                <div key={msg.message_id} className="flex justify-start">
                  <div className="max-w-2xl rounded-xl bg-[#18181B] px-4 py-3 text-sm text-white leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.message_id}
                className="mx-auto max-w-3xl rounded-xl border border-[#E5E5E0] bg-white p-5"
              >
                {/* Unboxed Metadata Line */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EEE9] pb-2.5 text-xs text-[#57534E] tabular-nums">
                  <div>
                    <span>رد المهندس الأورجانيك (0% كيماوي)</span>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span dir="ltr">{msg.model_used || "gemini-2.5-flash"}</span>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span>{msg.citations?.length || 0} مصادر مسترجعة من الشيت</span>
                    {msg.latency_ms > 0 && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span>{(msg.latency_ms / 1000).toFixed(2)} ثانية</span>
                      </>
                    )}
                  </div>
                  {msg.citations && msg.citations.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCitations((prev) => ({
                          ...prev,
                          [msg.message_id]: !prev[msg.message_id],
                        }))
                      }
                      className="inline-flex items-center gap-1 font-medium text-[#166534] hover:underline whitespace-nowrap shrink-0"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>
                        {citationsOpen ? "إخفاء صفوف الشيت المسترجعة" : "عرض المصادر وصفوف الشيت"}
                      </span>
                      {citationsOpen ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Markdown Content */}
                <div className="prose prose-sm max-w-none text-[#18181B] prose-headings:font-semibold prose-headings:text-[#18181B] prose-p:leading-relaxed prose-li:my-0.5 prose-table:text-xs prose-th:bg-[#FAF9F6] prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-[#E5E5E0]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>

                {/* Expandable RAG Chunks Drawer */}
                {citationsOpen && msg.citations && msg.citations.length > 0 && (
                  <div className="mt-4 border-t border-[#E5E5E0] pt-3.5 space-y-2.5">
                    <div className="text-xs font-semibold text-[#18181B]">
                      البيانات الحقيقية المسترجعة من Google Sheets وقاعدة المعرفة الأورجانيك
                    </div>
                    {msg.citations.map((cite, idx) => (
                      <div
                        key={`${msg.message_id}_${cite.id}_${idx}`}
                        className="rounded-lg bg-[#FAF9F6] p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[#57534E] font-mono tabular-nums">
                          <span>
                            [{idx + 1}] {cite.source} · {cite.section}
                          </span>
                          <span dir="ltr">
                            {cite.format} · Sim {cite.similarity.toFixed(3)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[#18181B] leading-relaxed">{cite.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* User Feedback Rating & Comment Controls */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EEE9] pt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#57534E]">تقييم الرد أثناء الاختبار:</span>
                    <button
                      type="button"
                      onClick={() => openRating(msg, 1)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        existingFb?.rating === 1
                          ? "bg-[#166534] text-white"
                          : "border border-[#E5E5E0] bg-[#FAF9F6] text-[#18181B] hover:bg-[#EFECE6]"
                      }`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span>ممتاز ومظبوط</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openRating(msg, -1)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        existingFb?.rating === -1
                          ? "bg-[#B91C1C] text-white"
                          : "border border-[#E5E5E0] bg-[#FAF9F6] text-[#18181B] hover:bg-[#EFECE6]"
                      }`}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                      <span>تعديل / ملاحظة</span>
                    </button>
                  </div>

                  {existingFb && !isEditingThisFb && (
                    <span className="text-xs text-[#57534E]">
                      تم حفظ تقييمك ({existingFb.rating === 1 ? "+1 معتمد" : "-1 يحتاج تعديل"}
                      {existingFb.comment ? ` · "${existingFb.comment.slice(0, 48)}"` : ""})
                    </span>
                  )}
                </div>

                {isEditingThisFb && activeFeedbackForm && (
                  <div className="mt-3 rounded-lg bg-[#FAF9F6] p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#18181B]">
                        {activeFeedbackForm.rating === 1
                          ? "تأكيد اعتماد التوصية الأورجانيك (+1)"
                          : "تسجيل ملاحظة لتحسين قاعدة المعرفة الأورجانيك (-1)"}
                      </span>
                      <select
                        value={activeFeedbackForm.category}
                        onChange={(e) =>
                          setActiveFeedbackForm({
                            ...activeFeedbackForm,
                            category: e.target.value,
                          })
                        }
                        className="rounded-md border border-[#E5E5E0] bg-white px-2.5 py-1 text-xs text-[#18181B]"
                      >
                        {FEEDBACK_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="text"
                      value={activeFeedbackForm.comment}
                      onChange={(e) =>
                        setActiveFeedbackForm({
                          ...activeFeedbackForm,
                          comment: e.target.value,
                        })
                      }
                      placeholder="اكتب ملاحظتك هنا (مثلاً: تعديل معدل شاي الكمبوست أو إضافة صنف جديد)..."
                      className="w-full rounded-md border border-[#E5E5E0] bg-white px-3 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:outline-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveFeedbackForm(null)}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-[#57534E] hover:text-[#18181B] whitespace-nowrap shrink-0"
                      >
                        إلغاء
                      </button>
                      <button
                        type="button"
                        disabled={submittingFb}
                        onClick={saveRating}
                        className="rounded-md bg-[#166534] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#14532D] disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {submittingFb ? "جاري الحفظ..." : "حفظ التقييم"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {sending && (
            <div className="mx-auto max-w-3xl rounded-xl border border-[#E5E5E0] bg-white p-5 space-y-2.5">
              <div className="text-xs text-[#57534E]">
                جاري البحث في بيانات Google Sheets الأورجانيك وتجهيز الرد بالعامية المصرية...
              </div>
              <div className="h-3 w-3/4 rounded bg-[#EFECE6]" />
              <div className="h-3 w-1/2 rounded bg-[#EFECE6]" />
            </div>
          )}

          {errorMsg && (
            <div className="mx-auto max-w-3xl rounded-lg border border-[#DC2626]/30 bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]">
              خطأ: {errorMsg}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Quick Test Strip + Prompt Input Bar */}
        <div className="border-t border-[#E5E5E0] bg-white px-4 py-3.5 space-y-2.5">
          <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-x-auto pb-0.5">
            <span className="text-[11px] font-medium text-[#57534E] whitespace-nowrap shrink-0">
              أسئلة اختبار سريعة:
            </span>
            {QUICK_TEST_PROMPTS.map((item) => (
              <button
                key={item.shortLabel}
                type="button"
                disabled={sending}
                onClick={() => handleQuickPrompt(item.prompt)}
                className="rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-2.5 py-1 text-xs text-[#18181B] hover:border-[#166534] hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {item.shortLabel}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-center gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اسأل أي سؤال زراعي بالعامية المصرية (أو جرب تسأله عن يوريا أو مبيد كيماوي عشان تختبره)..."
              className="flex-1 rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] px-4 py-2.5 text-sm text-[#18181B] placeholder:text-[#78716C] focus:border-[#166534] focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#166534] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#14532D] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="h-4 w-4" />
              <span>اسأل المهندس</span>
            </button>
          </form>
        </div>
      </div>

      {/* Persistent Session Farm Profile Drawer */}
      {showContextDrawer && (
        <aside className="w-full border-t border-[#E5E5E0] bg-white p-5 lg:w-80 lg:border-s lg:border-t-0 overflow-y-auto shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#18181B]">بيانات الأرض الأورجانيك</h3>
            {ctxSavedToast && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#166534]">
                <Check className="h-3.5 w-3.5" /> تم الحفظ
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[#57534E] leading-relaxed">
            غيّر المساحة بالفدان أو المحصول هنا لاختبار كيف يحسب البوت الكمبوست والفيرمي كمبوست
            والرش الحيوي لمزرعتك تلقائياً.
          </p>

          <form onSubmit={handleContextSubmit} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#44403C]">اسم المزرعة / التجربة</label>
              <input
                type="text"
                value={draftCtx.farm_name}
                onChange={(e) => setDraftCtx({ ...draftCtx, farm_name: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#44403C]">المحافظة / المنطقة</label>
              <input
                type="text"
                value={draftCtx.region}
                onChange={(e) => setDraftCtx({ ...draftCtx, region: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-[#44403C]">المساحة (فدان)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={draftCtx.farm_size_ha}
                  onChange={(e) =>
                    setDraftCtx({ ...draftCtx, farm_size_ha: Number(e.target.value) || 1 })
                  }
                  className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-mono tabular-nums text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C]">حموضة التربة pH</label>
                <input
                  type="number"
                  step="0.1"
                  min="4.5"
                  max="9.5"
                  value={draftCtx.soil_ph}
                  onChange={(e) =>
                    setDraftCtx({ ...draftCtx, soil_ph: Number(e.target.value) || 7.5 })
                  }
                  className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-mono tabular-nums text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-[#44403C]">خط العرض (Lat)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={draftCtx.latitude}
                  onChange={(e) =>
                    setDraftCtx({ ...draftCtx, latitude: Number(e.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-mono tabular-nums text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C]">خط الطول (Lon)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={draftCtx.longitude}
                  onChange={(e) =>
                    setDraftCtx({ ...draftCtx, longitude: Number(e.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-mono tabular-nums text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#44403C]">المحاصيل الأورجانيك</label>
              <input
                type="text"
                value={draftCtx.primary_crops}
                onChange={(e) => setDraftCtx({ ...draftCtx, primary_crops: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#44403C]">نوع التربة</label>
              <select
                value={draftCtx.soil_type}
                onChange={(e) => setDraftCtx({ ...draftCtx, soil_type: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              >
                <option value="رملية طميية مخدومة بالكمبوست والفيرمي كمبوست">
                  رملية طميية مخدومة بالكمبوست والفيرمي
                </option>
                <option value="طينية خصبة (وادي ودلتا النيل) عضوية">
                  طينية خصبة (وادي ودلتا النيل) عضوية
                </option>
                <option value="رملية مستصلحة تحت التحول العضوي">
                  رملية مستصلحة تحت التحول العضوي
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#44403C]">نظام الري والتسميد الحيوي</label>
              <input
                type="text"
                value={draftCtx.irrigation_type}
                onChange={(e) => setDraftCtx({ ...draftCtx, irrigation_type: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-[#18181B] px-4 py-2 text-xs font-medium text-white hover:bg-[#27272A] transition-colors whitespace-nowrap"
            >
              حفظ بيانات المزرعة
            </button>
          </form>
        </aside>
      )}
    </div>
  );
};
