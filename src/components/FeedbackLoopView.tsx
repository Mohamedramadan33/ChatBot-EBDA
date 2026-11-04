import React, { useState } from "react";
import { ArrowUpLeft, CheckCircle2, ThumbsDown, ThumbsUp } from "lucide-react";
import type { FeedbackItem, FeedbackOverview } from "../types";

interface FeedbackLoopViewProps {
  feedbackData: FeedbackOverview | null;
  onRefreshFeedback: () => Promise<void>;
  onRefreshKnowledge: () => Promise<void>;
}

export const FeedbackLoopView: React.FC<FeedbackLoopViewProps> = ({
  feedbackData,
  onRefreshFeedback,
  onRefreshKnowledge,
}) => {
  const [filter, setFilter] = useState<"all" | "positive" | "negative" | "promoted">("all");
  const [selectedFbId, setSelectedFbId] = useState<string>("");
  const [topicLabel, setTopicLabel] = useState(
    "قاعدة معتمدة لتجهيز شاي الفيرمي كمبوست الهوائي للفدان"
  );
  const [verifiedPassage, setVerifiedPassage] = useState(
    "قاعدة زراعة أورجانيك معتمدة: لتحضير شاي الفيرمي كمبوست الهوائي عالي النشاط البكتيري لـ 1 فدان، ينقع 5 كجم فيرمي كمبوست نقي في 50 لتر مياه خالية من الكلور مع 250 جم عسل أسود طبيعي (مولاس غير مكبرت) مع تشغيل مضخة هواء مستمرة لمدة 24 ساعة في الظل، ويحقن طازجاً في شبكة التنقيط بدون أي إضافات كيماوية."
  );
  const [promoting, setPromoting] = useState(false);
  const [promoteSuccess, setPromoteSuccess] = useState<string | null>(null);

  const summary = feedbackData?.summary || {
    total_ratings: 0,
    thumbs_up: 0,
    thumbs_down: 0,
    approval_rate_pct: 100,
    promoted_golden_chunks: 0,
  };
  const items = feedbackData?.items || [];

  const filteredItems = items.filter((item) => {
    if (filter === "positive") return item.rating === 1;
    if (filter === "negative") return item.rating === -1;
    if (filter === "promoted") return item.promoted_to_rag;
    return true;
  });

  const handleSelectForPromotion = (item: FeedbackItem) => {
    setSelectedFbId(item.feedback_id);
    setTopicLabel(`تصحيح أورجانيك معتمد: ${item.query_text.slice(0, 52) || item.category}`);
    setVerifiedPassage(
      item.promoted_note ||
        `توصية أورجانيك موثقة للسؤال "${item.query_text.slice(0, 90)}": ${
          item.comment ? `[بناءً على ملاحظة الاختبار: ${item.comment}] ` : ""
        }`
    );
  };

  const handlePromoteToRag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicLabel.trim() || !verifiedPassage.trim()) return;
    setPromoting(true);
    setPromoteSuccess(null);
    try {
      const res = await fetch("/api/feedback/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback_id: selectedFbId || undefined,
          topic_label: topicLabel.trim(),
          verified_fact_passage: verifiedPassage.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل ترقية القاعدة");
      setPromoteSuccess(
        `تمت إضافة القاعدة الأورجانيك وتضمينها فوراً في ChromaDB (${data.total_chunks} فقرة نشطة). أي سؤال قادم سيستخدم هذه القاعدة تلقائياً!`
      );
      await onRefreshFeedback();
      await onRefreshKnowledge();
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#FAF9F6] p-6 space-y-8">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 border-b border-[#E5E5E0] pb-6">
        <div>
          <div className="text-xs text-[#57534E]">إجمالي الردود المقيّمة</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#18181B] tabular-nums">
            {summary.total_ratings}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#57534E]">نسبة الاعتماد والرضا</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#166534] tabular-nums">
            {summary.approval_rate_pct}%
          </div>
        </div>
        <div>
          <div className="text-xs text-[#57534E]">ردود ممتازة (+1)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#18181B] tabular-nums">
            {summary.thumbs_up}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#57534E]">ملاحظات تحتاج تعديل (-1)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#B91C1C] tabular-nums">
            {summary.thumbs_down}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#57534E]">قواعد ذهبية مضافة لـ RAG</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#18181B] tabular-nums">
            {summary.promoted_golden_chunks}
          </div>
        </div>
      </div>

      {/* Iterative RAG Curation Workbench */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="lg:col-span-7 rounded-xl border border-[#E5E5E0] bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#18181B]">
                سجل تقييمات الاختبار وملاحظات المهندس الزراعي
              </h2>
              <p className="mt-0.5 text-xs text-[#57534E]">
                أثناء اختبارك للبوت، أي ملاحظة تسجلها على الردود تظهر هنا لتتمكن من تحويلها إلى
                قاعدة دائمة في قاعدة المعرفة قبل فتح النظام للمزارعين.
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-[#EFECE6] p-1">
              {(
                [
                  ["all", "الكل"],
                  ["positive", "معتمد (+1)"],
                  ["negative", "ملاحظات (-1)"],
                  ["promoted", "تمت ترقيته"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    filter === key
                      ? "bg-white text-[#18181B] shadow-xs"
                      : "text-[#57534E] hover:text-[#18181B]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <p className="py-6 text-xs text-[#57534E]">
              لا توجد تقييمات مطابقة لهذا الفلتر. قيّم أي رد في شاشة المستشار الأورجانيك لتظهر هنا.
            </p>
          ) : (
            <div className="divide-y divide-[#E5E5E0]">
              {filteredItems.map((item) => (
                <div key={item.feedback_id} className="py-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 font-medium text-[#18181B]">
                      {item.rating === 1 ? (
                        <ThumbsUp className="h-3.5 w-3.5 text-[#166534]" />
                      ) : (
                        <ThumbsDown className="h-3.5 w-3.5 text-[#B91C1C]" />
                      )}
                      <span>
                        {item.rating === 1 ? "+1 رد معتمد" : "-1 ملاحظة للتطوير"} · {item.category}{" "}
                        · {item.channel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectForPromotion(item)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#166534] hover:underline whitespace-nowrap shrink-0"
                    >
                      <span>تحويل لقاعدة ذهبية في ChromaDB</span>
                      <ArrowUpLeft className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {item.query_text && (
                    <p className="text-xs text-[#18181B]">
                      <span className="font-medium text-[#57534E]">السؤال: </span>
                      {item.query_text}
                    </p>
                  )}

                  {item.comment && (
                    <p className="text-xs text-[#44403C]">
                      <span className="font-medium text-[#57534E]">الملاحظة: </span>"{item.comment}"
                    </p>
                  )}

                  <div className="text-[11px] font-mono text-[#57534E] tabular-nums">
                    المصادر المستخدمة:{" "}
                    {item.retrieved_sources.length > 0
                      ? item.retrieved_sources.join(" · ")
                      : "لا يوجد"}{" "}
                    {item.promoted_to_rag ? "· تمت إضافته لـ ChromaDB" : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right: Closed-Loop Golden Q&A Promotion to ChromaDB */}
        <section className="lg:col-span-5 rounded-xl border border-[#E5E5E0] bg-white p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-[#18181B]">
              تغذية وتدريب قاعدة المعرفة الأورجانيك مباشرة
            </h2>
            <p className="mt-1 text-xs text-[#57534E] leading-relaxed">
              اكتب أي توصية أو خلطة عضوية معتمدة هنا ليتم تحويلها إلى متجهات دلالية داخل ChromaDB
              (`sme_verified_feedback_kb`) ويعتمد عليها البوت فوراً في كل الردود القادمة.
            </p>
          </div>

          <form onSubmit={handlePromoteToRag} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-[#44403C]">
                عنوان القاعدة أو المحصول الأورجانيك
              </label>
              <input
                type="text"
                value={topicLabel}
                onChange={(e) => setTopicLabel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-2 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#44403C]">
                نص التوصية العضوية المعتمدة (100% بدون كيماويات)
              </label>
              <textarea
                rows={5}
                value={verifiedPassage}
                onChange={(e) => setVerifiedPassage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] p-3 text-xs text-[#18181B] leading-relaxed focus:border-[#166534] focus:bg-white focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={promoting}
              className="w-full rounded-lg bg-[#166534] px-4 py-2.5 text-xs font-medium text-white hover:bg-[#14532D] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {promoting ? "جاري التضمين في ChromaDB..." : "اعتماد وحفظ القاعدة في ChromaDB"}
            </button>
          </form>

          {promoteSuccess && (
            <div className="flex items-start gap-2 rounded-lg bg-[#FAF9F6] border border-[#E5E5E0] p-3 text-xs text-[#166534]">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{promoteSuccess}</span>
            </div>
          )}

          {/* Source Precision Audit */}
          {feedbackData && feedbackData.source_audit.length > 0 && (
            <div className="border-t border-[#E5E5E0] pt-4 space-y-2">
              <div className="text-xs font-semibold text-[#18181B]">
                دقة المصادر وشيتات جوجل حسب التقييمات
              </div>
              {feedbackData.source_audit.map((row) => (
                <div
                  key={row.source}
                  className="flex items-center justify-between text-xs font-mono tabular-nums"
                >
                  <span className="text-[#44403C] truncate max-w-[210px]">{row.source}</span>
                  <span className="text-[#57534E]" dir="ltr">
                    +{row.thumbs_up} / -{row.thumbs_down}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
