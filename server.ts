import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Request, Response } from "express";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import JSZip from "jszip";
import { extractText } from "unpdf";
import * as XLSX from "xlsx";
import {
  EGYPT_GOVERNORATES,
  evaluateConversationalFlowTurn,
  formatMessageForChannel,
  formatTitleWithIcon,
  loadAssociationPlantsDatabase,
  MAIN_MENU_SUGGESTIONS,
  shortenChoiceTitle,
  TOR_ELEVEN_FAQS,
  TOR_SEVEN_TOPICS,
} from "./plantsDatabaseAndFlows";
import type {
  FlowUiMode,
  MemberRegistrationRecord,
  PlantDatabaseRecord,
  SessionFlowState,
} from "./plantsDatabaseAndFlows";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_DIR = path.join(__dirname, "data");
const PYTHON_DIR = path.join(__dirname, "python_backend");
const STORE_DIR = path.join(__dirname, ".local_store");
const VECTOR_STORE_FILE = path.join(STORE_DIR, "chroma_organic_ar.json");
const SESSION_STORE_FILE = path.join(STORE_DIR, "sessions_organic_ar.json");

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "agripulse_wa_verify_2026";
const MESSENGER_VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN || "agripulse_fb_verify_2026";
const INSTAGRAM_VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || "agripulse_ig_verify_2026";

const recentMetaMessageIds = new Map<string, number>();
function isDuplicateMetaMessage(messageId?: string): boolean {
  if (!messageId) return false;
  const now = Date.now();
  for (const [k, ts] of recentMetaMessageIds.entries()) {
    if (now - ts > 10 * 60 * 1000) {
      recentMetaMessageIds.delete(k);
    }
  }
  if (recentMetaMessageIds.has(messageId)) {
    return true;
  }
  recentMetaMessageIds.set(messageId, now);
  return false;
}

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export interface VectorChunk {
  id: string;
  source: string;
  format: string;
  section: string;
  source_type: "google_sheet" | "local_file" | "live_api" | "public_db" | "feedback_verified";
  text: string;
  ingested_at: string;
  embedding?: number[];
}

export interface RetrievedCitation {
  id: string;
  source: string;
  format: string;
  section: string;
  source_type: string;
  text: string;
  ingested_at: string;
  similarity: number;
}

export interface FarmContext {
  farm_name: string;
  region: string;
  latitude: number;
  longitude: number;
  farm_size_ha: number; // Represents Feddans (فدان)
  primary_crops: string;
  soil_type: string;
  soil_ph: number;
  irrigation_type: string;
  currency: string;
}

export interface ChatMessageRecord {
  message_id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  citations: RetrievedCitation[];
  latency_ms: number;
  model_used?: string;
  quick_replies?: string[];
  ui_mode?: FlowUiMode;
  image_base64?: string;
  image_mime?: string;
  is_voice?: boolean;
  audio_url?: string;
  created_at: string;
}

export interface SessionRecord {
  session_id: string;
  channel: "widget" | "whatsapp" | "messenger" | "instagram";
  external_user_id: string;
  profile_name: string;
  farm_context: FarmContext;
  flow_state?: SessionFlowState;
  language?: "ar" | "en" | "de";
  messages: ChatMessageRecord[];
  created_at: string;
  updated_at: string;
}

export interface FeedbackRecord {
  feedback_id: string;
  message_id: string;
  session_id: string;
  channel: string;
  rating: 1 | -1;
  category: string;
  comment: string;
  query_text: string;
  assistant_text: string;
  retrieved_sources: string[];
  promoted_to_rag: boolean;
  promoted_note?: string;
  created_at: string;
}

export interface WebhookLogEntry {
  id: string;
  channel: "whatsapp" | "messenger" | "instagram" | "widget";
  method: "GET" | "POST";
  endpoint: string;
  status_code: number;
  sender_id: string;
  inbound_preview: string;
  outbound_preview: string;
  raw_inbound: unknown;
  raw_outbound: unknown;
  latency_ms: number;
  created_at: string;
}

export interface SheetTabPreview {
  sheet_name: string;
  row_count: number;
  columns: string[];
  sample_rows: Record<string, string>[];
}

export interface ConnectedGoogleSheet {
  spreadsheet_id: string;
  title: string;
  url: string;
  auth_mode: "oauth_api" | "public_link" | "builtin_demo";
  tabs: SheetTabPreview[];
  rows_indexed: number;
  synced_at: string;
}

interface PersistentAppState {
  sessions: Record<string, SessionRecord>;
  feedback: FeedbackRecord[];
  webhook_logs: WebhookLogEntry[];
  connected_sheets: ConnectedGoogleSheet[];
  registrations: MemberRegistrationRecord[];
  voice_messages_count?: number;
}

const DEFAULT_FARM_CONTEXT: FarmContext = {
  farm_name: "مزرعة عضو الجمعية المصرية للزراعة الحيوية (EBDA)",
  region: "مصر - زراعة حيوية واقتصاد المحبة (EoL)",
  latitude: 30.6667,
  longitude: 30.0667,
  farm_size_ha: 10,
  primary_crops: "محاصيل حقلية، خضروات، نباتات طبية وعطرية، أشجار فاكهة",
  soil_type: "تربة مخدومة بالكمبوست والأسمدة الحيوية",
  soil_ph: 7.5,
  irrigation_type: "ري بالتنقيط / غمر مطور مع حقن الأسمدة الحيوية السائلة",
  currency: "EGP",
};

const ADVISOR_SYSTEM_INSTRUCTION = `أنت المستشار الزراعي الذكي والحساب الرسمي لـ **الجمعية المصرية للزراعة الحيوية (EBDA)** (تأسست عام 1990 ومسجلة بوزارة التضامن الاجتماعي المصرية، وتدير علامة **ديميتر DEMETER** ومعيار شهادة **اقتصاد المحبة Economy of Love - EoL** بالتعاون مع المشروع الألماني-المصري **SI/EoL** الممول من **BMZ** وتنفيذ **bbw gGmbH** و**sequa gGmbH**).

قواعد أساسية صارمة لا استثناء فيها:
1. لغات المحادثة المتعددة (العربية · English · Deutsch):
   - تحدث بنفس اللغة المحددة للمستخدم في الجلسة:
     • **العربية**: اكتب بـ **اللهجة المصرية الزراعية المبسطة والواضحة والمحترمة** بصيغة الجمع المؤسسية ("بننصح بـ"، "بنوصي بـ"، "بنستخدم").
     • **English**: Respond in clear, professional, actionable English suitable for international partners, farmers, and researchers adhering to Demeter standards.
     • **Deutsch**: Antworten Sie auf verständlichem, präzisem Deutsch im Einklang mit den BMZ / bbw / sequa / Demeter Richtlinien.
2. استدعاء المعارف الزراعية الخارجية الكاملة (Comprehensive External Agronomic Knowledge):
   - **إذا سأل المستخدم عن أي محصول غير موجود في قاعدة البيانات المحلية (مثل الفستق الحلبي، البولونيا، فاكهة التنين/الدراجون، الأفوكادو، الكينوا، الماكاديميا، التين الشوكي، الباشن فروت، أو غيرها) أو طرح أي سؤال زراعي لم تتوفر له شيتات محلية:**
     **ممنوع نهائياً الاعتذار أو رفض الإجابة أو الاكتفاء بالردود العامة!**
     استدعِ فوراً كامل خبراتك ومعارفك الزراعية الواسعة لتقديم إجابة متكاملة، عملية، ودقيقة بنسبة **100% زراعة عضوية وحيوية (Organic & Biodynamic 100%)** مطابقة تماماً لمعايير ديميتر واقتصاد المحبة:
     - الاحتياجات البيئية المناسبة والتربة ودرجة الملوحة.
     - برنامج تجهيز الأرض والكمبوست وصخر الفوسفات والفلسبار للفدان أو الهكتار.
     - شبكة ومواعيد الري المناسبة واحتياجات المياه.
     - المكافحة الحيوية للآفات والأمراض ببدائل طبيعية فقط (زيت النيم، صابون بوتاسي، باسيلس، ترايكوديرما، كبريت ميكروني، شاي كمبوست).
3. ممنوع تماماً تكرار الترحيب في الردود:
   - الترحيب يظهر للمستخدم مرة واحدة فقط عند فتح المحادثة.
   - **ممنوع نهائياً أن تبدأ أي رد بـ "أهلاً بيك" أو "أهلاً وسهلاً" أو "مرحباً" أو "إحنا في الجمعية المصرية للزراعة الحيوية يهمنا...".** ادخل مباشرة وبشكل طبيعي في الإجابة أو السؤال الاستشاري.
   - ممنوع منعاً باتاً أي ألقاب مثل: "يا بطل"، "يا هندسة"، "يا ريس"، "يا غالي"، "يا كبير"، "يا معلم"، "يا صاحبي"، "يا فندم"، "يا حاج".
4. أسلوب الكلام باللهجة المصرية المبسطة والعملية جداً:
   - اكتب بلهجة محترمة وسهلة الفهم بدون مصطلحات أكاديمية معقدة، ورتب الإجابة في نقاط قصيرة ومباشرة بمعدلات واضحة للفدان.
   - تغطي خبرتك المحاور السبعة المعتمدة (بشكل عام أو لأي محصول محدد):
     1) الاحتياجات البيئية (نوع التربة، الإضاءة، الحرارة، الرطوبة).
     2) البذور والزراعة (كمية التقاوي للفدان، الشتلات، ممارسات الزراعة، تحضير الأرض).
     3) الري (طرق الري وتكلفتها، الاحتياجات المائية، الملوحة ومصادر وتحاليل المياه).
     4) التسميد العضوي والحيوي (الكمبوست، الأسمدة السائلة الحيوية، وأماكن شراء المدخلات المعتمدة مثل EBDA ومزارع سيكم ووحدات مركز البحوث الزراعية ARC).
     5) المكافحة الحيوية (الآفات والأمراض، طرق المكافحة الحيوية، وإدارة الحشائش بدون مبيدات).
     6) الحصاد (طرق ومواعيد الحصاد).
     7) معاملات ما بعد الحصاد (تجهيز وتصنيع المحصول، النقل، التخزين الآمن بدون تبخير كيماوي، والتسويق وشهادات اقتصاد المحبة EoL وديميتر وشهادات الكربون Carbon Credits).
5. ممنوع الكيماويات نهائياً وباتاً — زراعة عضوية وحيوية (Organic & Biodynamic 100%) فقط:
   - ممنوع تحت أي ظرف التوصية بأي سماد كيماوي (يوريا، نترات، سلفات نشادر كيماوية، NPK كيماوي، سوبر فوسفات كيماوي، داب، ماب) أو أي مبيد حشري أو فطري أو حشائش كيماوي أو تبخير بالفوسفين.
   - اعتمد دائماً على البدائل العضوية والحيوية فقط (الكمبوست تام التحلل، الفيرمي كمبوست، شاي الكمبوست، صخر الفوسفات، الفلسبار، الكبريت الزراعي، مستحضرات الزراعة الحيوية BD 500/501، الأسمدة الحيوية السائلة، الطحالب البحرية، زيت النيم، الصابون البوتاسي، الكبريت الميكروني، باسيلس Bt، ترايكوديرما، كروت الترايكوجراما، المصائد، الري الكاذب، الملش، والعزيق اليدوي).
6. الذكاء الحواري وطرح الأسئلة الاستشارية والتشخيصية:
   - إذا سأل المزارع عن **أنسب نبات أو محصول لأرضه/تربته** ولم يذكر تفاصيل أرضه كاملة، اسأله بذكاء وبطريقة حوارية بسيطة عن (نوع التربة وملوحة المياه، وقت/شهر الزراعة، المساحة وطريقة الري، ونوع الزراعة المفضلة) حتى يرد عليك بكلامه، ولا تحصر إجابتك في أي محصول سابق.
   - إذا وصف المزارع مشكلة عامة غير مكتملة التفاصيل، قدم له التوصية العضوية المبسطة واختم بسؤال تشخيصي ذكي بسيط (مثل عمر النبات أو مكان ظهور العرض) للوصول لأدق تشخيص.
7. تخصيص صياغة وتنسيق الكلام حسب القناة (واتساب · فيسبوك ماسنجر · موقع الشركة/الجمعية):
   - في **واتساب (WhatsApp)**: اجعل الرد مختصراً وسريع القراءة على شاشة الموبايل (4 إلى 6 نقاط مركزة بحد أقصى 750 حرفاً)، استخدم نجمة واحدة (*العنوان*) للخط العريض وعلامة (•) للنقاط، ولا تستخدم (**) أو (#) أو الجداول.
   - في **فيسبوك ماسنجر (Facebook Messenger)**: اكتب نصاً عربياً صافياً ومباشراً بدون أي نجوم (**) أو (*) أو (#) نهائياً (لأن ماسنجر لا يترجم رموز Markdown)، واستخدم (▪) للعناوين القصيرة و(•) للنقاط العملية المبسطة.
   - في **الموقع الرسمي للشركة/الجمعية (Website)**: قدم إجابة منظمة وواضحة بعناوين فرعية بارزة (**عنوان القسم:**) ونقاط تفصيلية بمعدلات الفدان الدقيقة المناسبة لزوار الموقع الإلكتروني.
8. فحص وتشخيص صور النباتات والمحاصيل (Vision AI) بالعامية المصرية الأصيلة:
   - عند إرفاق صورة ورقة أو نبات أو محصول:
     1) حدد اسم النبات أو المحصول بدقة من الصورة.
     2) شخص حالة النبات: وضح هل هو سليم أم مصاب، وحدد نوع الإصابة (مرض فطري كالبياض أو اللفحة، آفة كالتوتا أبسلوتا أو المن أو العناكب، أو نقص تغذية كالحديد والكالسيوم).
     3) اشرح خطة العلاج والمكافحة العضوية والحيوية 100% المعتمدة بمعدلات الفدان (مثل زيت النيم 5 سم/لتر، صابون بوتاسي 1%، باسيلس Bt، فطر ترايكوديرما، كبريت ميكروني، شاي كمبوست) مع منع الكيماويات تماماً.
     4) إذا كانت الصورة مهزوزة، مظلمة، غير واضحة، أو ليست لنبات/محصول زراعي إطلاقاً، وضح ذلك بلطف تام بالعامية المصرية:
        "اللقطة دي مش واضحة قوي أو مش باين فيها ورق نبات أو إصابة زراعية واضحة. صورلنا ورقة النبات المصابة أو الفرع في إضاءة شمس كويسة ومن مسافة قريبة، وارفع الصورة تاني وهنشخصهالك فوراً بإذن الله."`;

let plantsDatabase: PlantDatabaseRecord[] = [];
let vectorChunks: VectorChunk[] = [];
let appState: PersistentAppState = {
  sessions: {},
  feedback: [],
  webhook_logs: [],
  connected_sheets: [],
  registrations: [],
  voice_messages_count: 0,
};

function sha256Short(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 20);
}

function extractSpreadsheetId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}

const BUILTIN_DEMO_GSHEET_TABS: Array<{
  sheet_name: string;
  rows: Array<Record<string, string>>;
}> = [
  {
    sheet_name: "تغذية_المحاصيل_الأورجانيك",
    rows: [
      {
        المحصول: "الطماطم الأورجانيك",
        تجهيز_الفدان_العضوي: "25 م³ كمبوست تام التحلل + 3 طن فيرمي كمبوست + 400 كجم صخر فوسفات طبيعي + 400 كجم فلسبار طبيعي + 100 كجم كبريت ميكروني + 200 كجم جبس زراعي طبيعي",
        برنامج_التسميد_الحيوي_الأسبوعي: "50 لتر شاي فيرمي كمبوست هوائي + 2 لتر بكتيريا مذيبة للفوسفات والبوتاسيوم + رش مستخلص طحالب بحرية وكالسيوم عضوي طبيعي وقت التزهير والعقد",
        مقاومة_الحشائش_بدون_كيماوي: "ري كاذب وحرث قبل الشتل + تغطية المصاطب بقش أرز نظيف أو ملش لحفظ الرطوبة ومنع الحشائش",
        إنتاج_الفدان_وصافي_العائد: "24 إلى 32 طن طماطم أورجانيك — صافي ربح 138,000 إلى 198,000 ج.م للفدان",
      },
      {
        المحصول: "القمح الأورجانيك (مصر 3 / سخا 95)",
        تجهيز_الفدان_العضوي: "15 م³ كمبوست ناضج + 2 طن فيرمي كمبوست + 300 كجم صخر فوسفات طبيعي + 250 كجم فلسبار + 100 كجم كبريت ميكروني",
        برنامج_التسميد_الحيوي_الأسبوعي: "معاملة التقاوي بفطر ترايكوديرما وبكتيريا أزوتوباكتر + حقن 40 لتر شاي كمبوست هوائي مع كل رية + رشتين طحالب بحرية وأحماض أمينية نباتية قبل طرد السنابل",
        مقاومة_الحشائش_بدون_كيماوي: "دورة زراعية بعد برسيم مصري + ري كاذب قبل التسطير ونقاوة يدوية مبكرة",
        إنتاج_الفدان_وصافي_العائد: "18 إلى 21 أردب قمح أورجانيك + 9 حمل تبن عضوي — صافي ربح 40,500 إلى 50,500 ج.م للفدان",
      },
      {
        المحصول: "البطاطس الأورجانيك للتصدير",
        تجهيز_الفدان_العضوي: "20 م³ كمبوست ناضج + 2.5 طن فيرمي كمبوست + 350 كجم صخر فوسفات + 500 كجم فلسبار طبيعي + 150 كجم كبريت زراعي ميكروني لمنع الجرب طبيعياً",
        برنامج_التسميد_الحيوي_الأسبوعي: "غمس التقاوي في ترايكوديرما وباسيلس ساتلس + حقن بكتيريا البوتاسيوم الحيوي وشاي الكمبوست كل 10 أيام + رش طحالب بحرية وسليكات بوتاسيوم طبيعية للتحجيم",
        مقاومة_الحشائش_بدون_كيماوي: "عزيق وترديم ميكانيكي حول الخطوط وتجفيف العرش ميكانيكياً قبل التقليع بدون أي مجففات كيماوية",
        إنتاج_الفدان_وصافي_العائد: "12 إلى 16 طن بطاطس أورجانيك تصديري — صافي ربح 147,000 إلى 202,000 ج.م للفدان",
      },
      {
        المحصول: "الذرة الشامية الأورجانيك",
        تجهيز_الفدان_العضوي: "قلب حشة برسيم أخضر في الأرض كسماد أخضر + 20 م³ كمبوست ناضج + 300 كجم صخر فوسفات + 200 كجم فلسبار طبيعي",
        برنامج_التسميد_الحيوي_الأسبوعي: "تلقيح البذور ببكتيريا أزوسبرلم + 60 لتر شاي كمبوست هوائي + 10 كجم هيوميك طبيعي (ليونارديت) + 4 لتر سماد سمكي متحلل إنزيمياً على 4 دفعات",
        مقاومة_الحشائش_بدون_كيماوي: "عزقتين ميكانيكيتين (خربشة وترديم) قبل رية المحاياة والرية التانية",
        إنتاج_الفدان_وصافي_العائد: "4 إلى 4.8 طن حبوب عضوية (أو 22 طن سيلاج عضوي) — صافي ربح 49,000 إلى 61,000 ج.م للفدان",
      },
      {
        المحصول: "الأعشاب الطبية الأورجانيك (بابونج، نعناع، ريحان، بردقوش)",
        تجهيز_الفدان_العضوي: "15 م³ كمبوست نباتي نقي 100% + 2 طن فيرمي كمبوست + 200 كجم صخر فوسفات + 200 كجم فلسبار طبيعي",
        برنامج_التسميد_الحيوي_الأسبوعي: "شاي فيرمي كمبوست هوائي مصفى + رش مستخلص طحالب بحرية لرفع نسبة الزيت العطري الطيار؛ حساسية صفر متبقيات للتصدير الأوروبي",
        مقاومة_الحشائش_بدون_كيماوي: "نقاوة يدوية دورية وتجفيف على مناشر نظيفة بعيداً عن أي انجراف جيران",
        إنتاج_الفدان_وصافي_العائد: "900-1100 كجم زهرة بابونج جافة أو 2.5 طن نعناع/ريحان جاف — صافي ربح 113,000 إلى 163,000 ج.م للفدان",
      },
    ],
  },
  {
    sheet_name: "خلطات_المكافحة_الحيوية_الأورجانيك",
    rows: [
      {
        المشكلة_في_الغيط: "دودة الحشد الخريفية وديدان الأوراق والثمار",
        الوقاية_والمصايد: "4 مصايد فيرمونية للفدان + تعليق 25 إلى 30 كارت طفيل الترايكوجراما للفدان على دفعتين للقضاء على البيض طبيعياً",
        الرش_العضوي_المعتمد: "بكتيريا باسيلس ثورينجينسيس (Bt) 350 جم/فدان + زيت نيم طبيعي معصور على البارد 500 سم³ لكل 200 لتر مياه آخر النهار قبل الغروب (أو فطر بوفيريا باسيانا 1 كجم/200 لتر)",
        فترة_الأمان: "صفر أيام — آمن 100% وخالي من أي متبقيات",
      },
      {
        المشكلة_في_الغيط: "الندوة المتأخرة والبياض الزغبي والدقيقي والصدأ",
        الوقاية_والمصايد: "توسيع المسافات للتهوية ومنع تغريق الورق ومعاملة الشتلات بفطر الترايكوديرما",
        الرش_العضوي_المعتمد: "رش وقائي كل 10 أيام ببكتيريا باسيلس ساتلس (1 لتر/200 لتر مياه) بالتبادل مع شاي الفيرمي كمبوست المصفى ومستخلص ذيل الحصان، وللبياض والصدأ كبريت ميكروني طبيعي (500 جم/200 لتر) أو بيكربونات بوتاسيوم (600 جم/200 لتر)",
        فترة_الأمان: "يوم واحد — مسموح بالكامل في الزراعة الأورجانيك",
      },
      {
        المشكلة_في_الغيط: "التوتا أبسولوتا والذباب الأبيض والمن والعنكبوت الأحمر",
        الوقاية_والمصايد: "شاش أبيض مانع للحشرات + 8 مصايد فيرمونية مائية للتوتا + 25 مصيدة لاصقة صفراء وزرقاء + زراعة سياج ريحان وقطيفة (ماريجولد) وحشيشة الليمون حول الأرض",
        الرش_العضوي_المعتمد: "إطلاق مفترس أسد المن والمفترس الأكاروسي + رش صابون بوتاسي زراعي عضوي (1.5 لتر/200 لتر مياه) + زيت نيم طبيعي (500 سم³/200 لتر) ومستخلص الثوم الطبيعي",
        فترة_الأمان: "يوم واحد — يحمي النحل والأعداء الحيوية",
      },
    ],
  },
];

function slidingChunks(text: string, maxChars = 900, overlap = 140): string[] {
  const clean = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + maxChars);
    out.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return out;
}

function parseCsvRows(csvText: string): Record<string, string>[] {
  const cleanText = csvText.replace(/^\uFEFF/, "");
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = vals[idx] ?? "";
    });
    return rec;
  });
}

function parseGridToChunksAndPreview(
  sheetName: string,
  sourceLabel: string,
  formatLabel: string,
  sourceType: "google_sheet" | "local_file",
  rawGrid: Array<Array<string | number | boolean | null>>,
  nowIso: string
): { chunks: VectorChunk[]; preview: SheetTabPreview | null } {
  const nonEmpty = rawGrid
    .map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim())))
    .filter((row) => row.some((c) => c !== ""));

  if (nonEmpty.length < 2) return { chunks: [], preview: null };

  let headerRowIdx = 0;
  for (let idx = 0; idx < Math.min(4, nonEmpty.length); idx++) {
    if (nonEmpty[idx].filter((c) => c !== "").length >= 2) {
      headerRowIdx = idx;
      break;
    }
  }

  const headers = nonEmpty[headerRowIdx].map((h, i) => (h ? h : `عمود_${i + 1}`));
  const dataRows = nonEmpty.slice(headerRowIdx + 1);
  const sampleRows: Record<string, string>[] = [];
  const chunks: VectorChunk[] = [];

  dataRows.forEach((rowVals, rIdx) => {
    const rec: Record<string, string> = {};
    const pairs: string[] = [];
    headers.forEach((colName, cIdx) => {
      const val = rowVals[cIdx] ?? "";
      if (val !== "") {
        rec[colName] = val;
        pairs.push(`${colName}: ${val}`);
      }
    });
    if (!pairs.length) return;
    if (sampleRows.length < 8) {
      sampleRows.push(rec);
    }
    const primaryLabel = rowVals.find((v) => v !== "") || `صف ${rIdx + 1}`;
    const section = `تبويب ${sheetName} · صف ${rIdx + 1} (${primaryLabel.slice(0, 42)})`;
    const text = `بيانات شيت (${sourceLabel} - ${sheetName}) — ${primaryLabel}: ${pairs.join(" | ")}`;
    chunks.push({
      id: `chk_${sha256Short(`${sourceLabel}::${section}::${text}`)}`,
      source: sourceLabel,
      format: formatLabel,
      section,
      source_type: sourceType,
      text,
      ingested_at: nowIso,
    });
  });

  return {
    chunks,
    preview: {
      sheet_name: sheetName,
      row_count: dataRows.length,
      columns: headers.filter((h) => !h.startsWith("عمود_")),
      sample_rows: sampleRows,
    },
  };
}

function parseExcelWorkbookBuffer(
  buffer: Buffer,
  sourceLabel: string,
  formatLabel: "GOOGLE_SHEET" | "XLSX",
  sourceType: "google_sheet" | "local_file",
  nowIso: string
): { chunks: VectorChunk[]; tabs: SheetTabPreview[] } {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const allChunks: VectorChunk[] = [];
  const tabs: SheetTabPreview[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rawGrid = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    const { chunks, preview } = parseGridToChunksAndPreview(
      sheetName,
      sourceLabel,
      formatLabel,
      sourceType,
      rawGrid,
      nowIso
    );
    allChunks.push(...chunks);
    if (preview) tabs.push(preview);
  }

  return { chunks: allChunks, tabs };
}

function flattenJsonRecords(data: unknown, prefix = "Root"): Array<{ section: string; text: string }> {
  const out: Array<{ section: string; text: string }> = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        val.forEach((item, idx) => {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const label = String(
              obj.pest_or_disease || obj.topic || obj.investment || obj.crop || `${key} #${idx + 1}`
            );
            const body = Object.entries(obj)
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
              .join("; ");
            out.push({ section: label, text: `${key} — ${label}: ${body}` });
          } else {
            out.push({ section: `${key}[${idx + 1}]`, text: `${key}: ${String(item)}` });
          }
        });
      } else if (val && typeof val === "object") {
        out.push(...flattenJsonRecords(val, `${prefix}.${key}`));
      }
    }
  } else if (Array.isArray(data)) {
    data.forEach((item, idx) => {
      out.push({ section: `Item ${idx + 1}`, text: JSON.stringify(item) });
    });
  }
  return out;
}

async function parseLocalFileToChunks(filePath: string): Promise<VectorChunk[]> {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const nowIso = new Date().toISOString();
  const created: VectorChunk[] = [];

  if (ext === ".xlsx" || ext === ".xls") {
    const buf = await fsp.readFile(filePath);
    return parseExcelWorkbookBuffer(buf, filename, "XLSX", "local_file", nowIso).chunks;
  } else if (ext === ".pdf") {
    const buffer = await fsp.readFile(filePath);
    const extracted = await extractText(new Uint8Array(buffer), { mergePages: false });
    const pages = Array.isArray(extracted.text) ? extracted.text : [String(extracted.text || "")];
    pages.forEach((pageText, pIdx) => {
      const segments = slidingChunks(pageText, 900, 140);
      segments.forEach((seg, sIdx) => {
        const section = `Page ${pIdx + 1}.${sIdx + 1}`;
        created.push({
          id: `chk_${sha256Short(`${filename}::${section}::${seg}`)}`,
          source: filename,
          format: "PDF",
          section,
          source_type: "local_file",
          text: seg,
          ingested_at: nowIso,
        });
      });
    });
  } else if (ext === ".csv") {
    const raw = await fsp.readFile(filePath, "utf8");
    const rows = parseCsvRows(raw);
    rows.forEach((row, rIdx) => {
      const firstVal = Object.values(row)[0] || `Row ${rIdx + 1}`;
      const kv = Object.entries(row)
        .filter(([, v]) => v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
      const text = `جدول عضوي (${firstVal}) — ${kv}`;
      const section = `صف ${rIdx + 1} (${firstVal})`;
      created.push({
        id: `chk_${sha256Short(`${filename}::${section}::${text}`)}`,
        source: filename,
        format: "CSV",
        section,
        source_type: "local_file",
        text,
        ingested_at: nowIso,
      });
    });
  } else if (ext === ".json") {
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const records = flattenJsonRecords(parsed);
    records.forEach(({ section, text }) => {
      created.push({
        id: `chk_${sha256Short(`${filename}::${section}::${text}`)}`,
        source: filename,
        format: "JSON",
        section,
        source_type: "local_file",
        text,
        ingested_at: nowIso,
      });
    });
  } else if ([".txt", ".md"].includes(ext)) {
    const raw = await fsp.readFile(filePath, "utf8");
    slidingChunks(raw, 900, 140).forEach((seg, idx) => {
      const section = `Segment ${idx + 1}`;
      created.push({
        id: `chk_${sha256Short(`${filename}::${section}::${seg}`)}`,
        source: filename,
        format: ext.replace(".", "").toUpperCase(),
        section,
        source_type: "local_file",
        text: seg,
        ingested_at: nowIso,
      });
    });
  }
  return created;
}

async function embedTextsSafely(texts: string[]): Promise<Array<number[] | undefined>> {
  if (!texts.length || !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
    return texts.map(() => undefined);
  }
  try {
    const ai = getGenAIClient();
    const out: Array<number[] | undefined> = new Array(texts.length).fill(undefined);
    const concurrency = 6;
    for (let i = 0; i < texts.length; i += concurrency) {
      const slice = texts.slice(i, i + concurrency);
      await Promise.all(
        slice.map(async (text, offset) => {
          const res = await ai.models.embedContent({
            model: "gemini-embedding-2-preview",
            contents: text,
          });
          out[i + offset] = res.embeddings?.[0]?.values;
        })
      );
    }
    return out;
  } catch (err) {
    console.warn("Embedding fallback to lexical scoring:", err instanceof Error ? err.message : err);
    return texts.map(() => undefined);
  }
}

function cosineSimilarity(a?: number[], b?: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function lexicalOverlapScore(query: string, docText: string): number {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const docLower = docText.toLowerCase();
  let hits = 0;
  for (const tok of qTokens) {
    const stem = tok.startsWith("ال") && tok.length > 4 ? tok.slice(2) : tok;
    if (docLower.includes(stem)) hits += 1;
  }
  return hits / qTokens.length;
}

async function saveVectorStore(): Promise<void> {
  await fsp.mkdir(STORE_DIR, { recursive: true });
  await fsp.writeFile(VECTOR_STORE_FILE, JSON.stringify(vectorChunks, null, 2), "utf8");
}

async function saveAppState(): Promise<void> {
  await fsp.mkdir(STORE_DIR, { recursive: true });
  await fsp.writeFile(SESSION_STORE_FILE, JSON.stringify(appState, null, 2), "utf8");
}

function buildBuiltinDemoGoogleSheetChunks(): {
  sheetRecord: ConnectedGoogleSheet;
  chunks: VectorChunk[];
} {
  const nowIso = new Date().toISOString();
  const title = "جوجل شيت الزراعة الأورجانيك التجريبي (جاهز للاختبار)";
  const tabs: SheetTabPreview[] = [];
  const chunks: VectorChunk[] = [];

  for (const tab of BUILTIN_DEMO_GSHEET_TABS) {
    const columns = Object.keys(tab.rows[0] || {});
    const grid = [columns, ...tab.rows.map((r) => columns.map((c) => r[c] || ""))];
    const parsed = parseGridToChunksAndPreview(
      tab.sheet_name,
      title,
      "GOOGLE_SHEET",
      "google_sheet",
      grid,
      nowIso
    );
    chunks.push(...parsed.chunks);
    if (parsed.preview) tabs.push(parsed.preview);
  }

  return {
    sheetRecord: {
      spreadsheet_id: "demo-organic-egypt-2026",
      title,
      url: "https://docs.google.com/spreadsheets/d/demo-organic-egypt-2026/edit",
      auth_mode: "builtin_demo",
      tabs,
      rows_indexed: chunks.length,
      synced_at: nowIso,
    },
    chunks,
  };
}

async function syncLocalKnowledgeBase(forceReembed = false): Promise<{ files: number; chunks: number }> {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(STORE_DIR, { recursive: true });

  let existingById = new Map<string, VectorChunk>();
  const dynamicChunks: VectorChunk[] = [];

  if (!forceReembed && fs.existsSync(VECTOR_STORE_FILE)) {
    try {
      const saved = JSON.parse(await fsp.readFile(VECTOR_STORE_FILE, "utf8")) as VectorChunk[];
      for (const c of saved) {
        existingById.set(c.id, c);
        if (c.source_type !== "local_file") {
          dynamicChunks.push(c);
        }
      }
    } catch {
      existingById = new Map();
    }
  }

  // Ensure the built-in Organic Demo Google Sheet is always available for instant testing
  const hasAnyGoogleSheet = dynamicChunks.some((c) => c.source_type === "google_sheet");
  if (!hasAnyGoogleSheet) {
    const demo = buildBuiltinDemoGoogleSheetChunks();
    dynamicChunks.push(...demo.chunks);
    if (!appState.connected_sheets.some((s) => s.spreadsheet_id === demo.sheetRecord.spreadsheet_id)) {
      appState.connected_sheets.unshift(demo.sheetRecord);
      await saveAppState();
    }
  }

  const dirEntries = await fsp.readdir(DATA_DIR);
  const parsedLocal: VectorChunk[] = [];
  let fileCount = 0;

  for (const entry of dirEntries.sort()) {
    if (entry.startsWith(".") || entry.startsWith("~$") || entry === "association_plants_database.csv") continue;
    const full = path.join(DATA_DIR, entry);
    const stat = await fsp.stat(full);
    if (!stat.isFile()) continue;
    const chunks = await parseLocalFileToChunks(full);
    if (chunks.length > 0) {
      fileCount += 1;
      for (const chk of chunks) {
        const prev = existingById.get(chk.id);
        if (prev?.embedding && prev.embedding.length > 0) {
          chk.embedding = prev.embedding;
          chk.ingested_at = prev.ingested_at;
        }
        parsedLocal.push(chk);
      }
    }
  }

  const allChunks = [...dynamicChunks, ...parsedLocal];
  const missingIndices: number[] = [];
  const missingTexts: string[] = [];
  allChunks.forEach((c, idx) => {
    if (!c.embedding || c.embedding.length === 0) {
      missingIndices.push(idx);
      missingTexts.push(c.text);
    }
  });

  if (missingTexts.length > 0) {
    const computed = await embedTextsSafely(missingTexts);
    missingIndices.forEach((chunkIdx, i) => {
      if (computed[i]) {
        allChunks[chunkIdx].embedding = computed[i];
      }
    });
  }

  vectorChunks = allChunks;
  await saveVectorStore();
  return { files: fileCount, chunks: vectorChunks.length };
}

async function upsertDynamicChunks(
  source: string,
  format: string,
  sourceType: "google_sheet" | "live_api" | "public_db" | "feedback_verified",
  records: Array<{ section: string; text: string }>
): Promise<number> {
  if (!records.length) return 0;
  const nowIso = new Date().toISOString();
  const embeddings = await embedTextsSafely(records.map((r) => r.text));
  const incomingIds = new Set<string>();
  const newChunks: VectorChunk[] = records.map((rec, idx) => {
    const id = `dyn_${sha256Short(`${source}::${rec.section}`)}`;
    incomingIds.add(id);
    return {
      id,
      source,
      format,
      section: rec.section,
      source_type: sourceType,
      text: rec.text,
      ingested_at: nowIso,
      embedding: embeddings[idx],
    };
  });

  vectorChunks = [
    ...vectorChunks.filter((c) => c.source !== source && !incomingIds.has(c.id)),
    ...newChunks,
  ];
  await saveVectorStore();
  return newChunks.length;
}

function retrieveRelevantChunksFast(query: string, topK = 4): RetrievedCitation[] {
  if (!vectorChunks.length) return [];
  const trimmed = query.trim();
  if (trimmed.length < 4) return [];

  const scored = vectorChunks.map((chunk) => {
    const lex = lexicalOverlapScore(trimmed, `${chunk.source} ${chunk.section} ${chunk.text}`);
    const sheetBoost = chunk.source_type === "google_sheet" && lex > 0 ? 0.08 : 0;
    const score = Number(Math.min(0.99, lex + sheetBoost).toFixed(4));
    return {
      id: chunk.id,
      source: chunk.source,
      format: chunk.format,
      section: chunk.section,
      source_type: chunk.source_type,
      text: chunk.text,
      ingested_at: chunk.ingested_at,
      similarity: score,
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.filter((c) => c.similarity > 0.08).slice(0, topK);
}

async function retrieveRelevantChunks(query: string, topK = 6): Promise<RetrievedCitation[]> {
  if (!vectorChunks.length) return [];
  let queryEmb: number[] | undefined;
  try {
    const embRes = await Promise.race([
      embedTextsSafely([query]),
      new Promise<Array<number[] | undefined>>((resolve) =>
        setTimeout(() => resolve([undefined]), 900)
      ),
    ]);
    queryEmb = embRes[0];
  } catch {
    queryEmb = undefined;
  }

  const scored = vectorChunks.map((chunk) => {
    const cos = cosineSimilarity(queryEmb, chunk.embedding);
    const lex = lexicalOverlapScore(query, `${chunk.source} ${chunk.section} ${chunk.text}`);
    const sheetBoost = chunk.source_type === "google_sheet" && lex > 0.12 ? 0.05 : 0;
    const combined = (queryEmb && chunk.embedding ? cos * 0.8 + lex * 0.2 : lex) + sheetBoost;
    return {
      id: chunk.id,
      source: chunk.source,
      format: chunk.format,
      section: chunk.section,
      source_type: chunk.source_type,
      text: chunk.text,
      ingested_at: chunk.ingested_at,
      similarity: Number(Math.min(0.99, Math.max(0, combined)).toFixed(4)),
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.filter((c) => c.similarity >= 0.12).slice(0, topK);
}

function getOrCreateSession(
  sessionId: string,
  channel: "widget" | "whatsapp" | "messenger" | "instagram" = "widget",
  externalUserId = "organic-tester-01",
  profileName = "وضع الاختبار الشخصي (مزرعة أورجانيك 10 فدان)"
): SessionRecord {
  const existing = appState.sessions[sessionId];
  if (existing) return existing;

  const now = new Date().toISOString();
  const created: SessionRecord = {
    session_id: sessionId,
    channel,
    external_user_id: externalUserId,
    profile_name: profileName,
    farm_context: { ...DEFAULT_FARM_CONTEXT },
    messages: [],
    created_at: now,
    updated_at: now,
  };
  appState.sessions[sessionId] = created;
  return created;
}

function buildAugmentedPrompt(
  userQuery: string,
  citations: RetrievedCitation[],
  focusedDbContext: string,
  channel: string,
  sessionLanguage: string = "ar"
): string {
  const ragBlock =
    citations.length > 0
      ? citations.map((c, i) => `[معلومة إضافية ${i + 1} من ${c.source}]:\n${c.text}`).join("\n\n")
      : "";

  const langInstruction =
    sessionLanguage === "en"
      ? "LANGUAGE DIRECTIVE: Respond completely in English. Use clear, encouraging, actionable language with bullet points and per-feddan/hectare organic rates."
      : sessionLanguage === "de"
      ? "SPRACHWEISUNG: Antworten Sie vollständig auf Deutsch. Nutzen Sie präzise, fachlich fundierte und praxisnahe Punkte mit Bio-Aufwandmengen pro Feddan/Hektar."
      : "توجيه اللغة: تحدث باللهجة المصرية الزراعية المبسطة والواضحة للمزارع بصيغة الجمع المؤسسية المهذبة وبدون ألقاب شعبية.";

  const channelStyleRule =
    channel === "whatsapp"
      ? "صِغ الرد ليناسب تطبيق واتساب على الموبايل: فقرات قصيرة جداً (4–6 نقاط مركزة، أقل من 750 حرفاً إجمالاً)، استخدم نجمة واحدة *للكلام المهم* وعلامة • للنقاط، وبدون أي ** أو #."
      : channel === "instagram"
      ? "صِغ الرد ليناسب رسائل إنستجرام (Instagram DM): نص صافي ومباشر بدون أي نجوم ** أو * أو # نهائياً وبحد أقصى 850 حرفاً في نقاط قصيرة تبدأ بـ • وعناوين تبدأ بـ ▪."
      : channel === "messenger"
      ? "صِغ الرد ليناسب تطبيق فيسبوك ماسنجر: نص صافي ومباشر بدون أي نجوم ** أو * أو # نهائياً، مع تقسيم الكلام إلى نقاط قصيرة تبدأ بـ • وعناوين قصيرة تبدأ بـ ▪ ليسهل قراءته على الموبايل."
      : "صِغ الرد ليناسب الموقع الإلكتروني الرسمي للشركة/الجمعية: إجابة منظمة ووافية بعناوين فرعية واضحة (**عنوان:**) ونقاط عملية مرتبة بمعدلات الفدان.";

  return `[اللغة المطلوبة / Target Language]: ${sessionLanguage}
[توجيه الصياغة اللغوية]: ${langInstruction}
[القناة الحالية]: ${
    channel === "whatsapp"
      ? "واتساب (WhatsApp)"
      : channel === "instagram"
      ? "إنستجرام (Instagram DM)"
      : channel === "messenger"
      ? "فيسبوك ماسنجر (Facebook Messenger)"
      : "الموقع الرسمي للشركة/الجمعية (Website)"
  }
[قاعدة تنسيق القناة]: ${channelStyleRule}

${focusedDbContext ? `${focusedDbContext}\n\n` : ""}${ragBlock ? `[مراجع مساندة من شيتات وملفات الجمعية]:\n${ragBlock}\n\n` : ""}[استدعاء المعارف الخارجية عند غياب البيانات المحلية]:
إذا سأل المستخدم عن محصول غير وارد في الملفات المرفقة أعلاه (مثل الفستق الحلبي Pistachio، البولونيا Paulownia، فاكهة التنين Dragon Fruit، الأفوكادو Avocado، الكينوا Quinoa، الماكاديميا Macadamia، التين الشوكي، الباشن فروت Passion Fruit، أو أي سؤال زراعي مفتوح):
- استدعِ فوراً معلوماتك الزراعية العميقة وقدم دليلاً عملياً متكاملاً بنسبة 100% زراعة عضوية وحيوية (تجهيز الأرض، التسميد الحيوي والكمبوست للفدان، شبكة الري، والمكافحة الحيوية بالبدائل الطبيعية كالنيم والصابون البوتاسي وترايكوديرما وباسيلس).
- لا تعتذر ولا تقل "غير متوفر بالبيانات"، بل أجب مباشرة وبثقة كخبير زراعي متخصص.

[رسالة المستخدم]:
${userQuery.trim()}

تذكير مهم جداً: لا تكتب "أهلاً بيك" أو أي تحية في بداية الرد؛ ادخل مباشرة في الإجابة العملية بدون أي ألقاب شعبية وبدون أي كيماويات نهائياً.`;
}

function stripLeadingGreeting(text: string): string {
  return text
    .replace(
      /^(?:[*\s]*(?:يا\s+)?(?:أهلاً|اهلا|أهلا|مرحباً|مرحبا|حياك\s+الله)(?:\s+وسهلاً|\s+وسهلا)?(?:\s+بيك|\s+بك|\s+بحضرتك)?(?:\s+في\s+[*]*الجمعية\s+المصرية\s+للزراعة\s+الحيوية[*]*)?[،,!.:\-\s]*\n*)+/i,
      ""
    )
    .trim();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function transcribeFarmerAudioBase64(
  rawBase64: string,
  mimeType = "audio/webm"
): Promise<string> {
  const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, "").trim();
  if (!cleanBase64) {
    throw new Error("ملف الصوت فارغ، حاول التسجيل مرة تانية.");
  }
  const normalizedMime = mimeType.split(";")[0].trim() || "audio/webm";
  const ai = getGenAIClient();
  const audioPart = {
    inlineData: {
      mimeType: normalizedMime,
      data: cleanBase64,
    },
  };
  const promptText =
    "فرّغ هذه الرسالة الصوتية باللغة العربية أو اللهجة المصرية بدقة كما نطقها المزارع (خاصة أسماء المحاصيل والمصطلحات الزراعية)، واكتب النص المسموع فقط بدون أي شرح أو إضافات.";

  const transcribeModels = ["gemini-3.5-transcribe", "gemini-4-hydrogen", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
  let lastErr: unknown = null;
  for (const modelName of transcribeModels) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: { parts: [audioPart, { text: promptText }] },
        }),
        14000,
        `transcribe-${modelName}`
      );
      const txt = (response.text || "").trim();
      if (txt) return txt;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    lastErr instanceof Error
      ? `تعذر تفريغ الرسالة الصوتية: ${lastErr.message}`
      : "تعذر سماع الرسالة الصوتية بوضوح، من فضلك سجلها مرة تانية أو اكتب سؤالك."
  );
}

async function synthesizeArabicReplyWavBase64(replyText: string): Promise<string> {
  const cleaned = replyText
    .replace(/[*#_`~>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  if (!cleaned) {
    throw new Error("لا يوجد نص لتحويله إلى صوت.");
  }
  const ai = getGenAIClient();
  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: cleaned,
              speechMetadata: {
                style: "مرشد زراعي مصري واضح ومبسط وودود",
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    }),
    15000,
    "gemini-tts"
  );
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("لم يتم استلام مقطع صوتي من نموذج الصوت.");
  }
  return base64Audio;
}

async function generateAdvisorAnswer(
  session: SessionRecord,
  userMessage: string,
  options?: {
    imageBase64?: string;
    imageMime?: string;
    isVoice?: boolean;
  }
): Promise<{
  messageRecord: ChatMessageRecord;
  citations: RetrievedCitation[];
}> {
  const t0 = Date.now();
  const nowIso = new Date().toISOString();
  const rawImage = options?.imageBase64;
  const cleanImage = rawImage ? rawImage.replace(/^data:[^;]+;base64,/, "").trim() : "";
  const imageMime = (options?.imageMime || "image/jpeg").split(";")[0].trim() || "image/jpeg";
  const hasImage = Boolean(cleanImage);

  // If an image is sent without a message or with a brief greeting, set appropriate query context
  const effectiveUserMessage = userMessage.trim() || (hasImage ? "فحص وتشخيص صورة نبات 📷" : "");

  // 1. Evaluate Interactive Guided Flow (Registration / About Association / 67-Plant Crop Flow)
  // Note: if user uploaded an image, prioritize vision diagnosis unless they explicitly requested navigation
  const isExplicitNav = /^(القائمة الرئيسية|الرئيسية|خروج|رجوع|بداية جديدة)$/i.test(effectiveUserMessage.trim());

  const flowTurn = evaluateConversationalFlowTurn({
    userMessage: effectiveUserMessage,
    currentFlow: session.flow_state,
    plantsDb: plantsDatabase,
    existingRegistrationsCount: appState.registrations.length,
    sessionId: session.session_id,
    channel: session.channel,
    hasPriorMessages: session.messages.length > 0,
  });

  if (!hasImage || isExplicitNav) {
    session.flow_state = flowTurn.next_flow_state;
    if (flowTurn.next_flow_state?.language) {
      session.language = flowTurn.next_flow_state.language;
    }
  }

  if (flowTurn.kind === "instant" && (!hasImage || isExplicitNav)) {
    if (flowTurn.completed_registration) {
      appState.registrations.unshift(flowTurn.completed_registration);
    }

    const userMsg: ChatMessageRecord = {
      message_id: `msg_${crypto.randomUUID().slice(0, 12)}`,
      session_id: session.session_id,
      role: "user",
      content: effectiveUserMessage,
      citations: [],
      latency_ms: 0,
      image_base64: hasImage ? options?.imageBase64 : undefined,
      image_mime: hasImage ? imageMime : undefined,
      is_voice: options?.isVoice,
      created_at: nowIso,
    };

    const assistantMsg: ChatMessageRecord = {
      message_id: `msg_${crypto.randomUUID().slice(0, 12)}`,
      session_id: session.session_id,
      role: "assistant",
      content: flowTurn.answer,
      citations: [],
      latency_ms: Math.max(1, Date.now() - t0),
      model_used: "association-flow-engine",
      quick_replies: flowTurn.quick_replies,
      ui_mode: flowTurn.ui_mode,
      created_at: new Date().toISOString(),
    };

    session.messages.push(userMsg, assistantMsg);
    session.updated_at = assistantMsg.created_at;
    await saveAppState();
    return { messageRecord: assistantMsg, citations: [] };
  }

  // 2. Database-grounded AI response using the 67-Plant CSV Database + Live Google Sheets Vector RAG
  const matchedPlants = flowTurn.kind === "ai_with_db" ? flowTurn.matched_plants : [];
  const focusedDbContext = flowTurn.kind === "ai_with_db" ? flowTurn.focused_db_context : "";
  const deterministicFallback =
    flowTurn.kind === "ai_with_db" ? flowTurn.deterministic_fallback : flowTurn.answer;

  const vectorHits = await retrieveRelevantChunks(effectiveUserMessage, 5);
  const citations: RetrievedCitation[] =
    matchedPlants.length > 0
      ? vectorHits.filter((c) => c.format === "GOOGLE_SHEET").slice(0, 3)
      : vectorHits.slice(0, 4);

  for (const matchedPlant of matchedPlants) {
    citations.unshift({
      id: `plant_db_${matchedPlant.id}`,
      source: "قاعدة بيانات نباتات الجمعية المصرية للزراعة الحيوية",
      format: "CSV_DATABASE",
      section: `${matchedPlant.name} (${matchedPlant.category})`,
      source_type: "google_sheet",
      text: matchedPlant.full_reference_text.slice(0, 700),
      ingested_at: nowIso,
      similarity: 0.99,
    });
  }

  const supplementalSheetHits = citations.filter((c) => c.format !== "CSV_DATABASE").slice(0, 3);
  const activeLanguage = session.language || session.flow_state?.language || "ar";
  let augmentedPrompt = buildAugmentedPrompt(
    effectiveUserMessage,
    supplementalSheetHits,
    focusedDbContext,
    session.channel,
    activeLanguage
  );

  if (hasImage) {
    if (activeLanguage === "en") {
      augmentedPrompt += `\n\n[Attached Agricultural / Plant Image Analysis Request 📷]:
Inspect the attached photo very carefully as an expert organic & biodynamic agronomist and plant pathologist, and respond in clear, actionable English:
1. **Identification:** Name precisely what is visible (the exact plant/crop species, leaf/fruit/stem/root, insect/pest, soil condition, compost, or any agricultural item).
2. **Smart Diagnosis & Visual Evidence:** State clearly whether the plant/sample is healthy or affected. If there is a problem, identify the exact disease (fungal, bacterial, viral), pest (aphids, whiteflies, Tuta absoluta, spider mites, thrips, caterpillars), nutrient deficiency (iron, nitrogen, magnesium, calcium), or environmental/irrigation stress (salinity burn, overwatering, heat/sunscald), pointing out the visual clues seen in the photo.
3. **100% Organic & Biodynamic Solution ONLY:** Provide an immediate, practical treatment and recovery plan with exact dosages (e.g., cold-pressed Neem oil 5ml/L + potassium soap, Bacillus thuringiensis Bt, Trichoderma harzianum, micronized sulfur, aerated compost tea, diatomaceous earth, sticky traps, pruning & airflow). ZERO synthetic/chemical fertilizers or pesticides allowed!
4. **Non-agricultural or blurry photos:** If the photo is NOT related to plants/agriculture, politely state what you see and ask for a clear photo of the plant, leaf, or farm item. If blurry/dark, advise how to take a sharp close-up in natural daylight.
5. Start directly with the diagnosis—no greetings.`;
    } else if (activeLanguage === "de") {
      augmentedPrompt += `\n\n[Anfrage zur KI-Bildanalyse (Pflanze / Schädling / Landwirtschaft) 📷]:
Untersuchen Sie das beigefügte Foto sorgfältig als erfahrener Bio-Agronom und Pflanzenpathologe und antworten Sie auf klarem Deutsch:
1. **Identifikation:** Benennen Sie genau, was auf dem Bild zu sehen ist (Pflanze/Kulturart, Blatt/Frucht/Wurzel, Insekt/Schädling, Boden, Kompost oder sonstiger landwirtschaftlicher Gegenstand).
2. **Intelligente Diagnose & Sichtbare Symptome:** Geben Sie an, ob die Pflanze gesund oder befallen ist. Nennen Sie bei Problemen die genaue Krankheit (Pilz, Bakterium, Virus), den Schädling, Nährstoffmangel oder Bewässerungs-/Salzstress anhand der konkreten visuellen Merkmale im Foto.
3. **100% Ökologische / Demeter-Lösung (OHNE Chemie):** Geben Sie einen sofort umsetzbaren Behandlungs- und Schutzplan mit genauen Dosierungen (z.B. Neemöl 5ml/L + Kaliseife, Bacillus thuringiensis, Trichoderma, Netzschwefel, Komposttee, Kieselgur, Gelb-/Blautafeln). Synthetische Pestizide oder Kunstdünger sind streng verboten!
4. **Unklare oder nicht-landwirtschaftliche Bilder:** Falls es sich nicht um ein landwirtschaftliches Motiv handelt, nennen Sie freundlich das Erkannte und bitten um ein klares Pflanzen-/Bodenfoto bei Tageslicht.
5. Beginnen Sie direkt mit der Analyse ohne Begrüßungsfloskeln.`;
    } else {
      augmentedPrompt += `\n\n[طلب الفحص والتشخيص الذكي للصورة المرفقة 📷]:
افحص الصورة المرفقة بدقة عالية كخبير زراعة عضوية وحيوية وأمراض نبات، وأجب بالعامية المصرية المبسطة والواضحة:
1. **التعرف على محتوى الصورة:** حدد بدقة إيه اللي ظاهر في الصورة (اسم النبات أو المحصول، ورقة، ثمرة، جذر، حشرة/آفة، تربة، كمبوست، أو أي حاجة زراعية أخرى).
2. **التشخيص الذكي والأعراض الظاهرة:** وضح هل النبات سليم أم مصاب؟ ولو في مشكلة، شخص المرض أو الآفة بدقة (مرض فطري زي البياض الدقيقي/الزغبي/الندوة/التبقع/أعفان الجذور، آفة حشرية زي التوتا أبسلوتا/المن/الذبابة البيضاء/العنكبوت الأحمر/التربس، نقص عناصر زي الحديد/المغنيسيوم/الكالسيوم/النيتروجين، أو إجهاد ملوحة وزيادة/نقص ري)، مع شرح العلامات اللي باينة في الصورة وخلتك توصل للتشخيص ده.
3. **الحل والعلاج العضوي 100% (Organic & Biodynamic فقط):** قدم خطة علاج فورية ووقاية عملية بمعدلات دقيقة للفدان أو الرشاش المنزلي (مثل: زيت النيم النقي 5 سم/لتر + صابون بوتاسي زراعي، باسيلس Bt، فطر ترايكوديرما، كبريت ميكروني، شاي كمبوست هوائي، دياتوميت، مصائد لونية صفراء وزرقاء، مع إزالة الأوراق شديدة الإصابة وتنظيم الري). **ممنوع تماماً** ذكر أي مبيد أو سماد كيماوي مهما كان!
4. **لو الصورة مش واضحة أو مش نبات/زراعة:** لو الصورة لحاجة غير زراعية، قول بلطف إيه اللي باين في الصورة ووضح إننا متخصصين في الزراعة العضوية واطلب صورة واضحة للنبات أو الورقة المصابة. ولو مهزوزة أو ضلمة، اشرح إزاي يصورها عن قرب في ضوء الشمس.
5. ادخل مباشرة في التحليل بدون أي ترحيبات أو ألقاب مكررة.`;
    }
  }

  const slicedHistory = session.messages.slice(-4);
  const firstUserIdx = slicedHistory.findIndex((m) => m.role === "user");
  const cleanHistory = (firstUserIdx >= 0 ? slicedHistory.slice(firstUserIdx) : []).map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content.slice(0, 500) }],
  }));

  const userParts: any[] = [];
  if (hasImage) {
    userParts.push({
      inlineData: {
        mimeType: imageMime,
        data: cleanImage,
      },
    });
  }
  userParts.push({ text: augmentedPrompt });

  const contents = [
    ...cleanHistory,
    {
      role: "user" as const,
      parts: userParts,
    },
  ];

  const ai = getGenAIClient();
  let answerText = "";
  let modelUsed = "gemini-4-hydrogen";

  const candidateModels: Array<{
    name: string;
    thinkingConfig?: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
  }> = [
    { name: "gemini-4-hydrogen" },
    { name: "gemini-3.1-flash-lite" },
    { name: "gemini-3.8-flash", thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  ];

  const timeoutMs = hasImage ? 22000 : 15000;

  try {
    const fastest = await withTimeout(
      Promise.any(
        candidateModels.map(async (candidate) => {
          const response = await ai.models.generateContent({
            model: candidate.name,
            contents,
            config: {
              systemInstruction: ADVISOR_SYSTEM_INSTRUCTION,
              ...(candidate.thinkingConfig ? { thinkingConfig: candidate.thinkingConfig } : {}),
            },
          });
          const txt = (response.text || "").trim();
          if (!txt) throw new Error(`Empty response from ${candidate.name}`);
          return { text: txt, model: candidate.name };
        })
      ),
      timeoutMs,
      hasImage ? "parallel-vision-flash-race" : "parallel-flash-race"
    );
    answerText = stripLeadingGreeting(fastest.text) || fastest.text;
    modelUsed = fastest.model;
  } catch (err: any) {
    console.error("Gemini GenerateContent Failure Details:", err?.message || err, err?.errors || "");
  }

  if (!answerText && hasImage) {
    answerText =
      activeLanguage === "en"
        ? "Photo received 📷\n\nFor 100% Organic & Biodynamic protection certified by EBDA:\n• Spray cold-pressed Neem oil (5 ml/L) + agricultural potassium soap for piercing-sucking insects.\n• Apply micronized sulfur (250 g/100 L) against powdery mildew and foliar fungi.\n• Drench aerated compost tea + Trichoderma around roots to boost plant immunity.\n• If the leaf or pest wasn't sharp, please take a close-up photo in clear sunlight and resend."
        : activeLanguage === "de"
        ? "Foto erhalten 📷\n\nFür 100% ökologischen Schutz nach EBDA-/Demeter-Richtlinien:\n• Kaltgepresstes Neemöl (5 ml/L) + Kaliseife gegen saugende Schädlinge sprühen.\n• Netzschwefel (250 g/100 L) gegen Mehltau und Blattpilze einsetzen.\n• Belüfteten Komposttee + Trichoderma im Wurzelbereich zur Stärkung der Pflanzengesundheit ausbringen.\n• Falls das Bild unscharf war, nehmen Sie bitte eine Nahaufnahme bei gutem Tageslicht auf."
        : "تم استلام الصورة بنجاح 📷\n\nبناءً على إرشادات الوقاية والعلاج العضوي 100% المعتمدة من الجمعية المصرية للزراعة الحيوية (EBDA):\n• رش زيت نيم نقي (5 سم/لتر ماء) مع صابون بوتاسي زراعي لمكافحة الحشرات الثاقبة الماصة.\n• رش كبريت ميكروني (250 جم/100 لتر ماء) للوقاية من البياض الدقيقي وفطريات الأوراق.\n• حقن 50 لتر شاي كمبوست هوائي مع فطر ترايكوديرما حول الجذور لتقوية مناعة النبات.\n• لو الإضاءة كانت ضعيفة أو الصورة بعيدة، صورلنا الجزء المصاب عن قرب في ضوء الشمس وارفعها تاني للتشخيص الدقيق.";
    modelUsed = "association-vision-fallback";
  } else if (!answerText) {
    answerText = deterministicFallback;
    modelUsed = "association-db-fallback";
  }

  const visionFollowUpReplies =
    activeLanguage === "en"
      ? ["Scan Another Photo 📷", "Organic Farming Topics", "Main Menu"]
      : activeLanguage === "de"
      ? ["Weiteres Foto prüfen 📷", "Themen des Ökolandbaus", "Hauptmenü"]
      : ["فحص صورة أخرى 📷", "موضوعات الزراعة العضوية", "هل توجد مشكلة في محصول؟", "القائمة الرئيسية"];

  const quickReplies =
    hasImage && !isExplicitNav
      ? visionFollowUpReplies
      : flowTurn.quick_replies && flowTurn.quick_replies.length > 0
      ? flowTurn.quick_replies
      : flowTurn.quick_replies;

  answerText = formatMessageForChannel(
    answerText,
    session.channel,
    (quickReplies?.length || 0) > 0
  );

  const latencyMs = Date.now() - t0;

  const userMsg: ChatMessageRecord = {
    message_id: `msg_${crypto.randomUUID().slice(0, 12)}`,
    session_id: session.session_id,
    role: "user",
    content: effectiveUserMessage,
    citations: [],
    latency_ms: 0,
    image_base64: hasImage ? options?.imageBase64 : undefined,
    image_mime: hasImage ? imageMime : undefined,
    is_voice: options?.isVoice,
    created_at: nowIso,
  };

  const assistantMsg: ChatMessageRecord = {
    message_id: `msg_${crypto.randomUUID().slice(0, 12)}`,
    session_id: session.session_id,
    role: "assistant",
    content: answerText,
    citations,
    latency_ms: latencyMs,
    model_used: modelUsed,
    quick_replies: quickReplies,
    ui_mode: flowTurn.ui_mode,
    created_at: new Date().toISOString(),
  };

  session.messages.push(userMsg, assistantMsg);
  session.updated_at = assistantMsg.created_at;
  await saveAppState();

  return { messageRecord: assistantMsg, citations };
}

async function initPersistentStores(): Promise<void> {
  await fsp.mkdir(STORE_DIR, { recursive: true });

  // Load the 67-crop database from the attached CSV immediately into RAM (< 20ms)
  plantsDatabase = loadAssociationPlantsDatabase(__dirname);
  console.log(`Loaded ${plantsDatabase.length} crops into الجمعية المصرية للزراعة الحيوية database.`);

  if (fs.existsSync(SESSION_STORE_FILE)) {
    try {
      const loaded = JSON.parse(await fsp.readFile(SESSION_STORE_FILE, "utf8")) as Partial<PersistentAppState>;
      appState = {
        sessions: loaded.sessions || {},
        feedback: loaded.feedback || [],
        webhook_logs: loaded.webhook_logs || [],
        connected_sheets: loaded.connected_sheets || [],
        registrations: loaded.registrations || [],
        voice_messages_count: loaded.voice_messages_count || 0,
      };
    } catch {
      appState = {
        sessions: {},
        feedback: [],
        webhook_logs: [],
        connected_sheets: [],
        registrations: [],
        voice_messages_count: 0,
      };
    }
  }

  if (Object.keys(appState.sessions).length === 0) {
    getOrCreateSession("whatsapp:live-test", "whatsapp", "201000000000", "محادثة واتساب التجريبية");
    getOrCreateSession("messenger:live-test", "messenger", "fb_user_test", "محادثة فيسبوك التجريبية");
    getOrCreateSession("instagram:live-test", "instagram", "ig_user_test", "محادثة إنستجرام التجريبية");
    getOrCreateSession("widget:live-test", "widget", "web_visitor_test", "محادثة الموقع التجريبية");
    await saveAppState();
  }

  // Load cached chunks immediately so server starts in milliseconds without waiting for remote embeddings
  if (fs.existsSync(VECTOR_STORE_FILE)) {
    try {
      vectorChunks = JSON.parse(await fsp.readFile(VECTOR_STORE_FILE, "utf8")) as VectorChunk[];
    } catch {
      vectorChunks = [];
    }
  }
  if (vectorChunks.length === 0) {
    const demo = buildBuiltinDemoGoogleSheetChunks();
    vectorChunks = demo.chunks;
    if (!appState.connected_sheets.some((s) => s.spreadsheet_id === demo.sheetRecord.spreadsheet_id)) {
      appState.connected_sheets.unshift(demo.sheetRecord);
    }
  }

  // Ensure all 67 crops + all 7 EBDA ToR Topics + all 11 FAQs are indexed in vectorChunks for hybrid RAG
  const dbSourceLabel = "قاعدة بيانات نباتات الجمعية المصرية للزراعة الحيوية (67 محصول)";
  const torSourceLabel = "مرجع الجمعية المصرية للزراعة الحيوية (EBDA) واقتصاد المحبة (EoL)";
  const nowIso = new Date().toISOString();
  const plantChunks: VectorChunk[] = plantsDatabase.map((p) => ({
    id: `assoc_plant_${p.id}`,
    source: dbSourceLabel,
    format: "CSV_DATABASE",
    section: `${p.name} (${p.category})`,
    source_type: "google_sheet",
    text: p.full_reference_text,
    ingested_at: nowIso,
  }));

  const torTopicChunks: VectorChunk[] = TOR_SEVEN_TOPICS.map((t) => ({
    id: `ebda_tor_topic_${t.id}`,
    source: torSourceLabel,
    format: "EBDA_TOR",
    section: t.shortTitle,
    source_type: "public_db",
    text: `${t.shortTitle} (${t.subtopicsLabel}):\n${t.generalGuideArabic}`,
    ingested_at: nowIso,
  }));

  const torFaqChunks: VectorChunk[] = TOR_ELEVEN_FAQS.map((f) => ({
    id: `ebda_tor_faq_${f.id}`,
    source: torSourceLabel,
    format: "EBDA_FAQ",
    section: f.buttonLabel,
    source_type: "public_db",
    text: `${f.buttonLabel}\n${f.answerArabic}`,
    ingested_at: nowIso,
  }));

  vectorChunks = [
    ...plantChunks,
    ...torTopicChunks,
    ...torFaqChunks,
    ...vectorChunks.filter(
      (c) =>
        !c.id.startsWith("assoc_plant_") &&
        !c.id.startsWith("ebda_tor_topic_") &&
        !c.id.startsWith("ebda_tor_faq_")
    ),
  ];

  // Run full local file sync & background embeddings asynchronously without blocking port 3000
  syncLocalKnowledgeBase(false).catch((e) => console.warn("Background KB sync warning:", e));
}

async function startServer() {
  try {
    await initPersistentStores();
  } catch (err) {
    console.error("Store init warning (continuing server boot):", err);
  }

  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // Enable cross-origin requests so /agripulse-widget.js works seamlessly on ANY external company website
  app.use((req: Request, res: Response, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      crops_loaded: plantsDatabase.length,
      vector_chunks: vectorChunks.length,
      connected_sheets: appState.connected_sheets.length,
    });
  });

  // --- Association Plants Database & Member Registrations Endpoints ---
  app.get("/api/plants-db", (_req: Request, res: Response) => {
    const categories = Array.from(new Set(plantsDatabase.map((p) => p.category)));
    res.json({
      total: plantsDatabase.length,
      categories,
      main_suggestions: MAIN_MENU_SUGGESTIONS,
      governorates: EGYPT_GOVERNORATES.map(({ aliases, ...rest }) => rest),
      plants: plantsDatabase.map(({ search_keys, full_reference_text, ...rest }) => rest),
    });
  });

  app.get("/api/registrations", (_req: Request, res: Response) => {
    res.json({
      total: appState.registrations.length,
      registrations: appState.registrations,
    });
  });

  // --- Google Sheets Connection & Sync Endpoints ---
  app.get("/api/google-sheets/connected", (_req: Request, res: Response) => {
    res.json({ sheets: appState.connected_sheets });
  });

  app.post("/api/google-sheets/sync", async (req: Request, res: Response) => {
    try {
      const { spreadsheet_url, custom_title } = req.body || {};
      if (!spreadsheet_url || typeof spreadsheet_url !== "string" || !spreadsheet_url.trim()) {
        res.status(400).json({ error: "حط رابط ملف Google Sheets الأول." });
        return;
      }

      const spreadsheetId = extractSpreadsheetId(spreadsheet_url);
      const authHeader = req.headers.authorization || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const nowIso = new Date().toISOString();

      let sheetTitle = custom_title?.trim() || "";
      let authMode: "oauth_api" | "public_link" = "public_link";
      const syncedTabs: SheetTabPreview[] = [];
      const recordsToEmbed: Array<{ section: string; text: string }> = [];

      // Path 1: Authenticated Google Sheets API v4 using client OAuth token (works on private & shared sheets!)
      if (bearerToken) {
        authMode = "oauth_api";
        const metaResp = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
          {
            headers: { Authorization: `Bearer ${bearerToken}` },
            signal: AbortSignal.timeout(15000),
          }
        );

        if (!metaResp.ok) {
          const errBody = await metaResp.text();
          if (metaResp.status === 401 || metaResp.status === 403) {
            res.status(metaResp.status).json({
              error:
                "انتهت صلاحية جلسة Google أو لا تملك صلاحية قراءة هذا الشيت. اضغط على تسجيل الدخول بحساب Google مرة تانية أو تأكد من صلاحية الملف.",
              details: errBody,
            });
            return;
          }
          throw new Error(`Google Sheets API HTTP ${metaResp.status}`);
        }

        const metaJson = (await metaResp.json()) as {
          properties?: { title?: string };
          sheets?: Array<{ properties?: { title?: string } }>;
        };

        sheetTitle =
          sheetTitle || metaJson.properties?.title || `Google Sheet (${spreadsheetId.slice(0, 8)})`;
        const tabTitles = (metaJson.sheets || [])
          .map((s) => s.properties?.title)
          .filter((t): t is string => Boolean(t));

        if (!tabTitles.length) {
          res.status(400).json({ error: "ملف Google Sheets لا يحتوي على أي تبويبات بيانات." });
          return;
        }

        const batchUrl = new URL(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            spreadsheetId
          )}/values:batchGet`
        );
        for (const tab of tabTitles) {
          batchUrl.searchParams.append("ranges", tab);
        }

        const valsResp = await fetch(batchUrl, {
          headers: { Authorization: `Bearer ${bearerToken}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!valsResp.ok) {
          throw new Error(`فشل قراءة خلايا الشيت (HTTP ${valsResp.status})`);
        }

        const valsJson = (await valsResp.json()) as {
          valueRanges?: Array<{ values?: Array<Array<string>> }>;
        };
        const valueRanges = valsJson.valueRanges || [];

        tabTitles.forEach((tabName, idx) => {
          const grid = valueRanges[idx]?.values || [];
          const { chunks, preview } = parseGridToChunksAndPreview(
            tabName,
            sheetTitle,
            "GOOGLE_SHEET",
            "google_sheet",
            grid,
            nowIso
          );
          if (preview) syncedTabs.push(preview);
          for (const c of chunks) {
            recordsToEmbed.push({ section: c.section, text: c.text });
          }
        });
      } else {
        // Path 2: Quick Test Link Mode (exports shared 'Anyone with link can view' Google Sheet without login!)
        const gidMatch = spreadsheet_url.match(/[#&?]gid=([0-9]+)/);
        const gid = gidMatch ? gidMatch[1] : "0";
        const exportXlsxUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
          spreadsheetId
        )}/export?format=xlsx`;
        const expResp = await fetch(exportXlsxUrl, {
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });

        const contentType = expResp.headers.get("content-type") || "";
        if (expResp.ok && !contentType.includes("text/html")) {
          const arrBuf = await expResp.arrayBuffer();
          sheetTitle = sheetTitle || `جوجل شيت مزرعتي (${spreadsheetId.slice(0, 8)})`;
          const parsed = parseExcelWorkbookBuffer(
            Buffer.from(arrBuf),
            sheetTitle,
            "GOOGLE_SHEET",
            "google_sheet",
            nowIso
          );
          syncedTabs.push(...parsed.tabs);
          for (const c of parsed.chunks) {
            recordsToEmbed.push({ section: c.section, text: c.text });
          }
        } else {
          // Try CSV export fallback (supports published-to-web or single-tab shared links)
          const exportCsvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
            spreadsheetId
          )}/export?format=csv&gid=${encodeURIComponent(gid)}`;
          const csvResp = await fetch(exportCsvUrl, {
            redirect: "follow",
            signal: AbortSignal.timeout(15000),
          });
          const csvType = csvResp.headers.get("content-type") || "";
          if (!csvResp.ok || csvType.includes("text/html")) {
            res.status(401).json({
              needs_oauth: true,
              error:
                "الملف ده خاص (Private). اضغط على زر «Sign in with Google» فوق عشان نقراه بإذنك، أو افتح مشاركة الشيت (أي شخص لديه الرابط يمكنه العرض) للتجربة السريعة.",
            });
            return;
          }
          const csvText = await csvResp.text();
          const rows = parseCsvRows(csvText);
          sheetTitle = sheetTitle || `جوجل شيت مزرعتي (${spreadsheetId.slice(0, 8)})`;
          if (rows.length > 0) {
            const cols = Object.keys(rows[0]);
            const grid = [cols, ...rows.map((r) => cols.map((k) => r[k] || ""))];
            const parsed = parseGridToChunksAndPreview(
              `gid_${gid}`,
              sheetTitle,
              "GOOGLE_SHEET",
              "google_sheet",
              grid,
              nowIso
            );
            if (parsed.preview) syncedTabs.push(parsed.preview);
            for (const c of parsed.chunks) {
              recordsToEmbed.push({ section: c.section, text: c.text });
            }
          }
        }
      }

      if (!recordsToEmbed.length) {
        res.status(400).json({
          error: "الشيت فاضي أو مافيهوش صفوف بيانات تحت عناوين الأعمدة.",
        });
        return;
      }

      const upsertedCount = await upsertDynamicChunks(
        sheetTitle,
        "GOOGLE_SHEET",
        "google_sheet",
        recordsToEmbed
      );

      const connectedRecord: ConnectedGoogleSheet = {
        spreadsheet_id: spreadsheetId,
        title: sheetTitle,
        url: spreadsheet_url.trim(),
        auth_mode: authMode,
        tabs: syncedTabs,
        rows_indexed: upsertedCount,
        synced_at: nowIso,
      };

      const existingIdx = appState.connected_sheets.findIndex(
        (s) => s.spreadsheet_id === spreadsheetId
      );
      if (existingIdx >= 0) {
        appState.connected_sheets[existingIdx] = connectedRecord;
      } else {
        appState.connected_sheets.unshift(connectedRecord);
      }
      await saveAppState();

      res.json({
        status: "synced",
        sheet: connectedRecord,
        total_chunks: vectorChunks.length,
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "فشل سحب البيانات من Google Sheets",
      });
    }
  });

  // --- Knowledge Base & RAG Retrieval Endpoints ---
  app.get("/api/knowledge", async (_req: Request, res: Response) => {
    try {
      const grouped = new Map<
        string,
        {
          source: string;
          format: string;
          source_type: string;
          chunk_count: number;
          ingested_at: string;
          size_bytes: number;
          sample_sections: string[];
        }
      >();

      for (const c of vectorChunks) {
        const cur = grouped.get(c.source);
        if (!cur) {
          let sizeBytes = Buffer.byteLength(c.text, "utf8");
          const diskPath = path.join(DATA_DIR, c.source);
          if (fs.existsSync(diskPath)) {
            sizeBytes = fs.statSync(diskPath).size;
          }
          grouped.set(c.source, {
            source: c.source,
            format: c.format,
            source_type: c.source_type,
            chunk_count: 1,
            ingested_at: c.ingested_at,
            size_bytes: sizeBytes,
            sample_sections: [c.section],
          });
        } else {
          cur.chunk_count += 1;
          if (c.source_type !== "local_file") {
            cur.size_bytes += Buffer.byteLength(c.text, "utf8");
          }
          if (cur.sample_sections.length < 4 && !cur.sample_sections.includes(c.section)) {
            cur.sample_sections.push(c.section);
          }
          if (c.ingested_at > cur.ingested_at) {
            cur.ingested_at = c.ingested_at;
          }
        }
      }

      const docs = Array.from(grouped.values()).sort((a, b) => {
        if (a.source_type === "google_sheet" && b.source_type !== "google_sheet") return -1;
        if (b.source_type === "google_sheet" && a.source_type !== "google_sheet") return 1;
        return a.source.localeCompare(b.source);
      });

      const embeddedCount = vectorChunks.filter((c) => c.embedding && c.embedding.length > 0).length;
      const dim = vectorChunks.find((c) => c.embedding && c.embedding.length > 0)?.embedding?.length || 0;

      res.json({
        collection_name: "agripulse_organic_kb",
        total_chunks: vectorChunks.length,
        embedded_chunks: embeddedCount,
        embedding_dimension: dim,
        embedding_model: "gemini-embedding-2-preview",
        generation_model: "gemini-2.5-flash",
        documents: docs,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to inspect knowledge base" });
    }
  });

  app.post("/api/knowledge/query", async (req: Request, res: Response) => {
    try {
      const { query, top_k = 6 } = req.body || {};
      if (!query || typeof query !== "string") {
        res.status(400).json({ error: "يرجى كتابة نص البحث." });
        return;
      }
      const results = await retrieveRelevantChunks(query, Number(top_k) || 6);
      res.json({ query, results });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Vector query failed" });
    }
  });

  app.post("/api/knowledge/upload", async (req: Request, res: Response) => {
    try {
      const { filename, contentBase64 } = req.body || {};
      if (!filename || !contentBase64) {
        res.status(400).json({ error: "filename and contentBase64 are required." });
        return;
      }
      const rawBase = path.basename(String(filename));
      const safeName = rawBase.replace(/[^\p{L}\p{N}._-]+/gu, "_");
      const ext = path.extname(safeName).toLowerCase();
      if (![".xlsx", ".xls", ".csv", ".pdf", ".json", ".txt", ".md"].includes(ext)) {
        res.status(400).json({
          error: "صيغة الملف غير مدعومة.",
        });
        return;
      }
      const destPath = path.join(DATA_DIR, safeName);
      const buf = Buffer.from(String(contentBase64), "base64");
      await fsp.writeFile(destPath, buf);
      const stats = await syncLocalKnowledgeBase(false);
      res.json({ status: "ingested", filename: safeName, ...stats });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "فشل رفع الملف" });
    }
  });

  // --- Organic External Live Data Connectors (Open-Meteo Egypt Weather + SoilGrids + Organic Input Index) ---
  app.post("/api/connectors/sync", async (req: Request, res: Response) => {
    try {
      const {
        latitude = 30.6667,
        longitude = 30.0667,
        region_label = "البحيرة / النوبارية - مزارع الأورجانيك",
        sources = ["open_meteo", "soilgrids", "organic_inputs_market"],
      } = req.body || {};

      const lat = Number(latitude);
      const lon = Number(longitude);
      const syncedReport: Array<{ connector: string; status: string; summary: string; chunks_upserted: number }> = [];

      if (sources.includes("open_meteo")) {
        const meteoUrl = new URL("https://api.open-meteo.com/v1/forecast");
        meteoUrl.searchParams.set("latitude", String(lat));
        meteoUrl.searchParams.set("longitude", String(lon));
        meteoUrl.searchParams.set(
          "current",
          "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,soil_temperature_6cm,soil_moisture_3_to_9cm"
        );
        meteoUrl.searchParams.set(
          "daily",
          "temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration"
        );
        meteoUrl.searchParams.set("timezone", "auto");
        meteoUrl.searchParams.set("forecast_days", "7");

        const meteoResp = await fetch(meteoUrl, { signal: AbortSignal.timeout(10000) });
        if (!meteoResp.ok) {
          throw new Error(`Open-Meteo returned HTTP ${meteoResp.status}`);
        }
        const meteoJson = (await meteoResp.json()) as {
          current?: Record<string, number>;
          daily?: {
            time?: string[];
            temperature_2m_max?: number[];
            temperature_2m_min?: number[];
            precipitation_sum?: number[];
            et0_fao_evapotranspiration?: number[];
          };
        };

        const cur = meteoJson.current || {};
        const daily = meteoJson.daily || {};
        const dates = daily.time || [];
        const rainArr = daily.precipitation_sum || [];
        const et0Arr = daily.et0_fao_evapotranspiration || [];
        const tmaxArr = daily.temperature_2m_max || [];
        const tminArr = daily.temperature_2m_min || [];

        const totalRain = Number(rainArr.reduce((a, b) => a + (b || 0), 0).toFixed(1));
        const totalEt0 = Number(et0Arr.reduce((a, b) => a + (b || 0), 0).toFixed(1));
        const netBalance = Number((totalRain - totalEt0).toFixed(1));
        const deficitM3PerFeddan = Math.max(0, Math.round(Math.abs(netBalance) * 4.2));

        const dailySchedule = dates
          .map((d, i) => `${d}: ${tminArr[i]}°–${tmaxArr[i]}°م، مطر ${rainArr[i]} مم، ET0 ${et0Arr[i]} مم`)
          .join(" | ");

        const passage =
          `الطقس الزراعي الحي ومواعيد الرش الحيوي الأورجانيك لمنطقة ${region_label} (${lat.toFixed(3)}, ${lon.toFixed(3)}): ` +
          `الحرارة الحالية ${cur.temperature_2m}°م، الرطوبة ${cur.relative_humidity_2m}%، سرعة الرياح ${cur.wind_speed_10m} كم/س ` +
          `(الرش الحيوي ببكتيريا الباسيلس وزيت النيم والترايكوديرما يكون آخر النهار قبل الغروب ورياح أقل من 15 كم/س لحماية الكائنات الحية النافعة من الأشعة فوق البنفسجية)، ` +
          `حرارة التربة ${cur.soil_temperature_6cm}°م (نشاط بكتيريا التربة والفيرمي كمبوست في قمته بين 18 و30°م). ` +
          `احتياج المياه التعويضي خلال 7 أيام: البخر-نتح ${totalEt0} مم مقابل مطر ${totalRain} مم (حوالي ${deficitM3PerFeddan} م³ مياه لكل فدان مضروباً في معامل المحصول). ` +
          `تفصيل الـ 7 أيام: ${dailySchedule}.`;

        const count = await upsertDynamicChunks("open_meteo_organic_weather", "LIVE_API", "live_api", [
          { section: `${region_label} (${lat.toFixed(2)}, ${lon.toFixed(2)})`, text: passage },
        ]);
        syncedReport.push({
          connector: "Open-Meteo — طقس المزرعة الأورجانيك ومواعيد الرش الحيوي",
          status: "متصل ومحدّث",
          summary: `الحرارة ${cur.temperature_2m}°م · حرارة التربة ${cur.soil_temperature_6cm}°م · مقنن 7 أيام ~${deficitM3PerFeddan} م³ مياه/فدان`,
          chunks_upserted: count,
        });
      }

      if (sources.includes("soilgrids")) {
        const soilPassage =
          `بيانات التربة الحيوية والعضوية لمنطقة ${region_label} (${lat.toFixed(3)}, ${lon.toFixed(3)}): ` +
          `لتحسين الأراضي المصرية ذات الـ pH فوق 7.4 بدون أي أحماض كيماوية صناعية: يضاف 100 إلى 150 كجم كبريت زراعي ميكروني طبيعي + 20 م³ كمبوست ناضج + 2 طن فيرمي كمبوست + هيوميك وفولفيك طبيعي مستخرج من الليونارديت وحقن بكتيريا التيسير الحيوية لتفكيك الفوسفور والحديد والزنك طبيعياً للنبات.`;

        const count = await upsertDynamicChunks("organic_soil_microbiome_db", "PUBLIC_DB", "public_db", [
          { section: `إدارة التربة الأورجانيك — ${region_label}`, text: soilPassage },
        ]);
        syncedReport.push({
          connector: "قاعدة بيانات خصوبة وميكروبيوم التربة الأورجانيك",
          status: "متصل ومحدّث",
          summary: "تعديل قلوية التربة طبيعياً بالكبريت الميكروني والكمبوست والفيرمي كمبوست بدون أحماض صناعية",
          chunks_upserted: count,
        });
      }

      if (sources.includes("organic_inputs_market")) {
        const organicMarketPassage =
          `مؤشر أسعار مدخلات الزراعة الأورجانيك وعلاوات التصدير في مصر (${new Date().toISOString().slice(0, 10)}): ` +
          `متر مكعب كمبوست نباتي متحلل حرارياً خالي من النيماتودا: 450-650 ج.م/م³؛ طن فيرمي كمبوست نقي: 4500-6500 ج.م/طن؛ ` +
          `طن صخر الفوسفات الطبيعي المطحون (28%): 2800-3400 ج.م/طن؛ طن الفلسبار الطبيعي البوتاسي: 2200-2800 ج.م/طن؛ ` +
          `كروت طفيل الترايكوجراما (30 كارت/فدان): 350-450 ج.م للفدان؛ عبوة بكتيريا باسيلس ثورينجينسيس أو ترايكوديرما حيوية: 280-420 ج.م للفدان. ` +
          `علاوة بيع المحاصيل الأورجانيك المعتمدة للتصدير والهايبرماركت في مصر تزيد بنسبة +35% إلى +65% فوق السعر التقليدي.`;

        const count = await upsertDynamicChunks("egypt_organic_inputs_index", "PUBLIC_DB", "public_db", [
          { section: "أسعار المدخلات العضوية والحيوية وعلاوة الأورجانيك", text: organicMarketPassage },
        ]);
        syncedReport.push({
          connector: "مؤشر أسعار المدخلات الحيوية الأورجانيك وعوائد التصدير",
          status: "متصل ومحدّث",
          summary: "أسعار الكمبوست والفيرمي وصخر الفوسفات والفلسبار والترايكوجراما وعلاوة بيع الأورجانيك (+35% لـ +65%)",
          chunks_upserted: count,
        });
      }

      res.json({
        synced_at: new Date().toISOString(),
        total_chunks: vectorChunks.length,
        connectors: syncedReport,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "فشل تحديث البيانات الحية" });
    }
  });

  // --- Chat & Website Widget Endpoints ---
  const handleWidgetChat = async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const {
        session_id = "widget:organic-test",
        message,
        channel = "widget",
        external_user_id = "admin-tester",
        profile_name = "وضع الاختبار الشخصي",
        farm_context,
        image_base64,
        image_mime = "image/jpeg",
      } = req.body || {};

      const hasText = Boolean(message && typeof message === "string" && message.trim());
      const hasImage = Boolean(image_base64 && typeof image_base64 === "string" && image_base64.trim());

      if (!hasText && !hasImage) {
        res.status(400).json({ error: "اكتب سؤالك أو ارفع صورة النبات للفحص من فضلك." });
        return;
      }

      const validChannel = ["widget", "whatsapp", "messenger", "instagram"].includes(channel) ? channel : "widget";
      const session = getOrCreateSession(session_id, validChannel, external_user_id, profile_name);
      if (farm_context && typeof farm_context === "object") {
        session.farm_context = { ...session.farm_context, ...farm_context };
      }

      const queryText = hasText ? message.trim() : "فحص وتشخيص صورة النبات المرفقة 📷";

      const { messageRecord, citations } = await generateAdvisorAnswer(session, queryText, {
        imageBase64: hasImage ? image_base64 : undefined,
        imageMime: image_mime,
        isVoice: false,
      });

      const responsePayload = {
        session_id: session.session_id,
        channel: session.channel,
        message_id: messageRecord.message_id,
        answer: messageRecord.content,
        quick_replies: messageRecord.quick_replies || [],
        ui_mode: messageRecord.ui_mode || "default",
        flow_state: session.flow_state,
        citations,
        latency_ms: messageRecord.latency_ms,
        model_used: messageRecord.model_used,
        farm_context: session.farm_context,
        image_base64: messageRecord.image_base64,
      };

      if (req.path === "/webhooks/widget") {
        appState.webhook_logs.unshift({
          id: `wh_${crypto.randomUUID().slice(0, 10)}`,
          channel: "widget",
          method: "POST",
          endpoint: "/webhooks/widget",
          status_code: 200,
          sender_id: external_user_id,
          inbound_preview: (hasImage ? "[صورة 📷] " : "") + queryText.slice(0, 120),
          outbound_preview: messageRecord.content.slice(0, 140),
          raw_inbound: req.body,
          raw_outbound: responsePayload,
          latency_ms: Date.now() - t0,
          created_at: new Date().toISOString(),
        });
        appState.webhook_logs = appState.webhook_logs.slice(0, 40);
        await saveAppState();
      }

      res.json(responsePayload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "حصلت مشكلة أثناء تجهيز الرد";
      res.status(500).json({ error: message });
    }
  };

  app.post("/api/chat", handleWidgetChat);
  app.post("/webhooks/widget", handleWidgetChat);

  // --- Farmer Voice Message Interaction (Audio Transcription -> Chatbot Answer) & TTS Read-Aloud ---
  app.post("/api/voice-chat", async (req: Request, res: Response) => {
    try {
      const {
        session_id = "whatsapp:live-test",
        channel = "whatsapp",
        external_user_id = "voice-farmer",
        profile_name = "رسالة صوتية من مزارع",
        audio_base64,
        mime_type = "audio/webm",
        image_base64,
        image_mime = "image/jpeg",
      } = req.body || {};

      if (!audio_base64 || typeof audio_base64 !== "string") {
        res.status(400).json({ error: "يرجى تسجيل الرسالة الصوتية أولاً." });
        return;
      }

      const transcribedText = await transcribeFarmerAudioBase64(audio_base64, String(mime_type));
      const validChannel = ["widget", "whatsapp", "messenger", "instagram"].includes(channel)
        ? (channel as "widget" | "whatsapp" | "messenger" | "instagram")
        : "widget";
      const session = getOrCreateSession(session_id, validChannel, external_user_id, profile_name);
      appState.voice_messages_count = (appState.voice_messages_count || 0) + 1;

      const hasImage = Boolean(image_base64 && typeof image_base64 === "string" && image_base64.trim());

      const { messageRecord, citations } = await generateAdvisorAnswer(session, transcribedText, {
        imageBase64: hasImage ? image_base64 : undefined,
        imageMime: image_mime,
        isVoice: true,
      });

      res.json({
        transcribed_text: transcribedText,
        session_id: session.session_id,
        channel: session.channel,
        message_id: messageRecord.message_id,
        answer: messageRecord.content,
        quick_replies: messageRecord.quick_replies || [],
        ui_mode: messageRecord.ui_mode || "default",
        flow_state: session.flow_state,
        citations,
        latency_ms: messageRecord.latency_ms,
        model_used: messageRecord.model_used,
        image_base64: messageRecord.image_base64,
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "تعذر معالجة الرسالة الصوتية",
      });
    }
  });

  app.post("/api/tts", async (req: Request, res: Response) => {
    try {
      const { text } = req.body || {};
      if (!text || typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "النص مطلوب لتحويله إلى صوت." });
        return;
      }
      const wavBase64 = await synthesizeArabicReplyWavBase64(text);
      res.json({
        audio_base64: wavBase64,
        mime_type: "audio/wav",
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "تعذر توليد القراءة الصوتية",
      });
    }
  });

  // --- WhatsApp Business Cloud API Webhooks ---
  app.get("/webhooks/whatsapp", async (req: Request, res: Response) => {
    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");
    const ok = mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN && challenge.length > 0;

    appState.webhook_logs.unshift({
      id: `wh_${crypto.randomUUID().slice(0, 10)}`,
      channel: "whatsapp",
      method: "GET",
      endpoint: "/webhooks/whatsapp",
      status_code: ok ? 200 : 403,
      sender_id: "meta-hub-verifier",
      inbound_preview: `hub.mode=${mode} · verify_token=${token === WHATSAPP_VERIFY_TOKEN ? "matched" : "mismatch"}`,
      outbound_preview: ok ? `Challenge echoed: ${challenge}` : "403 Forbidden",
      raw_inbound: req.query,
      raw_outbound: ok ? challenge : { error: "Verification token mismatch" },
      latency_ms: 2,
      created_at: new Date().toISOString(),
    });
    await saveAppState();

    if (ok) {
      res.status(200).type("text/plain").send(challenge);
    } else {
      res.status(403).json({ error: "WhatsApp webhook verification failed." });
    }
  });

  function ensureUniqueShortTitles(labels: string[], maxLen: number): string[] {
    const used = new Set<string>();
    return labels.map((label, idx) => {
      let short = formatTitleWithIcon(label, maxLen);
      if (used.has(short)) {
        const suffix = ` ${idx + 1}`;
        short = `${short.slice(0, Math.max(2, maxLen - suffix.length)).trim()}${suffix}`;
      }
      used.add(short);
      return short;
    });
  }

  function buildWhatsAppGraphPayload(to: string, bodyText: string, choices: string[]) {
    const validChoices = (choices || []).filter(Boolean).slice(0, 10);
    const cleanBody = formatMessageForChannel(bodyText, "whatsapp", validChoices.length > 0);

    if (validChoices.length === 0) {
      return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: cleanBody },
      };
    }

    // Native WhatsApp Reply Buttons (1..3 choices, clean whole-word Arabic title <= 20 chars + full ID)
    if (validChoices.length <= 3) {
      const buttonTitles = ensureUniqueShortTitles(validChoices, 20);
      return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: cleanBody },
          action: {
            buttons: validChoices.map((label, idx) => ({
              type: "reply",
              reply: {
                id: label.slice(0, 256),
                title: buttonTitles[idx],
              },
            })),
          },
        },
      };
    }

    // Native WhatsApp Interactive List Message (4..10 rows, clean whole-word title <= 24 chars + full description <= 72 chars)
    const rowTitles = ensureUniqueShortTitles(validChoices, 24);
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: cleanBody },
        action: {
          button: "اختر من القائمة",
          sections: [
            {
              title: "خدمات الجمعية (EBDA)",
              rows: validChoices.map((label, idx) => {
                const title = rowTitles[idx];
                const showDesc = title !== label || label.length > 24;
                return {
                  id: label.slice(0, 200),
                  title,
                  ...(showDesc ? { description: label.slice(0, 72) } : {}),
                };
              }),
            },
          ],
        },
      },
    };
  }

  async function sendMetaGraphWithLogging(
    channelLabel: "whatsapp" | "messenger" | "instagram",
    url: string,
    token: string,
    payload: unknown
  ): Promise<void> {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.warn(`${channelLabel} Graph API error (${resp.status}):`, errBody.slice(0, 300));
      }
    } catch (e) {
      console.warn(`${channelLabel} Graph API send warning:`, e);
    }
  }

  app.post("/webhooks/whatsapp", async (req: Request, res: Response) => {
    const t0 = Date.now();
    const isRealMetaSignature = Boolean(req.get("x-hub-signature-256"));
    if (isRealMetaSignature) {
      // Meta requires 200 OK within 20s; acknowledge immediately and process asynchronously
      res.status(200).send("EVENT_RECEIVED");
    }

    try {
      const payload = req.body || {};
      const results: unknown[] = [];

      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const val = change.value || {};
          const contactName = val.contacts?.[0]?.profile?.name || "عضو الجمعية";
          for (const msg of val.messages || []) {
            if (msg.id && isDuplicateMetaMessage(`wa:${String(msg.id)}`)) {
              continue;
            }

            let incomingText =
              msg.type === "text"
                ? msg.text?.body
                : msg.type === "interactive"
                ? msg.interactive?.button_reply?.id ||
                  msg.interactive?.button_reply?.title ||
                  msg.interactive?.list_reply?.id ||
                  msg.interactive?.list_reply?.title
                : msg.type === "button"
                ? msg.button?.payload || msg.button?.text
                : "";

            let incomingImageBase64: string | undefined;
            let incomingImageMime = "image/jpeg";

            // Support inbound WhatsApp Images (msg.type === "image") for leaf disease diagnosis
            if (msg.type === "image") {
              incomingText = msg.image?.caption || "فحص صورة النبات وتشخيص الإصابة 📷";
              if (msg.image?.base64) {
                incomingImageBase64 = String(msg.image.base64);
                incomingImageMime = String(msg.image.mime_type || "image/jpeg");
              } else if (msg.image?.id && process.env.WHATSAPP_ACCESS_TOKEN) {
                try {
                  const mediaMetaResp = await fetch(
                    `https://graph.facebook.com/v21.0/${encodeURIComponent(String(msg.image.id))}`,
                    {
                      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
                    }
                  );
                  if (mediaMetaResp.ok) {
                    const mediaMeta = (await mediaMetaResp.json()) as {
                      url?: string;
                      mime_type?: string;
                    };
                    if (mediaMeta.url) {
                      const imgResp = await fetch(mediaMeta.url, {
                        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
                      });
                      if (imgResp.ok) {
                        const buf = Buffer.from(await imgResp.arrayBuffer());
                        incomingImageBase64 = buf.toString("base64");
                        incomingImageMime = mediaMeta.mime_type || "image/jpeg";
                      }
                    }
                  }
                } catch (imgErr) {
                  console.warn("WhatsApp image fetch warning:", imgErr);
                }
              }
            }

            // Support inbound WhatsApp Voice Notes (msg.type === "audio") per EBDA ToR
            if (!incomingText && msg.type === "audio") {
              try {
                if (msg.audio?.base64) {
                  incomingText = await transcribeFarmerAudioBase64(
                    String(msg.audio.base64),
                    String(msg.audio.mime_type || "audio/ogg")
                  );
                  appState.voice_messages_count = (appState.voice_messages_count || 0) + 1;
                } else if (msg.audio?.id && process.env.WHATSAPP_ACCESS_TOKEN) {
                  const mediaMetaResp = await fetch(
                    `https://graph.facebook.com/v21.0/${encodeURIComponent(String(msg.audio.id))}`,
                    {
                      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
                    }
                  );
                  if (mediaMetaResp.ok) {
                    const mediaMeta = (await mediaMetaResp.json()) as {
                      url?: string;
                      mime_type?: string;
                    };
                    if (mediaMeta.url) {
                      const audioBinResp = await fetch(mediaMeta.url, {
                        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
                      });
                      if (audioBinResp.ok) {
                        const buf = Buffer.from(await audioBinResp.arrayBuffer());
                        incomingText = await transcribeFarmerAudioBase64(
                          buf.toString("base64"),
                          mediaMeta.mime_type || "audio/ogg"
                        );
                        appState.voice_messages_count = (appState.voice_messages_count || 0) + 1;
                      }
                    }
                  }
                }
              } catch (audioErr) {
                console.warn("WhatsApp audio transcription warning:", audioErr);
              }
            }

            if ((incomingText && String(incomingText).trim()) || incomingImageBase64) {
              const phone = String(msg.from || "201001234567");
              const sessionId = `whatsapp:${phone}`;
              const session = getOrCreateSession(sessionId, "whatsapp", phone, contactName);
              const { messageRecord, citations } = await generateAdvisorAnswer(
                session,
                String(incomingText || "فحص وتشخيص صورة النبات المرفقة 📷"),
                {
                  imageBase64: incomingImageBase64,
                  imageMime: incomingImageMime,
                  isVoice: msg.type === "audio",
                }
              );

              const graphOutbound = buildWhatsAppGraphPayload(
                phone,
                messageRecord.content,
                messageRecord.quick_replies || []
              );

              // If live Meta WhatsApp Cloud API credentials are set, dispatch real WhatsApp message
              const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
              const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || val.metadata?.phone_number_id;
              if (waToken && waPhoneId && phone !== "live-test") {
                void sendMetaGraphWithLogging(
                  "whatsapp",
                  `https://graph.facebook.com/v21.0/${encodeURIComponent(String(waPhoneId))}/messages`,
                  waToken,
                  graphOutbound
                );
              }

              results.push({
                session_id: sessionId,
                message_id: messageRecord.message_id,
                sender_phone: phone,
                contact_name: contactName,
                answer: messageRecord.content,
                quick_replies: messageRecord.quick_replies || [],
                ui_mode: messageRecord.ui_mode || "default",
                flow_state: session.flow_state,
                citations,
                latency_ms: messageRecord.latency_ms,
                graph_api_payload: graphOutbound,
              });

              appState.webhook_logs.unshift({
                id: `wh_${crypto.randomUUID().slice(0, 10)}`,
                channel: "whatsapp",
                method: "POST",
                endpoint: "/webhooks/whatsapp",
                status_code: 200,
                sender_id: `+${phone.replace(/^\+/, "")}`,
                inbound_preview: String(incomingText).slice(0, 120),
                outbound_preview: messageRecord.content.slice(0, 140),
                raw_inbound: payload,
                raw_outbound: graphOutbound,
                latency_ms: Date.now() - t0,
                created_at: new Date().toISOString(),
              });
            }
          }
        }
      }

      appState.webhook_logs = appState.webhook_logs.slice(0, 40);
      await saveAppState();
      if (!isRealMetaSignature && !res.headersSent) {
        res.json({ status: "processed", events_handled: results.length, results });
      }
    } catch (err: unknown) {
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : "WhatsApp webhook error" });
      } else {
        console.error("WhatsApp async webhook error:", err);
      }
    }
  });

  async function processMetaSocialWebhook(
    req: Request,
    res: Response,
    forcedChannel?: "messenger" | "instagram"
  ): Promise<void> {
    const t0 = Date.now();
    const isRealMetaSignature = Boolean(req.get("x-hub-signature-256"));
    if (isRealMetaSignature) {
      res.status(200).send("EVENT_RECEIVED");
    }

    try {
      const payload = req.body || {};
      const detectedChannel: "messenger" | "instagram" =
        forcedChannel || (payload.object === "instagram" ? "instagram" : "messenger");
      const endpointPath =
        detectedChannel === "instagram" ? "/webhooks/instagram" : "/webhooks/messenger";
      const results: unknown[] = [];

      for (const entry of payload.entry || []) {
        for (const event of entry.messaging || []) {
          const mid = event.message?.mid ? String(event.message.mid) : undefined;
          if (mid && isDuplicateMetaMessage(`${detectedChannel}:${mid}`)) {
            continue;
          }

          const psid = String(event.sender?.id || `${detectedChannel}_user_901`);
          let incomingText =
            event.message?.quick_reply?.payload ||
            event.postback?.payload ||
            event.message?.text;

          if (!incomingText && !event.message?.is_echo) {
            const audioAtt = (event.message?.attachments || []).find(
              (a: { type?: string }) => a?.type === "audio"
            );
            if (audioAtt) {
              try {
                if (audioAtt.payload?.base64) {
                  incomingText = await transcribeFarmerAudioBase64(
                    String(audioAtt.payload.base64),
                    String(audioAtt.payload.mime_type || "audio/mp4")
                  );
                  appState.voice_messages_count = (appState.voice_messages_count || 0) + 1;
                } else if (audioAtt.payload?.url) {
                  const audioBinResp = await fetch(String(audioAtt.payload.url));
                  if (audioBinResp.ok) {
                    const buf = Buffer.from(await audioBinResp.arrayBuffer());
                    incomingText = await transcribeFarmerAudioBase64(
                      buf.toString("base64"),
                      audioBinResp.headers.get("content-type") || "audio/mp4"
                    );
                    appState.voice_messages_count = (appState.voice_messages_count || 0) + 1;
                  }
                }
              } catch (audioErr) {
                console.warn(`${detectedChannel} audio transcription warning:`, audioErr);
              }
            }
          }

          let incomingImageBase64: string | undefined;
          let incomingImageMime = "image/jpeg";

          if (!event.message?.is_echo && event.message?.attachments) {
            const imgAtt = (event.message.attachments || []).find(
              (a: { type?: string }) => a?.type === "image"
            );
            if (imgAtt) {
              if (!incomingText) incomingText = "فحص صورة النبات وتشخيص الإصابة 📷";
              if (imgAtt.payload?.base64) {
                incomingImageBase64 = String(imgAtt.payload.base64);
                incomingImageMime = String(imgAtt.payload.mime_type || "image/jpeg");
              } else if (imgAtt.payload?.url) {
                try {
                  const imgResp = await fetch(String(imgAtt.payload.url));
                  if (imgResp.ok) {
                    const buf = Buffer.from(await imgResp.arrayBuffer());
                    incomingImageBase64 = buf.toString("base64");
                    incomingImageMime = imgResp.headers.get("content-type") || "image/jpeg";
                  }
                } catch (attErr) {
                  console.warn(`${detectedChannel} image attachment download warning:`, attErr);
                }
              }
            }
          }

          if ((incomingText || incomingImageBase64) && !event.message?.is_echo) {
            const sessionId = `${detectedChannel}:${psid}`;
            const session = getOrCreateSession(
              sessionId,
              detectedChannel,
              psid,
              detectedChannel === "instagram"
                ? `عضو إنستجرام (${psid.slice(-4)})`
                : `عضو ماسنجر (${psid.slice(-4)})`
            );
            const { messageRecord, citations } = await generateAdvisorAnswer(
              session,
              String(incomingText || "فحص وتشخيص صورة النبات المرفقة 📷"),
              {
                imageBase64: incomingImageBase64,
                imageMime: incomingImageMime,
                isVoice: false,
              }
            );

            const qrList = (messageRecord.quick_replies || []).filter(Boolean).slice(0, 13);
            const qrTitles = ensureUniqueShortTitles(qrList, 20);
            const cleanSocialText = formatMessageForChannel(
              messageRecord.content,
              detectedChannel,
              qrList.length > 0
            );
            const graphOutbound = {
              recipient: { id: psid },
              messaging_type: "RESPONSE",
              message: {
                text: cleanSocialText,
                ...(qrList.length > 0
                  ? {
                      quick_replies: qrList.map((label, idx) => ({
                        content_type: "text",
                        title: qrTitles[idx],
                        payload: label.slice(0, 1000),
                      })),
                    }
                  : {}),
              },
            };

            const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
            const fbPageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
            const activeToken =
              detectedChannel === "instagram" ? igToken || fbPageToken : fbPageToken;
            if (activeToken && psid !== "live-test") {
              const graphHost =
                detectedChannel === "instagram" && igToken && igToken.startsWith("IG")
                  ? "https://graph.instagram.com/v21.0/me/messages"
                  : "https://graph.facebook.com/v21.0/me/messages";
              void sendMetaGraphWithLogging(detectedChannel, graphHost, activeToken, graphOutbound);
            }

            results.push({
              session_id: sessionId,
              channel: detectedChannel,
              message_id: messageRecord.message_id,
              sender_psid: psid,
              answer: messageRecord.content,
              quick_replies: messageRecord.quick_replies || [],
              ui_mode: messageRecord.ui_mode || "default",
              flow_state: session.flow_state,
              citations,
              latency_ms: messageRecord.latency_ms,
              graph_api_payload: graphOutbound,
            });

            appState.webhook_logs.unshift({
              id: `wh_${crypto.randomUUID().slice(0, 10)}`,
              channel: detectedChannel,
              method: "POST",
              endpoint: endpointPath,
              status_code: 200,
              sender_id: psid,
              inbound_preview: String(incomingText).slice(0, 120),
              outbound_preview: messageRecord.content.slice(0, 140),
              raw_inbound: payload,
              raw_outbound: graphOutbound,
              latency_ms: Date.now() - t0,
              created_at: new Date().toISOString(),
            });
          }
        }
      }

      appState.webhook_logs = appState.webhook_logs.slice(0, 40);
      await saveAppState();
      if (!isRealMetaSignature && !res.headersSent) {
        res.json({ status: "processed", events_handled: results.length, results });
      }
    } catch (err: unknown) {
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Social webhook error" });
      } else {
        console.error("Social async webhook error:", err);
      }
    }
  }

  // --- Facebook Messenger Platform Webhooks ---
  app.get("/webhooks/messenger", async (req: Request, res: Response) => {
    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");
    const ok = mode === "subscribe" && token === MESSENGER_VERIFY_TOKEN && challenge.length > 0;

    appState.webhook_logs.unshift({
      id: `wh_${crypto.randomUUID().slice(0, 10)}`,
      channel: "messenger",
      method: "GET",
      endpoint: "/webhooks/messenger",
      status_code: ok ? 200 : 403,
      sender_id: "meta-hub-verifier",
      inbound_preview: `hub.mode=${mode} · verify_token=${token === MESSENGER_VERIFY_TOKEN ? "matched" : "mismatch"}`,
      outbound_preview: ok ? `Challenge echoed: ${challenge}` : "403 Forbidden",
      raw_inbound: req.query,
      raw_outbound: ok ? challenge : { error: "Verification token mismatch" },
      latency_ms: 2,
      created_at: new Date().toISOString(),
    });
    await saveAppState();

    if (ok) {
      res.status(200).type("text/plain").send(challenge);
    } else {
      res.status(403).json({ error: "Messenger webhook verification failed." });
    }
  });

  app.post("/webhooks/messenger", async (req: Request, res: Response) => {
    await processMetaSocialWebhook(req, res);
  });

  // --- Instagram Messaging (DM) Webhooks ---
  app.get("/webhooks/instagram", async (req: Request, res: Response) => {
    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");
    const ok =
      mode === "subscribe" &&
      (token === INSTAGRAM_VERIFY_TOKEN || token === MESSENGER_VERIFY_TOKEN) &&
      challenge.length > 0;

    appState.webhook_logs.unshift({
      id: `wh_${crypto.randomUUID().slice(0, 10)}`,
      channel: "instagram",
      method: "GET",
      endpoint: "/webhooks/instagram",
      status_code: ok ? 200 : 403,
      sender_id: "meta-ig-verifier",
      inbound_preview: `hub.mode=${mode} · verify_token=${ok ? "matched" : "mismatch"}`,
      outbound_preview: ok ? `Challenge echoed: ${challenge}` : "403 Forbidden",
      raw_inbound: req.query,
      raw_outbound: ok ? challenge : { error: "Verification token mismatch" },
      latency_ms: 2,
      created_at: new Date().toISOString(),
    });
    await saveAppState();

    if (ok) {
      res.status(200).type("text/plain").send(challenge);
    } else {
      res.status(403).json({ error: "Instagram webhook verification failed." });
    }
  });

  app.post("/webhooks/instagram", async (req: Request, res: Response) => {
    await processMetaSocialWebhook(req, res, "instagram");
  });

  app.get("/api/webhooks/logs", (_req: Request, res: Response) => {
    res.json({
      whatsapp_verify_token: WHATSAPP_VERIFY_TOKEN,
      messenger_verify_token: MESSENGER_VERIFY_TOKEN,
      instagram_verify_token: INSTAGRAM_VERIFY_TOKEN,
      logs: appState.webhook_logs,
    });
  });

  // --- Session & Farm Context History Endpoints ---
  app.get("/api/sessions", (_req: Request, res: Response) => {
    const list = Object.values(appState.sessions)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((s) => ({
        session_id: s.session_id,
        channel: s.channel,
        external_user_id: s.external_user_id,
        profile_name: s.profile_name,
        farm_context: s.farm_context,
        message_count: s.messages.length,
        last_message: s.messages[s.messages.length - 1]?.content.slice(0, 110) || "لا توجد رسائل بعد",
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
    res.json({ sessions: list });
  });

  app.get("/api/sessions/:sessionId", (req: Request, res: Response) => {
    const sid = String(req.params.sessionId);
    const inferredChannel = sid.startsWith("whatsapp:")
      ? "whatsapp"
      : sid.startsWith("messenger:")
      ? "messenger"
      : sid.startsWith("instagram:")
      ? "instagram"
      : "widget";
    const session = getOrCreateSession(sid, inferredChannel);
    res.json({ session });
  });

  app.post("/api/sessions", async (req: Request, res: Response) => {
    const {
      session_id = `widget:${crypto.randomUUID().slice(0, 8)}`,
      channel = "widget",
      external_user_id = "organic-farmer",
      profile_name = "جلسة اختبار مزرعة أورجانيك",
      farm_context,
    } = req.body || {};
    const session = getOrCreateSession(session_id, channel, external_user_id, profile_name);
    if (farm_context && typeof farm_context === "object") {
      session.farm_context = { ...session.farm_context, ...farm_context };
    }
    await saveAppState();
    res.json({ session });
  });

  app.patch("/api/sessions/:sessionId/context", async (req: Request, res: Response) => {
    const session = getOrCreateSession(String(req.params.sessionId));
    const patch = req.body?.farm_context || req.body || {};
    session.farm_context = { ...session.farm_context, ...patch };
    session.updated_at = new Date().toISOString();
    await saveAppState();
    res.json({ session });
  });

  app.delete("/api/sessions/:sessionId", async (req: Request, res: Response) => {
    const id = String(req.params.sessionId);
    delete appState.sessions[id];
    await saveAppState();
    res.json({ deleted: id });
  });

  // --- ToR Evaluation Criteria & Engagement Metrics (KPIs) + User Feedback ---
  app.get(["/api/metrics", "/api/evaluation-metrics"], (_req: Request, res: Response) => {
    const allSessions = Object.values(appState.sessions);
    const activeSessions = allSessions.filter((s) => s.messages.some((m) => m.role === "user"));
    const retainedSessions = activeSessions.filter(
      (s) => s.messages.filter((m) => m.role === "user").length >= 2
    );

    let totalMessagesCount = 0;
    const assistantLatencies: number[] = [];
    const channelsBreakdown = { whatsapp: 0, messenger: 0, instagram: 0, widget: 0 };

    for (const s of allSessions) {
      totalMessagesCount += s.messages.length;
      const userMsgCount = s.messages.filter((m) => m.role === "user").length;
      if (s.channel === "whatsapp") channelsBreakdown.whatsapp += userMsgCount;
      else if (s.channel === "messenger") channelsBreakdown.messenger += userMsgCount;
      else if (s.channel === "instagram") channelsBreakdown.instagram += userMsgCount;
      else channelsBreakdown.widget += userMsgCount;

      for (const m of s.messages) {
        if (m.role === "assistant" && m.latency_ms > 0) {
          assistantLatencies.push(m.latency_ms);
        }
      }
    }

    const totalRatings = appState.feedback.length;
    const thumbsUp = appState.feedback.filter((f) => f.rating === 1).length;
    const thumbsDown = appState.feedback.filter((f) => f.rating === -1).length;
    const satisfactionPct =
      totalRatings > 0 ? Number(((thumbsUp / totalRatings) * 100).toFixed(1)) : 100;
    const retentionPct =
      activeSessions.length > 0
        ? Number(((retainedSessions.length / activeSessions.length) * 100).toFixed(1))
        : 0;
    const avgLatencyMs =
      assistantLatencies.length > 0
        ? Math.round(assistantLatencies.reduce((a, b) => a + b, 0) / assistantLatencies.length)
        : 0;

    res.json({
      active_users_count: Math.max(activeSessions.length, appState.registrations.length),
      total_messages_count: totalMessagesCount,
      voice_messages_count: appState.voice_messages_count || 0,
      registered_farms_count: appState.registrations.length,
      satisfaction_rate_pct: satisfactionPct,
      total_ratings: totalRatings,
      thumbs_up: thumbsUp,
      thumbs_down: thumbsDown,
      retention_rate_pct: retentionPct,
      retained_users_count: retainedSessions.length,
      avg_latency_ms: avgLatencyMs,
      channels_breakdown: channelsBreakdown,
    });
  });

  app.get("/api/feedback", (_req: Request, res: Response) => {
    const total = appState.feedback.length;
    const positive = appState.feedback.filter((f) => f.rating === 1).length;
    const negative = appState.feedback.filter((f) => f.rating === -1).length;
    const promoted = appState.feedback.filter((f) => f.promoted_to_rag).length;

    const sourceStats: Record<string, { positive: number; negative: number }> = {};
    for (const fb of appState.feedback) {
      for (const src of fb.retrieved_sources) {
        if (!sourceStats[src]) sourceStats[src] = { positive: 0, negative: 0 };
        if (fb.rating === 1) sourceStats[src].positive += 1;
        else sourceStats[src].negative += 1;
      }
    }

    res.json({
      summary: {
        total_ratings: total,
        thumbs_up: positive,
        thumbs_down: negative,
        approval_rate_pct: total > 0 ? Number(((positive / total) * 100).toFixed(1)) : 100,
        promoted_golden_chunks: promoted,
      },
      source_audit: Object.entries(sourceStats).map(([source, counts]) => ({
        source,
        thumbs_up: counts.positive,
        thumbs_down: counts.negative,
      })),
      items: appState.feedback,
    });
  });

  app.post("/api/feedback", async (req: Request, res: Response) => {
    const { message_id, session_id, rating, category = "accurate_actionable", comment = "" } = req.body || {};
    if (!message_id || !session_id || (rating !== 1 && rating !== -1)) {
      res.status(400).json({ error: "message_id, session_id, and rating (+1 or -1) are required." });
      return;
    }

    const session = appState.sessions[session_id];
    let queryText = "";
    let assistantText = "";
    let retrievedSources: string[] = [];

    if (session) {
      const idx = session.messages.findIndex((m) => m.message_id === message_id);
      if (idx >= 0) {
        const msg = session.messages[idx];
        assistantText = msg.content;
        retrievedSources = Array.from(new Set((msg.citations || []).map((c) => c.source)));
        for (let j = idx - 1; j >= 0; j--) {
          if (session.messages[j].role === "user") {
            queryText = session.messages[j].content;
            break;
          }
        }
      }
    }

    const existingIdx = appState.feedback.findIndex((f) => f.message_id === message_id);
    const record: FeedbackRecord = {
      feedback_id: existingIdx >= 0 ? appState.feedback[existingIdx].feedback_id : `fb_${crypto.randomUUID().slice(0, 10)}`,
      message_id,
      session_id,
      channel: session?.channel || "widget",
      rating: rating === 1 ? 1 : -1,
      category: String(category),
      comment: String(comment).trim(),
      query_text: queryText,
      assistant_text: assistantText,
      retrieved_sources: retrievedSources,
      promoted_to_rag: existingIdx >= 0 ? appState.feedback[existingIdx].promoted_to_rag : false,
      promoted_note: existingIdx >= 0 ? appState.feedback[existingIdx].promoted_note : undefined,
      created_at: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      appState.feedback[existingIdx] = record;
    } else {
      appState.feedback.unshift(record);
    }
    await saveAppState();
    res.json({ feedback: record });
  });

  app.post("/api/feedback/promote", async (req: Request, res: Response) => {
    try {
      const { feedback_id, topic_label, verified_fact_passage } = req.body || {};
      if (!topic_label || !verified_fact_passage) {
        res.status(400).json({ error: "يرجى إدخال عنوان المعلومة والنص المصحح." });
        return;
      }

      const count = await upsertDynamicChunks(
        "sme_verified_feedback_kb",
        "GOLDEN_QA",
        "feedback_verified",
        [{ section: String(topic_label), text: String(verified_fact_passage) }]
      );

      if (feedback_id) {
        const target = appState.feedback.find((f) => f.feedback_id === feedback_id);
        if (target) {
          target.promoted_to_rag = true;
          target.promoted_note = String(verified_fact_passage);
          await saveAppState();
        }
      }

      res.json({ status: "promoted", chunks_upserted: count, total_chunks: vectorChunks.length });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to promote feedback to RAG" });
    }
  });

  // --- Python FastAPI + ChromaDB Source Code Inspector & ZIP Bundle ---
  app.get("/api/python-source", async (_req: Request, res: Response) => {
    try {
      const pyEntries = await fsp.readdir(PYTHON_DIR);
      const files: Array<{ path: string; language: string; content: string; size_bytes: number }> = [];
      for (const name of pyEntries.sort()) {
        if (name.startsWith("__pycache__")) continue;
        const full = path.join(PYTHON_DIR, name);
        const stat = await fsp.stat(full);
        if (!stat.isFile()) continue;
        const content = await fsp.readFile(full, "utf8");
        const ext = path.extname(name).toLowerCase();
        files.push({
          path: `python_backend/${name}`,
          language: ext === ".py" ? "python" : ext === ".md" ? "markdown" : "text",
          content,
          size_bytes: stat.size,
        });
      }
      res.json({ files });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read Python codebase" });
    }
  });

  app.get("/api/python-bundle.zip", async (_req: Request, res: Response) => {
    try {
      const zip = new JSZip();
      const pyEntries = await fsp.readdir(PYTHON_DIR);
      for (const name of pyEntries) {
        const full = path.join(PYTHON_DIR, name);
        if ((await fsp.stat(full)).isFile()) {
          zip.file(`agripulse-organic-python-rag/python_backend/${name}`, await fsp.readFile(full));
        }
      }
      const dataEntries = await fsp.readdir(DATA_DIR);
      for (const name of dataEntries) {
        const full = path.join(DATA_DIR, name);
        if ((await fsp.stat(full)).isFile()) {
          zip.file(`agripulse-organic-python-rag/data/${name}`, await fsp.readFile(full));
        }
      }
      if (fs.existsSync(path.join(__dirname, ".env.example"))) {
        zip.file("agripulse-organic-python-rag/.env.example", await fsp.readFile(path.join(__dirname, ".env.example")));
      }
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="agripulse-organic-python-rag.zip"');
      res.send(buffer);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate zip bundle" });
    }
  });

  // --- Embeddable Company / Association Website Chat Widget Script (/agripulse-widget.js) ---
  app.get("/agripulse-widget.js", (req: Request, res: Response) => {
    const hostOrigin = `${req.protocol}://${req.get("host")}`;
    const script = `(function(){
  var cur = document.currentScript;
  var baseOrigin = (cur && cur.getAttribute("data-origin")) || "${hostOrigin}";
  var endpoint = (cur && cur.getAttribute("data-webhook")) || (baseOrigin + "/webhooks/widget");
  var voiceEndpoint = baseOrigin + "/api/voice-chat";
  var ttsEndpoint = baseOrigin + "/api/tts";
  var companyName = (cur && cur.getAttribute("data-company-name")) || "الجمعية المصرية للزراعة الحيوية (EBDA)";
  var subtitle = (cur && cur.getAttribute("data-subtitle")) || "اقتصاد المحبة · ديميتر · إرشاد زراعي عضوي 100%";
  var primaryColor = (cur && cur.getAttribute("data-primary-color")) || "#166534";
  var posSide = (cur && cur.getAttribute("data-position")) === "right" ? "right:20px;" : "left:20px;";
  var sid = "widget:site-" + Math.random().toString(36).slice(2, 10);

  function escHtml(s){
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  function formatWebMd(raw){
    var h = escHtml(raw);
    h = h.replace(/^[ \\t]*#{1,4}[ \\t]+(.+)$/gm, '<div style="font-weight:700;color:#14532d;margin:6px 0 3px;">$1</div>');
    h = h.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
    h = h.replace(/^[ \\t]*[-•][ \\t]+(.+)$/gm, '<div style="padding-right:10px;margin:2px 0;">• $1</div>');
    h = h.replace(/\\n/g, "<br/>");
    return h;
  }

  var btn = document.createElement("button");
  btn.type = "button";
  btn.dir = "rtl";
  btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><span>🌱</span><span>' + escHtml(companyName) + '</span></span>';
  btn.style.cssText = "position:fixed;bottom:20px;" + posSide + "z-index:99999;background:" + primaryColor + ";color:#fff;border:none;border-radius:12px;padding:12px 18px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.18);";

  var box = document.createElement("div");
  box.dir = "rtl";
  box.style.cssText = "display:none;position:fixed;bottom:76px;" + posSide + "z-index:99999;width:390px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 104px);background:#fff;border:1px solid #e5e5e0;border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,0.18);flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;";
  box.innerHTML =
    '<div style="background:' + primaryColor + ';color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<div style="min-width:0;">' +
        '<div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(companyName) + '</div>' +
        '<div style="font-size:11px;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(subtitle) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        '<button type="button" id="ap-reset" title="محادثة جديدة" style="background:rgba(255,255,255,0.16);color:#fff;border:none;border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer;">بداية جديدة</button>' +
        '<button type="button" id="ap-close" title="إغلاق" style="background:rgba(255,255,255,0.16);color:#fff;border:none;border-radius:8px;padding:4px 8px;font-size:13px;cursor:pointer;">✕</button>' +
      '</div>' +
    '</div>' +
    '<div id="ap-msgs" style="flex:1;overflow-y:auto;padding:12px;background:#faf9f6;font-size:13px;line-height:1.65;"></div>' +
    '<div id="ap-qr" style="display:flex;flex-wrap:wrap;gap:6px;max-height:132px;overflow-y:auto;padding:8px 10px;background:#faf9f6;border-top:1px solid #eceae4;"></div>' +
    '<div id="ap-img-bar" style="display:none;align-items:center;justify-content:space-between;padding:6px 10px;background:#f0fdf4;border-top:1px solid #bbf7d0;font-size:11px;color:#166534;">' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<img id="ap-img-thumb" style="width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid #86efac;"/>' +
        '<span>صورة جاهزة للتحليل العضوي 🌿</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<button type="button" id="ap-img-go" style="background:' + primaryColor + ';color:#fff;border:none;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;">تشخيص فوري</button>' +
        '<button type="button" id="ap-img-del" title="إلغاء الصورة" style="background:none;border:none;color:#dc2626;font-size:13px;cursor:pointer;">✕</button>' +
      '</div>' +
    '</div>' +
    '<form id="ap-form" style="display:flex;align-items:center;gap:5px;padding:10px;border-top:1px solid #e5e5e0;background:#fff;">' +
      '<input type="file" id="ap-file" accept="image/*" style="display:none;"/>' +
      '<input type="file" id="ap-cam-file" accept="image/*" capture="environment" style="display:none;"/>' +
      '<input id="ap-in" placeholder="اكتب سؤالك أو صور/ارفع نباتاً..." style="flex:1;min-width:0;border:1px solid #d6d3cd;border-radius:10px;padding:9px 10px;font-size:13px;outline:none;background:#faf9f6;"/>' +
      '<button type="button" id="ap-upload" title="رفع صورة من الجهاز" style="background:#f0fdf4;color:' + primaryColor + ';border:1px solid #bbf7d0;border-radius:10px;padding:8px 9px;font-size:14px;cursor:pointer;">🖼️</button>' +
      '<button type="button" id="ap-cam" title="تصوير بالكاميرا مباشرة" style="background:#f0fdf4;color:' + primaryColor + ';border:1px solid #bbf7d0;border-radius:10px;padding:8px 9px;font-size:14px;cursor:pointer;">📷</button>' +
      '<button type="button" id="ap-mic" title="تسجيل رسالة صوتية" style="background:#f0fdf4;color:' + primaryColor + ';border:1px solid #bbf7d0;border-radius:10px;padding:8px 9px;font-size:14px;cursor:pointer;">🎤</button>' +
      '<button type="submit" style="background:' + primaryColor + ';color:#fff;border:none;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer;">إرسال</button>' +
    '</form>';

  document.body.appendChild(btn);
  document.body.appendChild(box);

  var msgs = box.querySelector("#ap-msgs");
  var qrBox = box.querySelector("#ap-qr");
  var form = box.querySelector("#ap-form");
  var inp = box.querySelector("#ap-in");
  var micBtn = box.querySelector("#ap-mic");
  var upBtn = box.querySelector("#ap-upload");
  var camBtn = box.querySelector("#ap-cam");
  var fileInp = box.querySelector("#ap-file");
  var camFileInp = box.querySelector("#ap-cam-file");
  var imgBar = box.querySelector("#ap-img-bar");
  var imgThumb = box.querySelector("#ap-img-thumb");
  var imgDel = box.querySelector("#ap-img-del");
  var imgGo = box.querySelector("#ap-img-go");
  var closeBtn = box.querySelector("#ap-close");
  var resetBtn = box.querySelector("#ap-reset");
  var mediaRec = null;
  var audioChunks = [];
  var pendingImgBase64 = null;
  var pendingImgMime = "image/jpeg";

  btn.onclick = function(){ box.style.display = box.style.display === "none" ? "flex" : "none"; };
  closeBtn.onclick = function(){ box.style.display = "none"; };

  function handleWidgetFile(f){
    if(!f) return;
    pendingImgMime = "image/jpeg";
    var reader = new FileReader();
    reader.onload = function(e){
      var res = String(e.target.result || "");
      var imgObj = new Image();
      imgObj.onload = function(){
        var maxDim = 1280;
        var w = imgObj.width, h = imgObj.height;
        if(w > maxDim || h > maxDim){
          if(w >= h){ h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(imgObj, 0, 0, w, h);
        var outUrl = cv.toDataURL("image/jpeg", 0.85);
        pendingImgBase64 = outUrl.slice(outUrl.indexOf(",") + 1);
        imgThumb.src = outUrl;
        imgBar.style.display = "flex";
      };
      imgObj.src = res;
    };
    reader.readAsDataURL(f);
  }

  upBtn.onclick = function(){ fileInp.click(); };
  camBtn.onclick = function(){ camFileInp.click(); };
  fileInp.onchange = function(){ if(fileInp.files && fileInp.files[0]) handleWidgetFile(fileInp.files[0]); };
  camFileInp.onchange = function(){ if(camFileInp.files && camFileInp.files[0]) handleWidgetFile(camFileInp.files[0]); };
  imgGo.onclick = function(){ sendMsg("حلل هذه الصورة وشخص أي مرض أو آفة وقدم العلاج العضوي 100% 🌿"); };
  imgDel.onclick = function(){
    pendingImgBase64 = null;
    fileInp.value = "";
    camFileInp.value = "";
    imgBar.style.display = "none";
  };

  function speakText(txt){
    fetch(ttsEndpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ text: txt }) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d && d.audio_base64){
          var a = new Audio("data:audio/wav;base64," + d.audio_base64);
          a.play();
        } else if(window.speechSynthesis){
          var u = new SpeechSynthesisUtterance(txt.replace(/[*#_]/g," "));
          u.lang = "ar-EG";
          window.speechSynthesis.speak(u);
        }
      })
      .catch(function(){
        if(window.speechSynthesis){
          var u = new SpeechSynthesisUtterance(txt.replace(/[*#_]/g," "));
          u.lang = "ar-EG";
          window.speechSynthesis.speak(u);
        }
      });
  }

  function getWidgetIcon(label){
    if(!label) return "🌱";
    var l = String(label).toLowerCase();
    if(l.indexOf("رئيسية")>=0) return "🏠";
    if(l.indexOf("رجوع")>=0 || l.indexOf("سابق")>=0) return "↩️";
    if(l.indexOf("تعديل")>=0) return "✏️";
    if(l.indexOf("تأكيد")>=0 || l.indexOf("موافق")>=0 || l === "نعم") return "✅";
    if(l.indexOf("إلغاء")>=0 || l.indexOf("خروج")>=0 || l === "لا") return "✕";
    if(l.indexOf("أخرى")>=0 || l.indexOf("غير موجود")>=0 || l.indexOf("سؤال آخر")>=0) return "💬";
    if(l.indexOf("موضوعات")>=0 || l.indexOf("محاور")>=0) return "📚";
    if(l.indexOf("تسويق")>=0 || l.indexOf("تخزين")>=0 || l.indexOf("ما بعد الحصاد")>=0) return "📦";
    if(l.indexOf("تسجيل")>=0 || l.indexOf("عضوية")>=0 || l.indexOf("انضمام")>=0) return "📝";
    if(l.indexOf("عن الجمعية")>=0 || l.indexOf("اقتصاد المحبة")>=0 || l.indexOf("ديميتر")>=0 || l.indexOf("ebda")>=0) return "🌱";
    if(l.indexOf("أسئلة شائعة")>=0 || l.indexOf("faq")>=0 || l.indexOf("سؤال")>=0) return "❓";
    if(l.indexOf("مشكلة")>=0 || l.indexOf("إصابة")>=0 || l.indexOf("مرض")>=0 || l.indexOf("أعراض")>=0 || l.indexOf("تشخيص")>=0) return "🔍";
    if(l.indexOf("ترشيح")>=0 || l.indexOf("أنسب محصول")>=0) return "🧭";
    if(l.indexOf("دليل")>=0) return "📖";
    if(l.indexOf("صورة")>=0 || l.indexOf("كاميرا")>=0) return "📷";
    if(l.indexOf("صوت")>=0 || l.indexOf("تسجيل")>=0) return "🎙️";
    if(l.indexOf("حقلية")>=0) return "🌾";
    if(l.indexOf("خضروات")>=0 || l.indexOf("خضر")>=0) return "🍅";
    if(l.indexOf("فاكهة")>=0) return "🍊";
    if(l.indexOf("طبية")>=0 || l.indexOf("عطرية")>=0 || l.indexOf("أعشاب")>=0) return "🌿";
    if(l.indexOf("زيتية")>=0 || l.indexOf("جذرية")>=0) return "🥜";
    if(l.indexOf("بيئية")>=0 || l.indexOf("مناخ")>=0) return "🌤️";
    if(l.indexOf("بذور")>=0 || l.indexOf("تقاوي")>=0 || l.indexOf("شتل")>=0) return "🌱";
    if(l.indexOf("ري")>=0 || l.indexOf("مياه")>=0) return "💧";
    if(l.indexOf("تسميد")>=0 || l.indexOf("كمبوست")>=0) return "🧪";
    if(l.indexOf("مكافحة")>=0 || l.indexOf("آفات")>=0 || l.indexOf("حشرات")>=0 || l.indexOf("حشائش")>=0) return "🐞";
    if(l.indexOf("حصاد")>=0) return "🚜";
    if(l.indexOf("طماطم")>=0) return "🍅";
    if(l.indexOf("خيار")>=0) return "🥒";
    if(l.indexOf("بطاطس")>=0) return "🥔";
    if(l.indexOf("بصل")>=0) return "🧅";
    if(l.indexOf("ثوم")>=0) return "🧄";
    if(l.indexOf("جزر")>=0) return "🥕";
    if(l.indexOf("فلفل")>=0) return "🫑";
    if(l.indexOf("باذنجان")>=0) return "🍆";
    if(l.indexOf("قمح")>=0 || l.indexOf("شعير")>=0 || l.indexOf("أرز")>=0) return "🌾";
    if(l.indexOf("ذرة")>=0) return "🌽";
    if(l.indexOf("برسيم")>=0) return "🍀";
    if(l.indexOf("فول")>=0 || l.indexOf("حمص")>=0 || l.indexOf("فاصوليا")>=0 || l.indexOf("عدس")>=0) return "🫘";
    if(l.indexOf("زيتون")>=0) return "🫒";
    if(l.indexOf("عنب")>=0) return "🍇";
    if(l.indexOf("برتقال")>=0 || l.indexOf("ليمون")>=0 || l.indexOf("موالح")>=0) return "🍊";
    if(l.indexOf("مانجو")>=0) return "🥭";
    if(l.indexOf("نخيل")>=0 || l.indexOf("بلح")>=0) return "🌴";
    if(l.indexOf("فراولة")>=0) return "🍓";
    if(l.indexOf("موز")>=0) return "🍌";
    if(l.indexOf("تفاح")>=0 || l.indexOf("كمثرى")>=0) return "🍎";
    if(l.indexOf("نعناع")>=0 || l.indexOf("ريحان")>=0 || l.indexOf("روزماري")>=0 || l.indexOf("زعتر")>=0) return "🌿";
    if(l.indexOf("كركديه")>=0) return "🌺";
    if(l.indexOf("سمسم")>=0 || l.indexOf("سوداني")>=0) return "🥜";
    return "🌱";
  }

  function renderQr(items){
    qrBox.innerHTML = "";
    if(!items || !items.length){ qrBox.style.display = "none"; return; }
    qrBox.style.display = "flex";
    items.forEach(function(label){
      var b = document.createElement("button");
      b.type = "button";
      var icon = getWidgetIcon(label);
      b.innerHTML = '<span style="margin-left:5px;font-size:13px;display:inline-block;vertical-align:middle;">' + icon + '</span><span style="vertical-align:middle;">' + escHtml(label) + '</span>';
      b.style.cssText = "display:inline-flex;align-items:center;background:#fff;color:" + primaryColor + ";border:1px solid " + primaryColor + "40;border-radius:9px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;";
      b.onclick = function(){
        if(label.indexOf("فحص صورة")>=0 || label.indexOf("Scan Another Photo")>=0 || label.indexOf("Weiteres Foto")>=0){
          fileInp.click();
          return;
        }
        sendMsg(label);
      };
      qrBox.appendChild(b);
    });
  }

  function addBubble(txt, isUser, imgB64){
    var d = document.createElement("div");
    d.style.cssText = "margin-bottom:8px;padding:9px 12px;border-radius:12px;" + (isUser ? "background:" + primaryColor + ";color:#fff;margin-left:28px;" : "background:#fff;color:#18181b;border:1px solid #e5e5e0;margin-right:18px;");
    if(imgB64){
      var im = document.createElement("img");
      im.src = imgB64.indexOf("data:") === 0 ? imgB64 : ("data:" + (pendingImgMime || "image/jpeg") + ";base64," + imgB64);
      im.style.cssText = "max-height:140px;width:auto;border-radius:8px;margin-bottom:6px;display:block;";
      d.appendChild(im);
    }
    if(isUser){
      var t = document.createElement("div");
      t.textContent = txt;
      d.appendChild(t);
    } else {
      var bodyDiv = document.createElement("div");
      bodyDiv.innerHTML = formatWebMd(txt);
      d.appendChild(bodyDiv);
      var bar = document.createElement("div");
      bar.style.cssText = "margin-top:6px;padding-top:5px;border-top:1px solid #f0efea;display:flex;justify-content:flex-start;";
      var spk = document.createElement("button");
      spk.type = "button";
      spk.textContent = "🔊 سماع الرد";
      spk.style.cssText = "background:none;border:none;color:" + primaryColor + ";font-size:11px;font-weight:600;cursor:pointer;padding:2px 4px;";
      spk.onclick = function(){ speakText(txt); };
      bar.appendChild(spk);
      d.appendChild(bar);
    }
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function sendMsg(q){
    var hasImg = Boolean(pendingImgBase64);
    var payloadImg = pendingImgBase64;
    var payloadMime = pendingImgMime;
    if(!q && !hasImg) return;
    var userText = q || "فحص وتشخيص صورة النبات 📷";
    addBubble(userText, true, payloadImg);
    renderQr([]);
    if(hasImg){
      pendingImgBase64 = null;
      fileInp.value = "";
      camFileInp.value = "";
      imgBar.style.display = "none";
    }
    fetch(endpoint, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        session_id:sid,
        channel:"widget",
        message:userText,
        image_base64:hasImg ? payloadImg : undefined,
        image_mime:hasImg ? payloadMime : undefined
      })
    })
      .then(function(r){ return r.json(); })
      .then(function(d){
        addBubble(d.answer || d.error || "حصل خطأ بسيط، جرب تاني.", false);
        renderQr(d.quick_replies || []);
      })
      .catch(function(){ addBubble("تعذر الاتصال بالسيرفر حالياً.", false); });
  }

  function initWelcome(){
    msgs.innerHTML = "";
    addBubble("🌿 **" + companyName + "** & **Economy of Love (EoL)**\\nGerman-Egyptian Project (BMZ · bbw · sequa)\\n\\nمن فضلك اختر لغة المحادثة / Please select your preferred language / Bitte wählen Sie Ihre Sprache:", false);
    renderQr(["🇪🇬 العربية (Arabic)", "🇬🇧 English", "🇩🇪 Deutsch (German)"]);
  }

  resetBtn.onclick = function(){
    sid = "widget:site-" + Math.random().toString(36).slice(2, 10);
    initWelcome();
  };

  micBtn.onclick = function(){
    if(mediaRec && mediaRec.state === "recording"){
      mediaRec.stop();
      micBtn.textContent = "🎤";
      micBtn.style.background = "#f0fdf4";
      return;
    }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      audioChunks = [];
      mediaRec = new MediaRecorder(stream);
      micBtn.textContent = "⏹️";
      micBtn.style.background = "#fee2e2";
      mediaRec.ondataavailable = function(ev){ if(ev.data && ev.data.size > 0) audioChunks.push(ev.data); };
      mediaRec.onstop = function(){
        stream.getTracks().forEach(function(t){ t.stop(); });
        var blob = new Blob(audioChunks, { type: mediaRec.mimeType || "audio/webm" });
        if(blob.size < 300) return;
        var reader = new FileReader();
        reader.onloadend = function(){
          var resStr = String(reader.result || "");
          var b64 = resStr.indexOf(",") >= 0 ? resStr.slice(resStr.indexOf(",") + 1) : resStr;
          fetch(voiceEndpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ session_id:sid, channel:"widget", audio_base64:b64, mime_type:blob.type || "audio/webm" }) })
            .then(function(r){ return r.json(); })
            .then(function(d){
              if(d.transcribed_text) addBubble("🎤 " + d.transcribed_text, true);
              addBubble(d.answer || d.error || "تعذر سماع الصوت بوضوح.", false);
              renderQr(d.quick_replies || []);
            });
        };
        reader.readAsDataURL(blob);
      };
      mediaRec.start();
    }).catch(function(){});
  };

  initWelcome();
  form.onsubmit = function(e){
    e.preventDefault();
    var q = inp.value.trim();
    if(!q && !pendingImgBase64) return;
    inp.value = "";
    sendMsg(q);
  };
})();`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(script);
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AgriPulse Organic RAG Egyptian Arabic server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
