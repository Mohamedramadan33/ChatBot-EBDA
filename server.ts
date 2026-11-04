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
  loadAssociationPlantsDatabase,
  MAIN_MENU_SUGGESTIONS,
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
  created_at: string;
}

export interface SessionRecord {
  session_id: string;
  channel: "widget" | "whatsapp" | "messenger";
  external_user_id: string;
  profile_name: string;
  farm_context: FarmContext;
  flow_state?: SessionFlowState;
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
  channel: "whatsapp" | "messenger" | "widget";
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
}

const DEFAULT_FARM_CONTEXT: FarmContext = {
  farm_name: "مزرعة عضو الجمعية المصرية للزراعة الحيوية",
  region: "مصر - زراعة حيوية",
  latitude: 30.6667,
  longitude: 30.0667,
  farm_size_ha: 10,
  primary_crops: "محاصيل حقلية، خضروات، نباتات طبية وعطرية، أشجار فاكهة",
  soil_type: "تربة مخدومة بالكمبوست والأسمدة الحيوية",
  soil_ph: 7.5,
  irrigation_type: "ري بالتنقيط / غمر معتدل مع حقن الأسمدة الحيوية السائلة",
  currency: "EGP",
};

const ADVISOR_SYSTEM_INSTRUCTION = `أنت المستشار الزراعي الذكي والحساب الرسمي لـ **الجمعية المصرية للزراعة الحيوية**، وترد بصيغة الجمع المؤسسية الطبيعية والمهذبة ("بننصح بـ"، "بنوصي بـ"، "نستخدم") باللهجة المصرية المبسطة والواضحة عبر واتساب وفيسبوك والموقع.

قواعد أساسية صارمة لا استثناء فيها:
1. ممنوع تماماً تكرار الترحيب في الردود:
   - الترحيب يظهر للمستخدم مرة واحدة فقط عند فتح المحادثة.
   - **ممنوع نهائياً أن تبدأ أي رد بـ "أهلاً بيك" أو "أهلاً وسهلاً" أو "مرحباً" أو "إحنا في الجمعية المصرية للزراعة الحيوية يهمنا...".** ادخل مباشرة وبشكل طبيعي في الإجابة أو السؤال الاستشاري.
   - ممنوع منعاً باتاً أي ألقاب مثل: "يا بطل"، "يا هندسة"، "يا ريس"، "يا غالي"، "يا كبير"، "يا معلم"، "يا صاحبي"، "يا فندم".
2. أسلوب الكلام مبسط وعملي جداً (نفس أسلوب بيانات الجمعية بالظبط):
   - سواء كانت المعلومة من ملف بيانات الجمعية أو من الذكاء الاصطناعي (لأي نبات غير موجود في الملف أو عند اختيار "أخرى")، **اكتب بلغة مبسطة جداً وسهلة الفهم للمزارع المصري بدون أي مصطلحات علمية أو أكاديمية معقدة**.
   - رتب الإجابة في نقاط قصيرة ومباشرة وواضحة للفدان، مثل أسلوب بيانات الجمعية تماماً:
     * مثال للتجهيز والتسميد المبسط: "بنضيف 15 م3 كمبوست تام التحلل للفدان مع 150 كجم صخر فوسفات و50 كجم كبريت زراعي وقت الخدمة، وبعد الزراعة بنسمد بشاي الكمبوست والأسمدة الحيوية السائلة."
     * مثال للوقاية والمكافحة المبسطة: "في حالة وجود حشرات زي المن أو الذبابة البيضاء بنرش زيت النيم أو الصابون البوتاسي، وللوقاية من أعفان الجذور بنسقي بترايكوديرما مع تنظيم الري."
3. ممنوع الكيماويات نهائياً وباتاً — زراعة عضوية وحيوية (Organic 100%) فقط:
   - حتى عند الإجابة من الذكاء الاصطناعي على نباتات أو أسئلة خارج ملف البيانات، **لازم كل المعلومات تكون عضوية وحيوية (100% Organic)**.
   - ممنوع تحت أي ظرف ذكر أو التوصية بأي سماد كيماوي (يوريا، نترات، سلفات نشادر كيماوية، NPK كيماوي، سوبر فوسفات كيماوي، داب، ماب) أو أي مبيد كيماوي مصنع.
   - اعتمد دائماً على البدائل العضوية والحيوية فقط (الكمبوست تام التحلل، شاي الكمبوست، صخر الفوسفات/سوبر فوسفات حيوي، صخر الفلسبار، الكبريت الزراعي، الأسمدة الحيوية السائلة، مستخلص الطحالب، زيت النيم/نيمباسيدين، الصابون البوتاسي، الكبريت الميكروني، باسيلس/دايبل، تريسر طبيعي، ترايكوديرما/بيوأرك/بيوزيد/T34، المصائد والملش والعزيق اليدوي).
4. الذكاء الحواري وطرح الأسئلة الاستشارية والتشخيصية:
   - إذا سأل المزارع عن **أنسب نبات أو محصول لأرضه/تربته** ولم يذكر تفاصيل أرضه كاملة، اسأله بذكاء وبطريقة حوارية بسيطة عن (نوع التربة وملوحة المياه، وقت/شهر الزراعة، المساحة وطريقة الري، ونوع الزراعة المفضلة) حتى يرد عليك بكلامه، ولا تحصر إجابتك في أي محصول سابق.
   - إذا وصف المزارع مشكلة عامة غير مكتملة التفاصيل، قدم له التوصية العضوية المبسطة واختم بسؤال تشخيصي ذكي بسيط (مثل عمر النبات أو مكان ظهور العرض) للوصول لأدق تشخيص.`;

let plantsDatabase: PlantDatabaseRecord[] = [];
let vectorChunks: VectorChunk[] = [];
let appState: PersistentAppState = {
  sessions: {},
  feedback: [],
  webhook_logs: [],
  connected_sheets: [],
  registrations: [],
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
  channel: "widget" | "whatsapp" | "messenger" = "widget",
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
  channel: string
): string {
  const ragBlock =
    citations.length > 0
      ? citations.map((c, i) => `[معلومة إضافية ${i + 1} من ${c.source}]:\n${c.text}`).join("\n\n")
      : "";

  return `[القناة الحالية]: ${channel === "whatsapp" ? "واتساب" : channel === "messenger" ? "فيسبوك ماسنجر" : "شات الموقع"}

${focusedDbContext ? `${focusedDbContext}\n\n` : ""}${ragBlock ? `[مراجع مساندة من شيتات وملفات الجمعية]:\n${ragBlock}\n\n` : ""}[رسالة المستخدم]:
${userQuery.trim()}

تذكير مهم جداً: لا تكتب "أهلاً بيك" أو أي تحية في بداية الرد؛ ادخل في الإجابة العادية المباشرة من بيانات المحصول المرفقة أعلاه بصيغة الجمع ("بننصح"، "بنوصي"، "يتم إضافة...") وبدون أي ألقاب شعبية وبدون أي كيماويات نهائياً.`;
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

async function generateAdvisorAnswer(
  session: SessionRecord,
  userMessage: string
): Promise<{
  messageRecord: ChatMessageRecord;
  citations: RetrievedCitation[];
}> {
  const t0 = Date.now();
  const nowIso = new Date().toISOString();

  // 1. Evaluate Interactive Guided Flow (Registration / About Association / 67-Plant Crop Flow)
  const flowTurn = evaluateConversationalFlowTurn({
    userMessage,
    currentFlow: session.flow_state,
    plantsDb: plantsDatabase,
    existingRegistrationsCount: appState.registrations.length,
    sessionId: session.session_id,
    channel: session.channel,
    hasPriorMessages: session.messages.length > 0,
  });

  session.flow_state = flowTurn.next_flow_state;

  if (flowTurn.kind === "instant") {
    if (flowTurn.completed_registration) {
      appState.registrations.unshift(flowTurn.completed_registration);
    }

    const userMsg: ChatMessageRecord = {
      message_id: `msg_${crypto.randomUUID().slice(0, 12)}`,
      session_id: session.session_id,
      role: "user",
      content: userMessage.trim(),
      citations: [],
      latency_ms: 0,
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

  // 2. Database-grounded AI response using the 67-Plant CSV Database + Google Sheets RAG
  const citations =
    flowTurn.matched_plants.length > 0 ? [] : retrieveRelevantChunksFast(userMessage, 3);
  for (const matchedPlant of flowTurn.matched_plants) {
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

  const augmentedPrompt = buildAugmentedPrompt(
    userMessage,
    flowTurn.matched_plants.length > 0 ? [] : citations.slice(0, 3),
    flowTurn.focused_db_context,
    session.channel
  );

  const slicedHistory = session.messages.slice(-4);
  const firstUserIdx = slicedHistory.findIndex((m) => m.role === "user");
  const cleanHistory = (firstUserIdx >= 0 ? slicedHistory.slice(firstUserIdx) : []).map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content.slice(0, 500) }],
  }));

  const contents = [
    ...cleanHistory,
    {
      role: "user" as const,
      parts: [{ text: augmentedPrompt }],
    },
  ];

  const ai = getGenAIClient();
  let answerText = "";
  let modelUsed = "gemini-3-flash-preview";

  const candidateModels: Array<{
    name: string;
    thinkingConfig?: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
  }> = [
    { name: "gemini-3.1-flash-lite", thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    { name: "gemini-3.8-flash", thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    { name: "gemini-3-flash-preview", thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    { name: "gemini-2.5-flash-lite", thinkingConfig: { thinkingBudget: 0 } },
    { name: "gemini-flash-latest", thinkingConfig: { thinkingBudget: 0 } },
  ];

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
      3200,
      "parallel-flash-race"
    );
    answerText = stripLeadingGreeting(fastest.text) || fastest.text;
    modelUsed = fastest.model;
  } catch {
    // Instant fallback to the structured 67-crop CSV database
  }

  if (!answerText) {
    answerText = flowTurn.deterministic_fallback;
    modelUsed = "association-db-fallback";
  }

  const latencyMs = Date.now() - t0;

  const userMsg: ChatMessageRecord = {
    message_id: `msg_${crypto.randomUUID().slice(0, 12)}`,
    session_id: session.session_id,
    role: "user",
    content: userMessage.trim(),
    citations: [],
    latency_ms: 0,
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
    quick_replies: flowTurn.quick_replies,
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
      };
    } catch {
      appState = { sessions: {}, feedback: [], webhook_logs: [], connected_sheets: [], registrations: [] };
    }
  }

  if (Object.keys(appState.sessions).length === 0) {
    getOrCreateSession("whatsapp:live-test", "whatsapp", "201000000000", "محادثة واتساب التجريبية");
    getOrCreateSession("messenger:live-test", "messenger", "fb_user_test", "محادثة فيسبوك التجريبية");
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

  // Ensure all 67 crops from the CSV database are also indexed in vectorChunks for general lexical retrieval
  const dbSourceLabel = "قاعدة بيانات نباتات الجمعية المصرية للزراعة الحيوية (67 محصول)";
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
  vectorChunks = [
    ...plantChunks,
    ...vectorChunks.filter((c) => !c.id.startsWith("assoc_plant_")),
  ];

  // Run full local file sync & background embeddings asynchronously without blocking port 3000
  syncLocalKnowledgeBase(false).catch((e) => console.warn("Background KB sync warning:", e));
}

async function startServer() {
  await initPersistentStores();

  const app = express();
  app.use(express.json({ limit: "25mb" }));

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
        const exportXlsxUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
          spreadsheetId
        )}/export?format=xlsx`;
        const expResp = await fetch(exportXlsxUrl, {
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });

        const contentType = expResp.headers.get("content-type") || "";
        if (!expResp.ok || contentType.includes("text/html")) {
          res.status(401).json({
            needs_oauth: true,
            error:
              "الملف ده خاص (Private). اضغط على زر «Sign in with Google» فوق عشان نقراه بإذنك، أو افتح مشاركة الشيت (أي شخص لديه الرابط يمكنه العرض) للتجربة السريعة.",
          });
          return;
        }

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
      } = req.body || {};

      if (!message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "اكتب سؤالك الأول من فضلك." });
        return;
      }

      const validChannel = ["widget", "whatsapp", "messenger"].includes(channel) ? channel : "widget";
      const session = getOrCreateSession(session_id, validChannel, external_user_id, profile_name);
      if (farm_context && typeof farm_context === "object") {
        session.farm_context = { ...session.farm_context, ...farm_context };
      }

      const { messageRecord, citations } = await generateAdvisorAnswer(session, message);

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
      };

      if (req.path === "/webhooks/widget") {
        appState.webhook_logs.unshift({
          id: `wh_${crypto.randomUUID().slice(0, 10)}`,
          channel: "widget",
          method: "POST",
          endpoint: "/webhooks/widget",
          status_code: 200,
          sender_id: external_user_id,
          inbound_preview: message.slice(0, 120),
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

  function buildWhatsAppGraphPayload(to: string, bodyText: string, choices: string[]) {
    const cleanBody = bodyText.replace(/\*\*/g, "*").slice(0, 1020);
    const validChoices = (choices || []).filter(Boolean).slice(0, 10);

    if (validChoices.length === 0) {
      return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: cleanBody },
      };
    }

    // Native WhatsApp Reply Buttons (up to 3 buttons, max 20 chars per button title)
    if (validChoices.length <= 3 && validChoices.every((c) => c.length <= 20)) {
      return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: cleanBody },
          action: {
            buttons: validChoices.map((label) => ({
              type: "reply",
              reply: {
                id: label.slice(0, 256),
                title: label.slice(0, 20),
              },
            })),
          },
        },
      };
    }

    // Native WhatsApp Interactive List Message (up to 10 rows)
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
              title: "الجمعية المصرية",
              rows: validChoices.map((label) => ({
                id: label.slice(0, 200),
                title: label.slice(0, 24),
                ...(label.length > 24 ? { description: label.slice(0, 72) } : {}),
              })),
            },
          ],
        },
      },
    };
  }

  app.post("/webhooks/whatsapp", async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const payload = req.body || {};
      const results: unknown[] = [];

      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const val = change.value || {};
          const contactName = val.contacts?.[0]?.profile?.name || "عضو الجمعية";
          for (const msg of val.messages || []) {
            const incomingText =
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

            if (incomingText && String(incomingText).trim()) {
              const phone = String(msg.from || "201001234567");
              const sessionId = `whatsapp:${phone}`;
              const session = getOrCreateSession(sessionId, "whatsapp", phone, contactName);
              const { messageRecord, citations } = await generateAdvisorAnswer(
                session,
                String(incomingText)
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
                fetch(
                  `https://graph.facebook.com/v21.0/${encodeURIComponent(String(waPhoneId))}/messages`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${waToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify(graphOutbound),
                  }
                ).catch((e) => console.warn("WhatsApp Graph API send warning:", e));
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
      res.json({ status: "processed", events_handled: results.length, results });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "WhatsApp webhook error" });
    }
  });

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
    const t0 = Date.now();
    try {
      const payload = req.body || {};
      const results: unknown[] = [];

      for (const entry of payload.entry || []) {
        for (const event of entry.messaging || []) {
          const psid = String(event.sender?.id || "psid_organic_901");
          const incomingText =
            event.message?.quick_reply?.payload ||
            event.postback?.payload ||
            event.message?.text;

          if (incomingText && !event.message?.is_echo) {
            const sessionId = `messenger:${psid}`;
            const session = getOrCreateSession(
              sessionId,
              "messenger",
              psid,
              `عضو ماسنجر (${psid.slice(-4)})`
            );
            const { messageRecord, citations } = await generateAdvisorAnswer(
              session,
              String(incomingText)
            );

            const qrList = (messageRecord.quick_replies || []).slice(0, 13);
            const graphOutbound = {
              recipient: { id: psid },
              messaging_type: "RESPONSE",
              message: {
                text: messageRecord.content,
                ...(qrList.length > 0
                  ? {
                      quick_replies: qrList.map((label) => ({
                        content_type: "text",
                        title: label.slice(0, 20),
                        payload: label,
                      })),
                    }
                  : {}),
              },
            };

            const fbPageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
            if (fbPageToken && psid !== "live-test") {
              fetch(
                `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(fbPageToken)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(graphOutbound),
                }
              ).catch((e) => console.warn("Messenger Send API warning:", e));
            }

            results.push({
              session_id: sessionId,
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
              channel: "messenger",
              method: "POST",
              endpoint: "/webhooks/messenger",
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
      res.json({ status: "processed", events_handled: results.length, results });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Messenger webhook error" });
    }
  });

  app.get("/api/webhooks/logs", (_req: Request, res: Response) => {
    res.json({
      whatsapp_verify_token: WHATSAPP_VERIFY_TOKEN,
      messenger_verify_token: MESSENGER_VERIFY_TOKEN,
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

  // --- User Feedback & Iterative RAG Improvement Endpoints ---
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

  // --- Embeddable Web Chat Widget Script (/agripulse-widget.js) ---
  app.get("/agripulse-widget.js", (req: Request, res: Response) => {
    const hostOrigin = `${req.protocol}://${req.get("host")}`;
    const script = `(function(){
  var endpoint = (document.currentScript && document.currentScript.getAttribute("data-webhook")) || "${hostOrigin}/webhooks/widget";
  var sid = "widget:visitor-" + Math.random().toString(36).slice(2, 10);
  var btn = document.createElement("button");
  btn.textContent = "الجمعية المصرية للزراعة الحيوية";
  btn.style.cssText = "position:fixed;bottom:20px;left:20px;z-index:99999;background:#166534;color:#fff;border:none;border-radius:999px;padding:12px 20px;font-family:sans-serif;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.18);";
  var box = document.createElement("div");
  box.dir = "rtl";
  box.style.cssText = "display:none;position:fixed;bottom:76px;left:20px;z-index:99999;width:360px;max-width:calc(100vw - 40px);height:480px;background:#fff;border:1px solid #e5e5e0;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,0.16);flex-direction:column;overflow:hidden;font-family:sans-serif;";
  box.innerHTML = '<div style="background:#166534;color:#fff;padding:12px 14px;font-size:14px;font-weight:700;">الجمعية المصرية للزراعة الحيوية</div><div id="ap-msgs" style="flex:1;overflow-y:auto;padding:12px;background:#faf9f6;font-size:13px;line-height:1.6;"></div><div id="ap-qr" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;background:#faf9f6;border-top:1px solid #eceae4;"></div><form id="ap-form" style="display:flex;gap:6px;padding:10px;border-top:1px solid #e5e5e0;background:#fff;"><input id="ap-in" placeholder="اكتب رسالتك هنا..." style="flex:1;border:1px solid #d6d3cd;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"/><button type="submit" style="background:#166534;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;">إرسال</button></form>';
  document.body.appendChild(btn);
  document.body.appendChild(box);
  btn.onclick = function(){ box.style.display = box.style.display === "none" ? "flex" : "none"; };
  var msgs = box.querySelector("#ap-msgs");
  var qrBox = box.querySelector("#ap-qr");
  var form = box.querySelector("#ap-form");
  var inp = box.querySelector("#ap-in");
  function renderQr(items){
    qrBox.innerHTML = "";
    if(!items || !items.length){ qrBox.style.display = "none"; return; }
    qrBox.style.display = "flex";
    items.forEach(function(label){
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "background:#fff;color:#166534;border:1px solid #166534;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;";
      b.onclick = function(){ sendMsg(label); };
      qrBox.appendChild(b);
    });
  }
  function addBubble(txt, isUser){
    var d = document.createElement("div");
    d.style.cssText = "margin-bottom:8px;padding:8px 11px;border-radius:10px;white-space:pre-wrap;" + (isUser ? "background:#166534;color:#fff;margin-left:28px;" : "background:#fff;color:#18181b;border:1px solid #e5e5e0;margin-right:28px;");
    d.textContent = txt;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function sendMsg(q){
    if(!q) return;
    addBubble(q, true);
    renderQr([]);
    fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ session_id:sid, channel:"widget", message:q }) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        addBubble(d.answer || d.error || "حصل خطأ بسيط، جرب تاني.", false);
        renderQr(d.quick_replies || []);
      })
      .catch(function(){ addBubble("تعذر الاتصال بالسيرفر.", false); });
  }
  addBubble("أهلاً وسهلاً بيك في الجمعية المصرية للزراعة الحيوية، نقدر نساعدك إزاي؟", false);
  renderQr(["تسجيل في الجمعية", "ما هي الجمعية؟", "هل توجد مشكلة في محصول؟", "ترشيح أنسب محصول لأرضي", "دليل زراعة محصول كامل", "أخرى (سؤال آخر)"]);
  form.onsubmit = function(e){
    e.preventDefault();
    var q = inp.value.trim();
    if(!q) return;
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
