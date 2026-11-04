import React, { useEffect, useState } from "react";
import { Check, Copy, Send, ShieldCheck, Sprout } from "lucide-react";
import type { WebhookLogEntry } from "../types";

const HERO_FIELD_URL = "/src/assets/images/hero_agronomy_field_1793692879405.jpg";

interface ChannelWebhooksViewProps {
  onSessionActivity: () => Promise<void>;
}

export const ChannelWebhooksView: React.FC<ChannelWebhooksViewProps> = ({
  onSessionActivity,
}) => {
  const [activeChannel, setActiveChannel] = useState<"whatsapp" | "messenger" | "widget">(
    "whatsapp"
  );
  const [logs, setLogs] = useState<WebhookLogEntry[]>([]);
  const [waVerifyToken, setWaVerifyToken] = useState("agripulse_wa_verify_2026");
  const [fbVerifyToken, setFbVerifyToken] = useState("agripulse_fb_verify_2026");

  // WhatsApp simulator state (Egyptian Farmer testing before launch)
  const [waPhone, setWaPhone] = useState("201009876543");
  const [waName, setWaName] = useState("الحاج محمود (مزرعة أورجانيك - تجربة)");
  const [waMessage, setWaMessage] = useState(
    "يا بشمهندس ظهر عندي ذبابة بيضا ومن على الطماطم الأورجانيك.. أرش صابون بوتاسي وزيت نيم بمعدل كام للفدان؟"
  );
  const [waTranscript, setWaTranscript] = useState<
    Array<{ role: "user" | "assistant"; text: string; latency?: number }>
  >([]);

  // Messenger simulator state
  const [fbPsid, setFbPsid] = useState("psid_egypt_org_01");
  const [fbMessage, setFbMessage] = useState(
    "إيه خطوات تحويل أرضي لزراعة أورجانيك معتمدة للتصدير حسب القانون المصري 12 لسنة 2020 بدون أي كيماويات؟"
  );
  const [fbTranscript, setFbTranscript] = useState<
    Array<{ role: "user" | "assistant"; text: string; latency?: number }>
  >([]);

  // Widget live portal state
  const [widgetMessage, setWidgetMessage] = useState(
    "عايز برنامج شاي الفيرمي كمبوست والبكتيريا المذيبة للبوتاسيوم لتحجيم البطاطس الأورجانيك."
  );
  const [widgetTranscript, setWidgetTranscript] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([
    {
      role: "assistant",
      text: "أهلاً بيك! اسألني أي سؤال في التسميد العضوي أو المكافحة الحيوية الأورجانيك 100% بدون نقطة كيماوي.",
    },
  ]);
  const [heroFailed, setHeroFailed] = useState(false);

  const [sending, setSending] = useState(false);
  const [verifyBanner, setVerifyBanner] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<WebhookLogEntry | null>(null);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  const loadLogs = async () => {
    try {
      const res = await fetch("/api/webhooks/logs");
      const data = await res.json();
      setLogs(data.logs || []);
      if (data.whatsapp_verify_token) setWaVerifyToken(data.whatsapp_verify_token);
      if (data.messenger_verify_token) setFbVerifyToken(data.messenger_verify_token);
      if (!selectedLog && data.logs?.length > 0) {
        setSelectedLog(data.logs[0]);
      }
    } catch {
      // ignore transient error
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const testVerifyHandshake = async (channel: "whatsapp" | "messenger") => {
    const token = channel === "whatsapp" ? waVerifyToken : fbVerifyToken;
    const challenge = `challenge_${Math.floor(100000 + Math.random() * 900000)}`;
    const url = `/webhooks/${channel}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      token
    )}&hub.challenge=${challenge}`;
    const res = await fetch(url);
    const body = await res.text();
    setVerifyBanner(
      res.ok
        ? `نجح تحقق Meta الرسمي: GET /webhooks/${channel} رجع HTTP 200 مع الكود: ${body}`
        : `فشل التحقق (HTTP ${res.status}): ${body}`
    );
    await loadLogs();
  };

  const sendWhatsAppWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waMessage.trim() || sending) return;
    const text = waMessage.trim();
    setWaMessage("");
    setWaTranscript((prev) => [...prev, { role: "user", text }]);
    setSending(true);
    try {
      const metaPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA_ORGANIC_EGYPT_01",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "201000000000",
                    phone_number_id: "1092837465",
                  },
                  contacts: [{ profile: { name: waName }, wa_id: waPhone }],
                  messages: [
                    {
                      from: waPhone,
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
      };

      const res = await fetch("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metaPayload),
      });
      const data = await res.json();
      const first = data.results?.[0];
      if (first?.answer) {
        setWaTranscript((prev) => [
          ...prev,
          { role: "assistant", text: first.answer, latency: first.latency_ms },
        ]);
      }
      await loadLogs();
      await onSessionActivity();
    } finally {
      setSending(false);
    }
  };

  const sendMessengerWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fbMessage.trim() || sending) return;
    const text = fbMessage.trim();
    setFbMessage("");
    setFbTranscript((prev) => [...prev, { role: "user", text }]);
    setSending(true);
    try {
      const metaPayload = {
        object: "page",
        entry: [
          {
            id: "PAGE_ORGANIC_COOP_EG",
            time: Date.now(),
            messaging: [
              {
                sender: { id: fbPsid },
                recipient: { id: "PAGE_ORGANIC_COOP_EG" },
                timestamp: Date.now(),
                message: {
                  mid: `m_${Date.now()}`,
                  text,
                },
              },
            ],
          },
        ],
      };
      const res = await fetch("/webhooks/messenger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metaPayload),
      });
      const data = await res.json();
      const first = data.results?.[0];
      if (first?.answer) {
        setFbTranscript((prev) => [
          ...prev,
          { role: "assistant", text: first.answer, latency: first.latency_ms },
        ]);
      }
      await loadLogs();
      await onSessionActivity();
    } finally {
      setSending(false);
    }
  };

  const sendWidgetWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!widgetMessage.trim() || sending) return;
    const text = widgetMessage.trim();
    setWidgetMessage("");
    setWidgetTranscript((prev) => [...prev, { role: "user", text }]);
    setSending(true);
    try {
      const res = await fetch("/webhooks/widget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "widget:organic-portal-demo",
          channel: "widget",
          external_user_id: "portal-organic-tester",
          profile_name: "زائر نافذة الموقع الأورجانيك",
          message: text,
        }),
      });
      const data = await res.json();
      if (data.answer) {
        setWidgetTranscript((prev) => [...prev, { role: "assistant", text: data.answer }]);
      }
      await loadLogs();
      await onSessionActivity();
    } finally {
      setSending(false);
    }
  };

  const embedSnippet = `<script
  src="${window.location.origin}/agripulse-widget.js"
  data-webhook="${window.location.origin}/webhooks/widget"
  data-channel="widget"
  async
></script>`;

  const copySnippet = () => {
    navigator.clipboard.writeText(embedSnippet);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 1800);
  };

  return (
    <div className="h-full overflow-y-auto bg-[#FAF9F6] p-6 space-y-6">
      {/* Channel Segmented Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E5E0] pb-5">
        <div>
          <h2 className="text-base font-semibold text-[#18181B]">
            محاكي قنوات المزارعين (اختبر واتساب والماسنجر والموقع قبل إدخال المزارعين)
          </h2>
          <p className="mt-0.5 text-xs text-[#57534E]">
            اختبر بنفسك الآن كيف سيرد البوت على المزارعين عبر WhatsApp Business API وFacebook
            Messenger من نفس بيانات شيت جوجل الأورجانيك قبل نشر الرابط لهم.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#EFECE6] p-1">
          <button
            type="button"
            onClick={() => setActiveChannel("whatsapp")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeChannel === "whatsapp"
                ? "bg-white text-[#18181B] shadow-xs"
                : "text-[#57534E] hover:text-[#18181B]"
            }`}
          >
            واتساب للأعمال (WhatsApp)
          </button>
          <button
            type="button"
            onClick={() => setActiveChannel("messenger")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeChannel === "messenger"
                ? "bg-white text-[#18181B] shadow-xs"
                : "text-[#57534E] hover:text-[#18181B]"
            }`}
          >
            فيسبوك ماسنجر (Messenger)
          </button>
          <button
            type="button"
            onClick={() => setActiveChannel("widget")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeChannel === "widget"
                ? "bg-white text-[#18181B] shadow-xs"
                : "text-[#57534E] hover:text-[#18181B]"
            }`}
          >
            نافذة الموقع (Website Widget)
          </button>
        </div>
      </div>

      {verifyBanner && (
        <div className="rounded-lg border border-[#166534]/30 bg-white px-4 py-2.5 text-xs font-mono text-[#166534]">
          {verifyBanner}
        </div>
      )}

      {/* Active Simulator Panel */}
      {activeChannel === "whatsapp" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 rounded-xl border border-[#E5E5E0] bg-white p-5 flex flex-col justify-between space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EEE9] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#18181B]">
                  محاكي رسائل واتساب للمزارعين (Meta Cloud API)
                </h3>
                <p className="text-xs text-[#57534E] font-mono tabular-nums" dir="ltr">
                  POST /webhooks/whatsapp · Session whatsapp:{waPhone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => testVerifyHandshake("whatsapp")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-[#18181B] hover:bg-[#EFECE6] whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#166534]" />
                <span>اختبار تحقق Meta (GET)</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#44403C]">رقم واتساب التجريبي</label>
                <input
                  type="text"
                  dir="ltr"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C]">اسم المزارع في التجربة</label>
                <input
                  type="text"
                  value={waName}
                  onChange={(e) => setWaName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs"
                />
              </div>
            </div>

            <div className="min-h-[220px] max-h-[280px] overflow-y-auto rounded-lg bg-[#FAF9F6] p-4 space-y-3">
              {waTranscript.length === 0 && (
                <p className="text-xs text-[#57534E]">
                  اضغط «إرسال رسالة واتساب تجريبية» تحت عشان تتأكد من طريقة رد البوت الأورجانيك قبل
                  ربط رقم واتساب الرسمي للمزارعين.
                </p>
              )}
              {waTranscript.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-md rounded-lg px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-[#166534] text-white"
                        : "bg-white border border-[#E5E5E0] text-[#18181B]"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="text-xs text-[#57534E]">جاري معالجة رسالة واتساب الأورجانيك...</div>
              )}
            </div>

            <form onSubmit={sendWhatsAppWebhook} className="flex items-center gap-2.5">
              <input
                type="text"
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder="اكتب سؤال مزارع على واتساب لاختبار الرد الأورجانيك..."
                className="flex-1 rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] px-3.5 py-2 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !waMessage.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#166534] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#14532D] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>إرسال رسالة واتساب تجريبية</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-[#E5E5E0] bg-white p-5 flex flex-col justify-between space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-[#18181B]">
                إعداد ربط واتساب لاحقاً بعد انتهاء اختبارك
              </h3>
              <p className="mt-1 text-xs text-[#57534E] leading-relaxed">
                لما تخلص اختبارك وتحب تدخل المزارعين، اربط لوحة Meta على المسار `/webhooks/whatsapp`
                باستخدام رمز التحقق `{waVerifyToken}`.
              </p>
            </div>
            <pre
              dir="ltr"
              className="flex-1 overflow-x-auto rounded-lg bg-[#18181B] p-3.5 font-mono text-[11px] leading-relaxed text-[#E4E4E7]"
            >
{`# Outbound Graph API v21.0 Dispatch Contract
POST https://graph.facebook.com/v21.0/{PHONE_ID}/messages
Authorization: Bearer $WHATSAPP_ACCESS_TOKEN

{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "${waPhone}",
  "type": "text",
  "text": {
    "preview_url": false,
    "body": "<رد زراعي أورجانيك 100% بالعامية المصرية>"
  }
}`}
            </pre>
          </div>
        </div>
      )}

      {activeChannel === "messenger" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 rounded-xl border border-[#E5E5E0] bg-white p-5 flex flex-col justify-between space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EEE9] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#18181B]">
                  محاكي رسائل صفحة فيسبوك ماسنجر
                </h3>
                <p className="text-xs text-[#57534E] font-mono tabular-nums" dir="ltr">
                  POST /webhooks/messenger · Session messenger:{fbPsid}
                </p>
              </div>
              <button
                type="button"
                onClick={() => testVerifyHandshake("messenger")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-[#18181B] hover:bg-[#EFECE6] whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#166534]" />
                <span>اختبار تحقق Meta (GET)</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#44403C]">
                معرف المرسل التجريبي (PSID)
              </label>
              <input
                type="text"
                dir="ltr"
                value={fbPsid}
                onChange={(e) => setFbPsid(e.target.value)}
                className="mt-1 w-full max-w-xs rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-3 py-1.5 text-xs font-mono tabular-nums"
              />
            </div>

            <div className="min-h-[220px] max-h-[280px] overflow-y-auto rounded-lg bg-[#FAF9F6] p-4 space-y-3">
              {fbTranscript.length === 0 && (
                <p className="text-xs text-[#57534E]">
                  أرسل سؤال ماسنجر تجريبي بالأسفل لاختبار حفظ الجلسة والالتزام بالزراعة الأورجانيك.
                </p>
              )}
              {fbTranscript.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-md rounded-lg px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-[#18181B] text-white"
                        : "bg-white border border-[#E5E5E0] text-[#18181B]"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="text-xs text-[#57534E]">جاري معالجة رسالة ماسنجر...</div>
              )}
            </div>

            <form onSubmit={sendMessengerWebhook} className="flex items-center gap-2.5">
              <input
                type="text"
                value={fbMessage}
                onChange={(e) => setFbMessage(e.target.value)}
                placeholder="اكتب سؤال مزارع عبر صفحة الفيسبوك..."
                className="flex-1 rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] px-3.5 py-2 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !fbMessage.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#18181B] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#27272A] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>إرسال تجربة ماسنجر</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-[#E5E5E0] bg-white p-5 flex flex-col justify-between space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-[#18181B]">
                إعداد صفحة فيسبوك لاحقاً بعد الاختبار
              </h3>
              <p className="mt-1 text-xs text-[#57534E] leading-relaxed">
                عند الجاهزية للنشر، اربط صفحة المزرعة على `/webhooks/messenger` برمز التحقق
                `{fbVerifyToken}`.
              </p>
            </div>
            <pre
              dir="ltr"
              className="flex-1 overflow-x-auto rounded-lg bg-[#18181B] p-3.5 font-mono text-[11px] leading-relaxed text-[#E4E4E7]"
            >
{`# Outbound Messenger Platform v21.0 Dispatch
POST https://graph.facebook.com/v21.0/me/messages?access_token=...

{
  "recipient": { "id": "${fbPsid}" },
  "messaging_type": "RESPONSE",
  "message": {
    "text": "<توصية زراعة عضوية أورجانيك 100%>"
  }
}`}
            </pre>
          </div>
        </div>
      )}

      {activeChannel === "widget" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          {/* Simulated Organic Agribusiness Portal Hosting the Live Widget */}
          <div className="lg:col-span-7 overflow-hidden rounded-xl border border-[#E5E5E0] bg-white flex flex-col">
            <div className="relative h-48 w-full overflow-hidden bg-[#14532D]">
              {!heroFailed ? (
                <img
                  src={HERO_FIELD_URL}
                  alt="حقول زراعة عضوية أورجانيك بالري الحديث"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#14532D] to-[#18181B] text-white">
                  <Sprout className="h-10 w-10 opacity-75" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col justify-end p-5">
                <div className="text-xs text-stone-200">
                  معاينة نافذة الشات المدمجة على موقع المزرعة الأورجانيك
                </div>
                <h3 className="mt-0.5 text-lg font-semibold text-white text-balance">
                  بوابة الإرشاد العضوي الحيوي والتصدير الخالي من الكيماويات
                </h3>
              </div>
            </div>

            <div className="flex-1 p-5 flex flex-col justify-between space-y-4">
              <div className="max-h-[210px] overflow-y-auto space-y-2.5 rounded-lg bg-[#FAF9F6] p-3.5">
                {widgetTranscript.map((m, idx) => (
                  <div
                    key={idx}
                    className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-md rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-[#166534] text-white"
                          : "bg-white border border-[#E5E5E0] text-[#18181B]"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="text-xs text-[#57534E]">جاري استرجاع الإجابة الأورجانيك...</div>
                )}
              </div>

              <form onSubmit={sendWidgetWebhook} className="flex items-center gap-2">
                <input
                  type="text"
                  value={widgetMessage}
                  onChange={(e) => setWidgetMessage(e.target.value)}
                  placeholder="اختبر نافذة الموقع المباشرة (/webhooks/widget)..."
                  className="flex-1 rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] px-3 py-2 text-xs text-[#18181B] focus:border-[#166534] focus:bg-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending || !widgetMessage.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#166534] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#14532D] whitespace-nowrap shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>إرسال</span>
                </button>
              </form>
            </div>
          </div>

          {/* Embed Snippet & REST Spec */}
          <div className="lg:col-span-5 rounded-xl border border-[#E5E5E0] bg-white p-5 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#18181B]">كود التضمين في موقعك لاحقاً</h3>
              <button
                type="button"
                onClick={copySnippet}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E5E0] bg-[#FAF9F6] px-2.5 py-1 text-xs font-medium text-[#18181B] hover:bg-[#EFECE6] whitespace-nowrap shrink-0"
              >
                {copiedEmbed ? (
                  <Check className="h-3.5 w-3.5 text-[#166534]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedEmbed ? "تم النسخ" : "نسخ الكود"}</span>
              </button>
            </div>
            <pre
              dir="ltr"
              className="overflow-x-auto rounded-lg bg-[#18181B] p-3.5 font-mono text-[11px] leading-relaxed text-[#E4E4E7]"
            >
              {embedSnippet}
            </pre>
            <div className="text-xs text-[#57534E] leading-relaxed">
              يرسل الأسئلة مباشرة إلى `POST /webhooks/widget` ويعيد الرد الموثق من شيت جوجل بدون أي
              اشتراكات خارجية.
            </div>
          </div>
        </div>
      )}

      {/* Live Webhook Delivery Log & Raw Payload Inspector */}
      <section className="rounded-xl border border-[#E5E5E0] bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#18181B]">
            سجل طلبات الـ Webhook الحية أثناء الاختبار ({logs.length})
          </h3>
          <span className="text-xs text-[#57534E]">اضغط على أي صف لمعاينة الـ JSON الكامل</span>
        </div>

        {logs.length === 0 ? (
          <p className="text-xs text-[#57534E]">
            لا توجد طلبات مسجلة بعد. جرّب إرسال رسالة واتساب أو ماسنجر أو موقع بالأعلى.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7 overflow-x-auto">
              <table className="w-full text-start border-collapse">
                <thead>
                  <tr className="border-b border-[#E5E5E0] text-xs font-medium text-[#57534E]">
                    <th className="py-2 pe-3 text-start">المسار</th>
                    <th className="py-2 px-3 text-start">المرسل</th>
                    <th className="py-2 px-3 text-end">الحالة</th>
                    <th className="py-2 ps-3 text-end">الزمن</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EEE9] text-xs">
                  {logs.slice(0, 8).map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className={`cursor-pointer transition-colors ${
                        selectedLog?.id === log.id ? "bg-[#FAF9F6]" : "hover:bg-[#FAF9F6]"
                      }`}
                    >
                      <td className="py-2.5 pe-3 font-mono text-[#18181B]" dir="ltr">
                        {log.method} {log.endpoint}
                      </td>
                      <td
                        className="py-2.5 px-3 font-mono text-[#57534E] truncate max-w-[140px]"
                        dir="ltr"
                      >
                        {log.sender_id}
                      </td>
                      <td
                        className="py-2.5 px-3 text-end font-mono tabular-nums text-[#166534]"
                        dir="ltr"
                      >
                        HTTP {log.status_code}
                      </td>
                      <td
                        className="py-2.5 ps-3 text-end font-mono tabular-nums text-[#57534E]"
                        dir="ltr"
                      >
                        {log.latency_ms} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-5">
              {selectedLog && (
                <pre
                  dir="ltr"
                  className="max-h-64 overflow-auto rounded-lg bg-[#18181B] p-3.5 font-mono text-[11px] leading-relaxed text-[#E4E4E7]"
                >
                  {JSON.stringify(
                    {
                      inbound: selectedLog.raw_inbound,
                      outbound: selectedLog.raw_outbound,
                    },
                    null,
                    2
                  )}
                </pre>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
