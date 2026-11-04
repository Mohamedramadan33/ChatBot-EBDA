import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

export interface PlantDatabaseRecord {
  id: string;
  name: string;
  raw_name: string;
  category: string;
  importance: string;
  environment: string;
  seeds_and_nursery: string;
  agricultural_practices: string;
  irrigation: string;
  fertilization: string;
  pest_and_disease_control: string;
  harvest: string;
  post_harvest: string;
  extra_notes: string;
  search_keys: string[];
  full_reference_text: string;
}

export interface GovernorateRecord {
  id: string;
  name: string;
  region_id: string;
  region_label: string;
  aliases: string[];
}

export interface MemberRegistrationRecord {
  registration_id: string;
  session_id: string;
  channel: "whatsapp" | "messenger" | "widget";
  full_name: string;
  phone: string;
  phone_e164: string;
  governorate: string;
  location: string;
  land_and_irrigation: string;
  crops: string;
  support_needed: string;
  created_at: string;
}

export interface SessionFlowState {
  mode: "idle" | "register" | "about" | "crop_flow" | "smart_advisor" | "general_ai";
  step?:
    | "ask_name"
    | "ask_phone"
    | "ask_location"
    | "confirm_fuzzy_gov"
    | "ask_land"
    | "ask_crops"
    | "ask_support"
    | "review_registration"
    | "select_crop_category"
    | "select_plant_in_category"
    | "confirm_fuzzy_plant"
    | "enter_other_plant_name"
    | "select_topic_or_symptom"
    | "gather_land_conditions"
    | "advisor_followup"
    | "open_organic_ai";
  crop_submode?: "problem" | "guide";
  category_filter?: string;
  category_page?: number;
  gov_region_id?: string;
  pending_fuzzy_governorate?: string;
  pending_fuzzy_detail?: string;
  pending_fuzzy_plant_id?: string;
  return_to_review?: boolean;
  draft_registration?: {
    full_name?: string;
    phone?: string;
    phone_e164?: string;
    governorate?: string;
    location_detail?: string;
    land_and_irrigation?: string;
    crops?: string;
    support_needed?: string;
  };
  selected_plant_id?: string;
  selected_plant_name?: string;
  is_other_plant?: boolean;
  advisor_context?: {
    accumulated_notes: string[];
    turns_asked: number;
    recommended_plant_ids?: string[];
  };
}

export type FlowUiMode = "default" | "whatsapp_buttons" | "whatsapp_list";

export interface InstantFlowTurnResult {
  kind: "instant";
  answer: string;
  quick_replies: string[];
  ui_mode: FlowUiMode;
  next_flow_state: SessionFlowState;
  completed_registration?: MemberRegistrationRecord;
}

export interface AiFlowTurnResult {
  kind: "ai_with_db";
  matched_plants: PlantDatabaseRecord[];
  active_crop_name?: string;
  focused_db_context: string;
  deterministic_fallback: string;
  quick_replies: string[];
  ui_mode: FlowUiMode;
  next_flow_state: SessionFlowState;
}

export type EvaluatedFlowTurn = InstantFlowTurnResult | AiFlowTurnResult;

export const OTHER_GENERAL_OPTION_LABEL = "أخرى (سؤال آخر)";
export const OTHER_PLANT_OPTION_LABEL = "أخرى (نبات غير موجود)";
export const OTHER_CROP_TOPIC_LABEL = "أخرى (سؤال آخر عن المحصول)";

export const MAIN_MENU_SUGGESTIONS: string[] = [
  "تسجيل في الجمعية",
  "ما هي الجمعية؟",
  "هل توجد مشكلة في محصول؟",
  "ترشيح أنسب محصول لأرضي",
  "دليل زراعة محصول كامل",
  OTHER_GENERAL_OPTION_LABEL,
];

export function inferWhatsAppUiMode(choices: string[]): FlowUiMode {
  if (!choices || choices.length === 0) return "default";
  if (choices.length <= 3 && choices.every((c) => c.length <= 22)) {
    return "whatsapp_buttons";
  }
  return "whatsapp_list";
}

function makeInstantResult(
  answer: string,
  quickReplies: string[],
  nextFlowState: SessionFlowState,
  completedRegistration?: MemberRegistrationRecord
): InstantFlowTurnResult {
  const cappedReplies = quickReplies.slice(0, 10);
  return {
    kind: "instant",
    answer,
    quick_replies: cappedReplies,
    ui_mode: inferWhatsAppUiMode(cappedReplies),
    next_flow_state: nextFlowState,
    ...(completedRegistration ? { completed_registration: completedRegistration } : {}),
  };
}

export function normalizeArabicDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeArabicForMatch(input: string): string {
  return normalizeArabicDigits(input)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/(.)\1{2,}/g, "$1")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normEq(normInput: string, rawTarget: string): boolean {
  return normInput === normalizeArabicForMatch(rawTarget);
}

function normIn(normInput: string, rawTargets: string[]): boolean {
  return rawTargets.some((t) => normInput === normalizeArabicForMatch(t));
}

function normHas(normInput: string, rawSubstring: string): boolean {
  const nSub = normalizeArabicForMatch(rawSubstring);
  return Boolean(nSub) && normInput.includes(nSub);
}

function stripAlPrefixWords(normText: string): string {
  return normText
    .split(" ")
    .map((w) => (w.length >= 4 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

// --- STRICT EGYPTIAN PHONE NUMBER FORMAT & VALIDATION ---
export interface PhoneValidationResult {
  valid: boolean;
  formatted?: string;
  e164?: string;
  errorMessage?: string;
}

export function validateAndFormatEgyptianPhone(rawInput: string): PhoneValidationResult {
  const ascii = normalizeArabicDigits(rawInput).trim();

  // Reject inputs that contain Arabic/Latin letters alongside or instead of phone digits
  if (/[\p{L}]/u.test(ascii)) {
    return {
      valid: false,
      errorMessage:
        "عذراً، لم نتمكن من التعرف على رقم التليفون لاحتوائه على حروف. يرجى كتابة رقم الموبايل بالأرقام فقط مكوناً من **11 رقماً** (مثال: `01012345678`):",
    };
  }

  let cleaned = ascii.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+20")) {
    cleaned = "0" + cleaned.slice(3);
  } else if (cleaned.startsWith("0020")) {
    cleaned = "0" + cleaned.slice(4);
  } else if (cleaned.length === 12 && cleaned.startsWith("201")) {
    cleaned = "0" + cleaned.slice(2);
  }

  if (!/^\d+$/.test(cleaned)) {
    return {
      valid: false,
      errorMessage:
        "عذراً، الصيغة المدخلة غير صحيحة. يرجى كتابة رقم الموبايل مكوناً من **11 رقماً** بالصيغة الصحيحة (مثال: `01012345678`):",
    };
  }

  if (cleaned.length !== 11) {
    return {
      valid: false,
      errorMessage: `عذراً، عدد أرقام التليفون غير صحيح (أدخلت **${cleaned.length}** أرقام). يجب أن يتكون رقم الموبايل المصري من **11 رقماً** بالضبط (مثال: \`01012345678\`):`,
    };
  }

  if (!/^01[0125]\d{8}$/.test(cleaned)) {
    return {
      valid: false,
      errorMessage:
        "عذراً، بداية رقم الموبايل غير مطابقة لشبكات المحمول المصرية. يجب أن يبدأ الرقم بـ **010** أو **011** أو **012** أو **015** ويليه 8 أرقام (مثال: `01012345678`):",
    };
  }

  // Reject blatantly fake all-identical trailing digits like 01000000000 or 01111111111
  if (/^01[0125](\d)\1{7}$/.test(cleaned)) {
    return {
      valid: false,
      errorMessage:
        "عذراً، يبدو أن الرقم المدخل غير حقيقي. يرجى كتابة رقم الموبايل أو الواتساب الفعلي لسهولة تواصل فريق الجمعية معك (مثال: `01012345678`):",
    };
  }

  return {
    valid: true,
    formatted: cleaned,
    e164: `+2${cleaned}`,
  };
}

// --- ALL 27 OFFICIAL EGYPTIAN GOVERNORATES + FUZZY / TYPO MATCHER ---
export const GOVERNORATE_REGIONS: Array<{ id: string; label: string }> = [
  { id: "delta", label: "محافظات الدلتا والوجه البحري" },
  { id: "cairo_alex", label: "القاهرة الكبرى والإسكندرية" },
  { id: "north_upper", label: "محافظات شمال ووسط الصعيد" },
  { id: "south_upper", label: "محافظات جنوب الصعيد" },
  { id: "canal_frontier", label: "مدن القناة وسيناء والحدودية" },
];

export const EGYPT_GOVERNORATES: GovernorateRecord[] = [
  // 1. Delta (7 governorates)
  {
    id: "beheira",
    name: "البحيرة",
    region_id: "delta",
    region_label: "محافظات الدلتا والوجه البحري",
    aliases: [
      "بحيره",
      "البحيره",
      "البحيرا",
      "دمنهور",
      "النوباريه",
      "النوبارية",
      "وادي النطرون",
      "وادى النطرون",
      "ابو المطامير",
      "كفر الدوار",
      "حوش عيسي",
      "الدلنجات",
      "كوم حماده",
      "ايتاي البارود",
      "رشيد",
      "ادكو",
      "مركز بدر",
      "التحرير",
    ],
  },
  {
    id: "dakahlia",
    name: "الدقهلية",
    region_id: "delta",
    region_label: "محافظات الدلتا والوجه البحري",
    aliases: [
      "دقهليه",
      "الدقهليه",
      "الدقهليا",
      "المنصوره",
      "منصوره",
      "ميت غمر",
      "السنبلاوين",
      "بلقاس",
      "دكرنس",
      "طلخا",
      "شربين",
      "اجا",
      "المنزله",
      "جمصه",
    ],
  },
  {
    id: "sharqia",
    name: "الشرقية",
    region_id: "delta",
    region_label: "محافظات الدلتا والوجه البحري",
    aliases: [
      "شرقيه",
      "الشرقيه",
      "الشرقيا",
      "الزقازيق",
      "زقازيق",
      "بلبيس",
      "فاقوس",
      "منيا القمح",
      "ابو حماد",
      "الحسينيه",
      "الصالحيه",
      "الصالحيه الجديده",
      "العاشر من رمضان",
      "ههيا",
      "كفر صقر",
      "اولاد صقر",
      "مشتول السوق",
    ],
  },
  {
    id: "gharbia",
    name: "الغربية",
    region_id: "delta",
    region_label: "محافظات الدلتا والوجه البحري",
    aliases: [
      "غربيه",
      "الغربيه",
      "الغربيا",
      "طنطا",
      "المحله",
      "المحله الكبري",
      "زفتي",
      "كفر الزيات",
      "السنطه",
      "بسيون",
      "قطور",
      "سمنود",
    ],
  },
  {
    id: "monufia",
    name: "المنوفية",
    region_id: "delta",
    region_label: "محافظات الدلتا والوجه البحري",
    aliases: [
      "منوفيه",
      "المنوفيه",
      "المنوفيا",
      "شبين الكوم",
      "السادات",
      "مدينه السادات",
      "منوف",
      "اشمون",
      "قويسنا",
      "الباجور",
      "تلا",
      "بركه السبع",
      "الشهداء",
    ],
  },
  {
    id: "kafr_el_sheikh",
    name: "كفر الشيخ",
    region_id: "delta",
    region_label: "محافظات الدلتا والوجه البحري",
    aliases: [
      "كفرالشيخ",
      "كفر شيخ",
      "دسوق",
      "بلطيم",
      "الحامول",
      "بيلا",
      "سيدي سالم",
      "فوه",
      "مطوبس",
      "قلين",
      "الرياض",
    ],
  },
  {
    id: "damietta",
    name: "دمياط",
    region_id: "delta",
    region_label: "محافظات الدلتا والوجه البحري",
    aliases: ["دمياط الجديده", "فارسكور", "كفر سعد", "الزرقا", "كفر البطيخ"],
  },

  // 2. Greater Cairo & Alexandria (4 governorates)
  {
    id: "cairo",
    name: "القاهرة",
    region_id: "cairo_alex",
    region_label: "القاهرة الكبرى والإسكندرية",
    aliases: ["قاهره", "القاهره", "القاهرا", "حلوان", "مدينه نصر", "المعادي", "التجمع", "الشروق", "cairo"],
  },
  {
    id: "giza",
    name: "الجيزة",
    region_id: "cairo_alex",
    region_label: "القاهرة الكبرى والإسكندرية",
    aliases: [
      "جيزه",
      "الجيزه",
      "الجيزا",
      "الواحات البحريه",
      "البدرشين",
      "الصف",
      "العياط",
      "اطفيح",
      "ابو النمرس",
      "كرداسه",
      "منشاه القناطر",
      "اكتوبر",
      "6 اكتوبر",
      "الشيخ زايد",
      "ابو غالب",
      "giza",
    ],
  },
  {
    id: "qalyubia",
    name: "القليوبية",
    region_id: "cairo_alex",
    region_label: "القاهرة الكبرى والإسكندرية",
    aliases: [
      "قليوبيه",
      "القليوبيه",
      "القليوبيا",
      "قلوبيه",
      "القلوبيه",
      "بنها",
      "طوخ",
      "قليوب",
      "القناطر الخيريه",
      "شبين القناطر",
      "كفر شكر",
      "الخانكه",
      "شبرا الخيمه",
      "العبور",
    ],
  },
  {
    id: "alexandria",
    name: "الإسكندرية",
    region_id: "cairo_alex",
    region_label: "القاهرة الكبرى والإسكندرية",
    aliases: [
      "اسكندريه",
      "الاسكندريه",
      "اسكندريا",
      "الاسكندريا",
      "برج العرب",
      "العامريه",
      "النهضه",
      "مريوط",
      "alex",
      "alexandria",
    ],
  },

  // 3. North & Middle Upper Egypt (4 governorates)
  {
    id: "faiyum",
    name: "الفيوم",
    region_id: "north_upper",
    region_label: "محافظات شمال ووسط الصعيد",
    aliases: ["فيوم", "الفيوم", "اطسا", "طاميه", "سنورس", "ابشواي", "يوسف الصديق"],
  },
  {
    id: "beni_suef",
    name: "بني سويف",
    region_id: "north_upper",
    region_label: "محافظات شمال ووسط الصعيد",
    aliases: [
      "بني سويف",
      "بنى سويف",
      "بنيسويف",
      "بنسويف",
      "الواسطي",
      "ناصر",
      "اهناسيا",
      "ببا",
      "سمسطا",
      "الفشن",
    ],
  },
  {
    id: "minya",
    name: "المنيا",
    region_id: "north_upper",
    region_label: "محافظات شمال ووسط الصعيد",
    aliases: [
      "منيا",
      "المنيا",
      "المنيه",
      "المينا",
      "ملوي",
      "سمالوط",
      "مغاغه",
      "بني مزار",
      "مطاي",
      "ابو قرقاص",
      "ابوقرقاص",
      "ديرمواس",
      "العدوه",
      "غرب المنيا",
    ],
  },
  {
    id: "asyut",
    name: "أسيوط",
    region_id: "north_upper",
    region_label: "محافظات شمال ووسط الصعيد",
    aliases: [
      "اسيوط",
      "اسوط",
      "ديروط",
      "القوصيه",
      "منفلوط",
      "ابوتيج",
      "ابو تيج",
      "الفتح",
      "ابنوب",
      "البداري",
      "ساحل سليم",
      "صدفا",
      "الغنايم",
    ],
  },

  // 4. South Upper Egypt (4 governorates)
  {
    id: "sohag",
    name: "سوهاج",
    region_id: "south_upper",
    region_label: "محافظات جنوب الصعيد",
    aliases: [
      "سهاج",
      "سوهاق",
      "طما",
      "طهطا",
      "المراغه",
      "اخميم",
      "جرجا",
      "البلينا",
      "المنشاه",
      "دار السلام",
      "جهينه",
      "ساقلته",
    ],
  },
  {
    id: "qena",
    name: "قنا",
    region_id: "south_upper",
    region_label: "محافظات جنوب الصعيد",
    aliases: ["قنه", "نجع حمادي", "دشنا", "قوص", "نقاده", "ابو تشت", "ابوتشت", "فرشوط", "قفط", "الوقف"],
  },
  {
    id: "luxor",
    name: "الأقصر",
    region_id: "south_upper",
    region_label: "محافظات جنوب الصعيد",
    aliases: ["اقصر", "الاقصر", "لقصر", "اسنا", "ارمنت", "القرنه", "البياضيه", "الطود", "الزينيه", "luxor"],
  },
  {
    id: "aswan",
    name: "أسوان",
    region_id: "south_upper",
    region_label: "محافظات جنوب الصعيد",
    aliases: ["اسوان", "اصوان", "كوم امبو", "ادفو", "دراو", "نصر النوبه", "توشكي", "وادي النقره", "aswan"],
  },

  // 5. Canal, Sinai & Frontier Governorates (8 governorates)
  {
    id: "ismailia",
    name: "الإسماعيلية",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: [
      "اسماعيليه",
      "الاسماعيليه",
      "اسمعليه",
      "الاسمعليه",
      "اسماعليه",
      "الاسماعليه",
      "القنطره",
      "القنطره شرق",
      "القنطره غرب",
      "فايد",
      "التل الكبير",
      "القصاصين",
      "ابو صوير",
    ],
  },
  {
    id: "suez",
    name: "السويس",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: ["سويس", "الجناين", "حي الجناين"],
  },
  {
    id: "port_said",
    name: "بورسعيد",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: ["بور سعيد", "بورفؤاد", "سهل الطينه"],
  },
  {
    id: "matrouh",
    name: "مطروح",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: [
      "مرسي مطروح",
      "مرسى مطروح",
      "الحمام",
      "العلمين",
      "الضبعه",
      "سيدي براني",
      "السلوم",
      "سيوه",
      "واحه سيوه",
      "مغره",
      "المغره",
    ],
  },
  {
    id: "new_valley",
    name: "الوادي الجديد",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: [
      "وادي جديد",
      "الوادى الجديد",
      "الوادي",
      "الخارجه",
      "الداخله",
      "الفرافره",
      "باريس",
      "بلاط",
      "شرق العوينات",
      "العوينات",
    ],
  },
  {
    id: "red_sea",
    name: "البحر الأحمر",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: ["البحر الاحمر", "بحر احمر", "الغردقه", "سفاجا", "القصير", "مرسي علم", "راس غارب", "الشلاتين"],
  },
  {
    id: "north_sinai",
    name: "شمال سيناء",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: ["شمال سينا", "العريش", "بئر العبد", "بير العبد", "الشيخ زويد", "رفح", "الحسنه", "نخل"],
  },
  {
    id: "south_sinai",
    name: "جنوب سيناء",
    region_id: "canal_frontier",
    region_label: "مدن القناة وسيناء والحدودية",
    aliases: ["جنوب سينا", "الطور", "طور سيناء", "شرم الشيخ", "دهب", "نويبع", "راس سدر", "سانت كاترين", "طابا"],
  },
];

export interface GovernorateMatchResult {
  status: "matched" | "fuzzy_confirm" | "not_found";
  governorate?: string;
  detail?: string;
  suggestedGovernorate?: string;
}

export function matchEgyptianGovernorate(rawInput: string): GovernorateMatchResult {
  const cleanedRaw = rawInput
    .replace(/^محافظ[ةه]\s+/i, "")
    .replace(/^نعم[،,\s]+/i, "")
    .trim();
  const norm = normalizeArabicForMatch(cleanedRaw);
  if (!norm || norm.length < 2) {
    return { status: "not_found" };
  }
  const strippedNorm = stripAlPrefixWords(norm);
  const paddedNorm = ` ${norm} `;
  const paddedStripped = ` ${strippedNorm} `;

  // 1. Direct exact or whole-phrase match against canonical governorate names
  for (const gov of EGYPT_GOVERNORATES) {
    const normGov = normalizeArabicForMatch(gov.name);
    const strippedGov = stripAlPrefixWords(normGov);
    if (norm === normGov || strippedNorm === strippedGov) {
      return { status: "matched", governorate: gov.name };
    }
    if (paddedNorm.includes(` ${normGov} `) || paddedStripped.includes(` ${strippedGov} `)) {
      const remainder = cleanedRaw
        .replace(new RegExp(gov.name, "g"), "")
        .replace(/^[\s\-،,/]+|[\s\-،,/]+$/g, "")
        .trim();
      return {
        status: "matched",
        governorate: gov.name,
        ...(remainder.length >= 2 ? { detail: remainder } : {}),
      };
    }
  }

  // 2. Match against known spelling variants & cities/centers/markazes
  for (const gov of EGYPT_GOVERNORATES) {
    const normGov = normalizeArabicForMatch(gov.name);
    const strippedGov = stripAlPrefixWords(normGov);
    for (const alias of gov.aliases) {
      const normAlias = normalizeArabicForMatch(alias);
      const strippedAlias = stripAlPrefixWords(normAlias);
      if (
        norm === normAlias ||
        strippedNorm === strippedAlias ||
        paddedNorm.includes(` ${normAlias} `) ||
        (strippedAlias.length >= 4 && paddedStripped.includes(` ${strippedAlias} `))
      ) {
        // Distinguish spelling variant of governorate vs a specific city/center name
        const isSpellingOfGov =
          levenshteinDistance(strippedAlias, strippedGov) <= 2 ||
          normAlias.includes(strippedGov);
        return {
          status: "matched",
          governorate: gov.name,
          ...(!isSpellingOfGov ? { detail: cleanedRaw } : {}),
        };
      }
    }
  }

  // 3. Fuzzy Levenshtein typo match against canonical governorates & major aliases
  let bestGov: GovernorateRecord | null = null;
  let bestDist = 99;

  for (const gov of EGYPT_GOVERNORATES) {
    const candidates = [
      normalizeArabicForMatch(gov.name),
      stripAlPrefixWords(normalizeArabicForMatch(gov.name)),
      ...gov.aliases.slice(0, 4).map((a) => stripAlPrefixWords(normalizeArabicForMatch(a))),
    ];
    for (const cand of candidates) {
      if (!cand) continue;
      const dist = levenshteinDistance(strippedNorm, cand);
      const maxAllowed = cand.length >= 6 ? 2 : 1;
      if (dist <= maxAllowed && dist < bestDist) {
        bestDist = dist;
        bestGov = gov;
      }
      // Also check individual words if user typed e.g. "بني سوبف الفشن"
      const words = strippedNorm.split(" ").filter((w) => w.length >= 3);
      for (const w of words) {
        const wDist = levenshteinDistance(w, cand);
        const wAllowed = cand.length >= 6 ? 2 : 1;
        if (wDist <= wAllowed && wDist < bestDist) {
          bestDist = wDist;
          bestGov = gov;
        }
      }
    }
  }

  if (bestGov) {
    return {
      status: "fuzzy_confirm",
      suggestedGovernorate: bestGov.name,
    };
  }

  return { status: "not_found" };
}

// --- 67-CROP CSV DATABASE LOADER & FUZZY MATCHER ---
const CLEAN_NAME_OVERRIDES: Record<string, { display: string; aliases: string[] }> = {
  الطماطم: { display: "الطماطم", aliases: ["طماطم", "قوطه", "بندوره"] },
  النعناع: { display: "النعناع", aliases: ["نعناع", "نعناع بلدي", "نعناع فلفلي"] },
  الكاموميل: { display: "الكاموميل (البابونج)", aliases: ["كاموميل", "بابونج", "شيح البابونج"] },
  كلانديولا: { display: "الكلانديولا (الأقحوان)", aliases: ["كلانديولا", "اقحوان", "كالانديولا"] },
  مورينجا: { display: "المورينجا", aliases: ["مورينجا", "شجره المورينجا"] },
  الكزبرة: {
    display: "الكزبرة (والشبت والبقدونس)",
    aliases: ["كزبره", "كسبره", "شبت", "بقدونس", "كرفس"],
  },
  القمح: { display: "القمح", aliases: ["قمح", "غله"] },
  "حبة البركة": { display: "حبة البركة", aliases: ["حبه البركه", "الحبه السوداء"] },
  الينسون: { display: "الينسون", aliases: ["ينسون", "يانسون"] },
  الكراوية: { display: "الكراوية", aliases: ["كراويه", "كراويا"] },
  "الفول البلدي": { display: "الفول البلدي", aliases: ["فول بلدي", "فول تدميس", "فول رومي"] },
  المريمية: { display: "المريمية (المرمرية)", aliases: ["مريميه", "مرمريه", "مراميه"] },
  الحمص: { display: "الحمص", aliases: ["حمص", "حمص الشام"] },
  العدس: { display: "العدس", aliases: ["عدس", "عدس اصفر", "عدس بجبه"] },
  الحلبة: { display: "الحلبة", aliases: ["حلبه", "حلبه حصى"] },
  "حشيشة الليمون": { display: "حشيشة الليمون", aliases: ["حشيشه الليمون", "ليمون جراس"] },
  "البنجر (محاصيل سكرية)": {
    display: "بنجر السكر",
    aliases: ["بنجر", "بنجر السكر", "البنجر", "شمندر"],
  },
  اللفت: { display: "اللفت", aliases: ["لفت"] },
  الذرة: { display: "الذرة الشامية", aliases: ["ذره", "ذره شاميه", "دره"] },
  الستيفيا: { display: "الستيفيا", aliases: ["ستيفيا", "استيفيا"] },
  "فول الصويا": { display: "فول الصويا", aliases: ["فول صويا", "صويا"] },
  "عباد الشمس": { display: "عباد الشمس (دوار الشمس)", aliases: ["عباد الشمس", "دوار الشمس"] },
  "الروز ماري (حصي لبان)": {
    display: "الروزماري (حصى لبان)",
    aliases: ["روزماري", "روز ماري", "حصي لبان", "حصى لبان", "اكليل الجبل"],
  },
  الكتان: { display: "الكتان", aliases: ["كتان", "بذر الكتان", "زيت حار"] },
  سورجم: {
    display: "السورجم (الذرة الرفيعة)",
    aliases: ["سورجم", "ذره رفيعه", "حشيشه السودان", "ذره سكريه"],
  },
  "الفول السوداني": { display: "الفول السوداني", aliases: ["فول سوداني", "سوداني"] },
  الفاصوليا: { display: "الفاصوليا", aliases: ["فاصوليا", "فاصوليا خضراء", "فاصوليا بيضاء"] },
  الملوخية: { display: "الملوخية", aliases: ["ملوخيه"] },
  العتر: { display: "العتر", aliases: ["عتر", "العطر", "عطرشان"] },
  اللوف: { display: "اللوف", aliases: ["لوف", "لوف استحمام"] },
  الخرشوف: { display: "الخرشوف", aliases: ["خرشوف"] },
  الكركدية: { display: "الكركديه", aliases: ["كركديه", "كركديه اسواني"] },
  الريحان: { display: "الريحان", aliases: ["ريحان"] },
  شعير: { display: "الشعير", aliases: ["شعير"] },
  الشوفان: { display: "الشوفان", aliases: ["شوفان"] },
  الارز: { display: "الأرز", aliases: ["ارز", "رز", "الرز"] },
  الكينوا: { display: "الكينوا", aliases: ["كينوا"] },
  العرقسوس: { display: "العرقسوس", aliases: ["عرقسوس", "عرق سوس"] },
  كرات: { display: "الكرات", aliases: ["كرات", "كرات مصري", "كرات بلدي"] },
  الخلة: { display: "الخلة", aliases: ["خله", "خله بلدي", "خله شيطاني"] },
  الجوجوبا: { display: "الجوجوبا (الهوهوبا)", aliases: ["جوجوبا", "هوهوبا"] },
  الرمان: { display: "الرمان", aliases: ["رمان", "رمان منفلوطي"] },
  الحناء: { display: "الحناء (الحنة)", aliases: ["حناء", "حنه", "الحنه"] },
  الكمون: { display: "الكمون", aliases: ["كمون", "كمون بلدي"] },
  السافوري: { display: "السافوري", aliases: ["سافوري", "ندغ البساتين"] },
  ميليسيا: { display: "الميليسيا (المليسة)", aliases: ["ميليسيا", "مليسه", "ترنجان"] },
  السلاميكي: { display: "السلاميكي (السنامكي)", aliases: ["سلاميكي", "سنامكي", "سنا مكي"] },
  البطاطس: { display: "البطاطس", aliases: ["بطاطس"] },
  الجزر: { display: "الجزر", aliases: ["جزر"] },
  العنب: { display: "العنب", aliases: ["عنب", "كرمه العنب"] },
  الكوسة: { display: "الكوسة", aliases: ["كوسه"] },
  باذنجان: { display: "الباذنجان", aliases: ["باذنجان", "بتنجان"] },
  الفلفل: { display: "الفلفل", aliases: ["فلفل", "فلفل رومي", "فلفل حار", "شطه"] },
  تفاح: { display: "التفاح", aliases: ["تفاح"] },
  البرسيم: { display: "البرسيم المصري", aliases: ["برسيم", "برسيم مسقاوي", "برسيم فحل"] },
  البطاطا: { display: "البطاطا الحلوة", aliases: ["بطاطا", "بطاطا حلوه"] },
  البازلاء: { display: "البازلاء (البسلة)", aliases: ["بازلاء", "بسله", "البسله"] },
  الفجل: { display: "الفجل", aliases: ["فجل"] },
  الخس: { display: "الخس", aliases: ["خس", "خس بلدي", "كابوتشا"] },
  الكرنب: { display: "الكرنب (الملفوف)", aliases: ["كرنب", "ملفوف"] },
  المشمش: { display: "المشمش", aliases: ["مشمش"] },
  الكمثري: { display: "الكمثرى", aliases: ["كمثري", "كمثرى"] },
  الجوافة: { display: "الجوافة", aliases: ["جوافه"] },
  فراولة: { display: "الفراولة", aliases: ["فراوله", "فريز"] },
  اللافندر: { display: "اللافندر (الخزامى)", aliases: ["لافندر", "خزامي"] },
  الشيا: { display: "الشيا", aliases: ["شيا", "بذور الشيا"] },
  اللوز: { display: "اللوز", aliases: ["لوز", "شجر اللوز"] },
};

export const CROP_CATEGORY_CHOICES: Array<{ label: string; category: string }> = [
  { label: "قسم الخضروات", category: "خضروات" },
  { label: "قسم النباتات الطبية والعطرية", category: "نباتات طبية وعطرية" },
  { label: "قسم المحاصيل الحقلية", category: "محاصيل حقلية" },
  { label: "قسم أشجار الفاكهة", category: "أشجار فاكهة" },
  { label: "قسم المحاصيل الزيتية والجذرية", category: "محاصيل زيتية وألياف وجذرية" },
];

function normalizeCategory(rawCat: string): string {
  const c = rawCat.trim();
  if (!c) return "محاصيل حقلية";
  if (c.includes("طبية")) return "نباتات طبية وعطرية";
  if (c.includes("خضروات")) return "خضروات";
  if (c.includes("حقلية") || c.includes("علف")) return "محاصيل حقلية";
  if (c.includes("فاكهة")) return "أشجار فاكهة";
  if (c.includes("زيتية") || c.includes("ألياف") || c.includes("جزرية") || c.includes("جذرية")) {
    return "محاصيل زيتية وألياف وجذرية";
  }
  return c;
}

export function loadAssociationPlantsDatabase(workspaceRoot: string): PlantDatabaseRecord[] {
  const candidatePaths = [
    path.join(
      workspaceRoot,
      "public",
      "assets",
      "aistudio",
      "Plants_Data_Collection__Responses_.xlsx_-_Form_Responses_1_293b71cd.csv"
    ),
    path.join(workspaceRoot, "data", "association_plants_database.csv"),
  ];

  const existingPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!existingPath) {
    return [];
  }

  const rawCsv = fs.readFileSync(existingPath, "utf8");
  const workbook = XLSX.read(rawCsv, { type: "string" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  const records: PlantDatabaseRecord[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const colSelect = String(r["اختر المحصول"] || "").trim();
    const colOther = String(
      r["إذا كانت إجابة السؤال السابق أخرى، من فضلك حدد المحصول"] || ""
    ).trim();
    const rawName =
      colSelect && colSelect !== "أخرى" && colSelect !== "اخري" ? colSelect : colOther;

    if (!rawName || rawName.length < 2) continue;

    const importance = String(r["حدد القيمة الاقتصادية أو اهمية المحصول"] || "").trim();
    const environment = String(
      r["حدد الاحتياجات البيئية للمحصول (نوع التربة - الضوء - الحرارة - الرطوبة)؟"] || ""
    ).trim();
    const seedsAndNursery = String(
      r["بالنسبة للبذور وتقاوي الزراعة (ما كمية البذور والشتلات للفدان - طرق ومواعيد النقل)؟"] || ""
    ).trim();
    const practices = String(
      r["حدد الممارسات الزراعية المطلوبة (تحضير الارض قبل الزراعة - ممارسات اثناء الزراعة)؟"] || ""
    ).trim();
    const irrigation = String(
      r["الري (طرق الري وتكلفتها - مواعيد الري - الاحتياجات المائية - الملوحة)؟"] || ""
    ).trim();
    const fertilization = String(r["حدد التسميد (الكمبوست - اماكن شراء المنتجات)؟"] || "").trim();
    const pestControl = String(
      r["طرق الوقاية والمكافحة (الافات والامراض المحتملة - الوقاية - المكافحة - الحشائش)؟"] || ""
    ).trim();
    const harvest = String(r["ما هي طرق ومواعيد الحصاد؟"] || "").trim();
    const postHarvest = String(r["اذكر معاملات بعد الحصاد (النقل - التخزين)؟"] || "").trim();
    const extraNotes = String(r["معلومات إضافية"] || "").trim();

    const agronomicFields = [
      importance,
      environment,
      seedsAndNursery,
      practices,
      irrigation,
      fertilization,
      pestControl,
      harvest,
      postHarvest,
      extraNotes,
    ].filter((v) => v.length > 2);

    if (agronomicFields.length === 0) continue;

    const override = CLEAN_NAME_OVERRIDES[rawName];
    const cleanName = override ? override.display : rawName;
    const category = normalizeCategory(String(r["نوع المحصول"] || ""));

    const rawKeys = [
      rawName,
      cleanName,
      cleanName.replace(/\(.*?\)/g, "").trim(),
      ...(override?.aliases || []),
    ];
    const searchKeys = Array.from(
      new Set(
        rawKeys
          .flatMap((k) => [
            normalizeArabicForMatch(k),
            stripAlPrefixWords(normalizeArabicForMatch(k)),
          ])
          .filter((k) => k.length >= 2)
      )
    );

    const sections: string[] = [`المحصول: ${cleanName} (${category})`];
    if (importance) sections.push(`- القيمة الاقتصادية والأهمية:\n${importance}`);
    if (environment) sections.push(`- التربة والمناخ والاحتياجات البيئية:\n${environment}`);
    if (seedsAndNursery) sections.push(`- كمية التقاوي والشتلات ومواعيد الزراعة:\n${seedsAndNursery}`);
    if (practices) sections.push(`- تجهيز الأرض وطريقة الزراعة والخدمة:\n${practices}`);
    if (irrigation) sections.push(`- نظام الري والاحتياجات المائية والملوحة:\n${irrigation}`);
    if (fertilization) sections.push(`- برنامج التسميد العضوي والحيوي:\n${fertilization}`);
    if (pestControl) sections.push(`- الآفات والأمراض وطرق الوقاية والمكافحة الحيوية:\n${pestControl}`);
    if (harvest) sections.push(`- مواعيد وطرق الحصاد والإنتاجية:\n${harvest}`);
    if (postHarvest) sections.push(`- معاملات ما بعد الحصاد والتجفيف والتخزين:\n${postHarvest}`);
    if (extraNotes) sections.push(`- ملاحظات إضافية:\n${extraNotes}`);

    records.push({
      id: `plant_${records.length + 1}`,
      name: cleanName,
      raw_name: rawName,
      category,
      importance,
      environment,
      seeds_and_nursery: seedsAndNursery,
      agricultural_practices: practices,
      irrigation,
      fertilization,
      pest_and_disease_control: pestControl,
      harvest,
      post_harvest: postHarvest,
      extra_notes: extraNotes,
      search_keys: searchKeys,
      full_reference_text: sections.join("\n\n"),
    });
  }

  return records;
}

export function findMatchingPlants(
  query: string,
  plantsDb: PlantDatabaseRecord[],
  maxMatches = 2
): PlantDatabaseRecord[] {
  const cleaned = query.replace(/^نعم[،,\s]+/i, "").trim();
  const normQuery = normalizeArabicForMatch(cleaned);
  if (!normQuery) return [];
  const strippedQuery = stripAlPrefixWords(normQuery);
  const paddedNorm = ` ${normQuery} `;
  const paddedStripped = ` ${strippedQuery} `;

  // 1. Exact full match against display name or search key
  for (const p of plantsDb) {
    if (
      normalizeArabicForMatch(p.name) === normQuery ||
      normalizeArabicForMatch(p.raw_name) === normQuery ||
      p.search_keys.includes(normQuery) ||
      p.search_keys.includes(strippedQuery)
    ) {
      return [p];
    }
  }

  // 2. Whole-word boundary match sorted by longest key first
  const candidates: Array<{ plant: PlantDatabaseRecord; keyLen: number }> = [];
  for (const p of plantsDb) {
    let bestLen = 0;
    for (const key of p.search_keys) {
      if (key.length < 2) continue;
      if (paddedNorm.includes(` ${key} `) || paddedStripped.includes(` ${key} `)) {
        if (key.length > bestLen) bestLen = key.length;
      }
    }
    if (bestLen > 0) {
      candidates.push({ plant: p, keyLen: bestLen });
    }
  }

  candidates.sort((a, b) => b.keyLen - a.keyLen);
  return candidates.slice(0, maxMatches).map((c) => c.plant);
}

export function findFuzzyPlantSuggestion(
  query: string,
  plantsDb: PlantDatabaseRecord[]
): PlantDatabaseRecord | null {
  const normQuery = stripAlPrefixWords(normalizeArabicForMatch(query));
  if (!normQuery || normQuery.length < 3 || normQuery.split(" ").length > 3) return null;

  let bestPlant: PlantDatabaseRecord | null = null;
  let bestDist = 99;

  for (const p of plantsDb) {
    for (const key of p.search_keys) {
      const strippedKey = stripAlPrefixWords(key);
      if (strippedKey.length < 3) continue;
      const dist = levenshteinDistance(normQuery, strippedKey);
      const maxAllowed = strippedKey.length >= 6 ? 2 : 1;
      if (dist <= maxAllowed && dist < bestDist) {
        bestDist = dist;
        bestPlant = p;
      }
    }
  }
  return bestPlant;
}

export function buildDeterministicPlantFallback(
  plant: PlantDatabaseRecord,
  userQuery: string
): string {
  const q = normalizeArabicForMatch(userQuery);
  const parts: string[] = [`بخصوص محصول **${plant.name}**:`];

  if (
    q.includes("حشر") ||
    q.includes("فطر") ||
    q.includes("اعفان") ||
    q.includes("عفن") ||
    q.includes("افه") ||
    q.includes("افات") ||
    q.includes("مرض") ||
    q.includes("امراض") ||
    q.includes("مكافح") ||
    q.includes("دود") ||
    q.includes("بياض") ||
    q.includes("ذبول") ||
    q.includes("حشائش") ||
    q.includes("رش")
  ) {
    if (plant.pest_and_disease_control) {
      parts.push(
        `**توصيات الوقاية والمكافحة الحيوية المعتمدة في الجمعية:**\n${plant.pest_and_disease_control}`
      );
    }
  } else if (
    q.includes("تسميد") ||
    q.includes("سماد") ||
    q.includes("كمبوست") ||
    q.includes("ضعف") ||
    q.includes("اصفرار")
  ) {
    if (plant.fertilization) {
      parts.push(`**برنامج التسميد العضوي والحيوي المعتمد:**\n${plant.fertilization}`);
    }
    if (plant.agricultural_practices) {
      parts.push(`**تجهيز الأرض والخدمة:**\n${plant.agricultural_practices}`);
    }
  } else if (q.includes("ري") || q.includes("مياه") || q.includes("ملوح") || q.includes("ترب")) {
    if (plant.irrigation) parts.push(`**نظام الري والملوحة:**\n${plant.irrigation}`);
    if (plant.environment) parts.push(`**التربة والاحتياجات البيئية:**\n${plant.environment}`);
  } else if (
    q.includes("تقاوي") ||
    q.includes("بذور") ||
    q.includes("شتل") ||
    q.includes("ميعاد") ||
    q.includes("زراع")
  ) {
    if (plant.seeds_and_nursery) {
      parts.push(`**التقاوي ومواعيد الزراعة:**\n${plant.seeds_and_nursery}`);
    }
    if (plant.agricultural_practices) {
      parts.push(`**طريقة الزراعة وتجهيز الأرض:**\n${plant.agricultural_practices}`);
    }
  } else if (q.includes("حصاد") || q.includes("جمع") || q.includes("انتاج") || q.includes("تخزين")) {
    if (plant.harvest) parts.push(`**الحصاد والإنتاجية:**\n${plant.harvest}`);
    if (plant.post_harvest) parts.push(`**معاملات ما بعد الحصاد والتخزين:**\n${plant.post_harvest}`);
  }

  if (parts.length === 1) {
    if (plant.environment) parts.push(`**التربة والمناخ:**\n${plant.environment}`);
    if (plant.seeds_and_nursery) parts.push(`**التقاوي وميعاد الزراعة:**\n${plant.seeds_and_nursery}`);
    if (plant.fertilization) parts.push(`**التسميد الحيوي:**\n${plant.fertilization}`);
    if (plant.irrigation) parts.push(`**الري:**\n${plant.irrigation}`);
    if (plant.pest_and_disease_control) {
      parts.push(`**الوقاية والمكافحة الحيوية:**\n${plant.pest_and_disease_control}`);
    }
  }

  parts.push("يمكنك اختيار استفسار آخر عن المحصول من الاختيارات بالأسفل أو كتابة سؤالك مباشرة:");
  return parts.join("\n\n");
}

// --- INTENT & VALIDATION HELPERS ---
function isMainMenuResetCommand(norm: string): boolean {
  return normIn(norm, [
    "القائمة الرئيسية",
    "رجوع للقائمة الرئيسية",
    "إلغاء والرجوع للقائمة الرئيسية",
    "إلغاء",
    "بداية جديدة",
    "قائمة رئيسية",
  ]);
}

function isBackCommand(norm: string): boolean {
  return (
    normIn(norm, ["رجوع", "السابق", "الخطوة السابقة", "رجوع للخطوة السابقة"]) ||
    norm.startsWith(normalizeArabicForMatch("رجوع لتعديل"))
  );
}

function isRegisterIntent(norm: string, raw: string): boolean {
  return (
    raw.trim() === "1" ||
    normIn(norm, [
      "تسجيل في الجمعية",
      "التسجيل في الجمعية",
      "تسجيل عضوية",
      "تسجيل عضو آخر",
      "تسجيل في الجمعية للمتابعة والتدريب",
      "اشترك في الجمعية",
      "انضمام للجمعية",
      "عايز أسجل في الجمعية",
    ])
  );
}

function isAboutIntent(norm: string, raw: string): boolean {
  return (
    raw.trim() === "2" ||
    normIn(norm, [
      "ما هي الجمعية؟",
      "ما هي الجميعة",
      "إيه هي الجمعية",
      "عن الجمعية",
      "تعريف الجمعية",
      "عرفني بالجمعية",
    ])
  );
}

function isCropProblemIntent(norm: string, raw: string): boolean {
  return (
    raw.trim() === "3" ||
    normIn(norm, [
      "هل توجد مشكلة في محصول؟",
      "مشكلة في محصول",
      "مشكلة في محصول آخر",
      "اختيار نبات آخر",
      "اختيار محصول آخر",
      "رجوع لأقسام المحاصيل",
      "عندي مشكلة في محصول",
    ])
  );
}

function isCropGuideIntent(norm: string, raw: string): boolean {
  return (
    raw.trim() === "5" ||
    normIn(norm, [
      "دليل زراعة محصول كامل",
      "دليل زراعة محصول",
      "طريقة زراعة محصول",
      "دليل المحاصيل",
    ])
  );
}

function isSmartCropRecommendationIntent(
  norm: string,
  raw: string,
  plantsDb: PlantDatabaseRecord[]
): boolean {
  if (
    raw.trim() === "4" ||
    normIn(norm, [
      "ترشيح أنسب محصول لأرضي",
      "ترشيح محصول لأرضي",
      "اختيار أنسب محصول",
      "أنسب محصول لأرضي",
    ])
  ) {
    return true;
  }

  const strongPhrases = [
    "انسب نبات",
    "انسب محصول",
    "انسب زرعه",
    "انسب منتج",
    "انسب حاجه ازرعها",
    "احسن نبات",
    "احسن محصول",
    "احسن منتج",
    "احسن زرعه",
    "افضل نبات",
    "افضل محصول",
    "افضل منتج",
    "افضل زرعه",
    "ازرع ايه",
    "نزرع ايه",
    "تزرع ايه",
    "ممكن ازرع ايه",
    "ايه اللي يتزرع",
    "ايه المحصول المناسب",
    "ايه النبات المناسب",
    "ترشحلي",
    "ترشحولي",
    "رشحلي",
    "رشحولي",
    "اختار محصول",
    "اختار نبات",
    "محتار ازرع",
    "تنصحني ازرع",
    "تنصحوني ازرع",
  ];

  if (strongPhrases.some((p) => normHas(norm, p))) {
    return true;
  }

  // Also catch land-suitability inquiries when no specific crop is named in the message
  const mentionsLand =
    normHas(norm, "التربه عندي") ||
    normHas(norm, "تربتي") ||
    normHas(norm, "ارضي") ||
    normHas(norm, "الارض عندي") ||
    normHas(norm, "عندي ارض") ||
    normHas(norm, "عندي فدان") ||
    normHas(norm, "عندي مساحه");

  const asksSuitability =
    normHas(norm, "انسب") ||
    normHas(norm, "احسن") ||
    normHas(norm, "افضل") ||
    normHas(norm, "ايه") ||
    normHas(norm, "ينفع") ||
    normHas(norm, "يصلح") ||
    normHas(norm, "يجود");

  if (mentionsLand && asksSuitability && findMatchingPlants(raw, plantsDb, 1).length === 0) {
    return true;
  }

  return false;
}

interface AgronomicDimensions {
  hasSoil: boolean;
  hasTime: boolean;
  hasAreaOrIrrigation: boolean;
  hasGoal: boolean;
}

function extractAgronomicDimensions(rawCombined: string): AgronomicDimensions {
  const n = normalizeArabicForMatch(rawCombined);

  const soilTerms = [
    "رملي",
    "رمل",
    "طيني",
    "طين",
    "صفراء",
    "طميي",
    "جيري",
    "كلسي",
    "صحراو",
    "ملح",
    "ملوح",
    "عذب",
    "بحاري",
    "نيلي",
    "ارتوازي",
    "بئر",
    "ابار",
    "صرف",
    "ثقيل",
    "خفيف",
    "مستصلح",
    "بكر",
    "جزء في المليون",
    "ppm",
    "ec",
  ];

  const timeTerms = [
    "شتاء",
    "شتوي",
    "صيف",
    "صيفي",
    "خريف",
    "خريفي",
    "ربيع",
    "ربيعي",
    "عروه",
    "شهر",
    "يناير",
    "فبراير",
    "مارس",
    "ابريل",
    "مايو",
    "يونيو",
    "يوليو",
    "اغسطس",
    "سبتمبر",
    "اكتوبر",
    "نوفمبر",
    "ديسمبر",
    "دلوقتي",
    "الايام دي",
    "الشهر الجاي",
    "الحالي",
    "موسم",
  ];

  const areaIrrigTerms = [
    "فدان",
    "فدادين",
    "قيراط",
    "قراريط",
    "هكتار",
    "مساحه",
    "تنقيط",
    "غمر",
    "رش",
    "محوري",
    "بيفوت",
    "خطوط",
    "مصاطب",
  ];

  const goalTerms = [
    "طبي",
    "عطري",
    "تصدير",
    "خضار",
    "خضروات",
    "حقلي",
    "حبوب",
    "علف",
    "مواشي",
    "فاكهه",
    "اشجار",
    "شجر",
    "زيت",
    "سريع",
    "مستديم",
    "عائد",
    "ربح",
    "تعاقد",
  ];

  return {
    hasSoil: soilTerms.some((t) => normHas(n, t)),
    hasTime: timeTerms.some((t) => normHas(n, t)),
    hasAreaOrIrrigation: areaIrrigTerms.some((t) => normHas(n, t)),
    hasGoal: goalTerms.some((t) => normHas(n, t)),
  };
}

export function scoreCropsForLandConditions(
  combinedFarmerNotes: string,
  plantsDb: PlantDatabaseRecord[],
  topN = 6
): PlantDatabaseRecord[] {
  const n = normalizeArabicForMatch(combinedFarmerNotes);

  const wantsSandy =
    normHas(n, "رملي") || normHas(n, "رمل") || normHas(n, "صحراو") || normHas(n, "خفيف") || normHas(n, "مستصلح");
  const wantsClay =
    normHas(n, "طيني") || normHas(n, "طين") || normHas(n, "ثقيل") || normHas(n, "طميي") || normHas(n, "صفراء");
  const wantsCalcareous = normHas(n, "جيري") || normHas(n, "كلسي");
  const hasSalinityOrWell =
    normHas(n, "ملوح") || normHas(n, "ملح") || normHas(n, "ابار") || normHas(n, "بئر") || normHas(n, "ارتوازي");

  const wantsWinter =
    normHas(n, "شتاء") ||
    normHas(n, "شتوي") ||
    normHas(n, "خريف") ||
    normHas(n, "سبتمبر") ||
    normHas(n, "اكتوبر") ||
    normHas(n, "نوفمبر") ||
    normHas(n, "ديسمبر") ||
    /(?:^|\s)شهر\s*(9|10|11|12|1)(?:\s|$)/.test(n);

  const wantsSummer =
    normHas(n, "صيف") ||
    normHas(n, "صيفي") ||
    normHas(n, "ربيع") ||
    normHas(n, "فبراير") ||
    normHas(n, "مارس") ||
    normHas(n, "ابريل") ||
    normHas(n, "مايو") ||
    normHas(n, "يونيو") ||
    /(?:^|\s)شهر\s*(2|3|4|5|6|7|8)(?:\s|$)/.test(n);

  const wantsDrip = normHas(n, "تنقيط");
  const wantsFlood = normHas(n, "غمر");
  const wantsSprinkler = normHas(n, "رش") || normHas(n, "محوري") || normHas(n, "بيفوت");

  const wantsMedicinal = normHas(n, "طبي") || normHas(n, "عطري") || normHas(n, "تصدير");
  const wantsVeg = normHas(n, "خضار") || normHas(n, "خضروات") || normHas(n, "سريع");
  const wantsField = normHas(n, "حقلي") || normHas(n, "حبوب") || normHas(n, "علف") || normHas(n, "مواشي");
  const wantsTrees = normHas(n, "فاكهه") || normHas(n, "اشجار") || normHas(n, "شجر") || normHas(n, "مستديم");
  const wantsOil = normHas(n, "زيت");

  const scored = plantsDb.map((p) => {
    let score = 0;
    const envNorm = normalizeArabicForMatch(`${p.environment} ${p.extra_notes}`);
    const seedNorm = normalizeArabicForMatch(`${p.seeds_and_nursery} ${p.environment}`);
    const irrNorm = normalizeArabicForMatch(`${p.irrigation} ${p.environment}`);
    const catNorm = normalizeArabicForMatch(p.category);

    // Richness baseline so well-documented CSV crops lead
    const filledCols = [
      p.importance,
      p.environment,
      p.seeds_and_nursery,
      p.agricultural_practices,
      p.irrigation,
      p.fertilization,
      p.pest_and_disease_control,
      p.harvest,
    ].filter((c) => c && c.length > 5).length;
    score += Math.min(4, Math.floor(filledCols / 2));

    // Soil Texture Scoring
    if (wantsSandy) {
      if (normHas(envNorm, "رملي") || normHas(envNorm, "خفيف") || normHas(envNorm, "صحراو") || normHas(envNorm, "مستصلح")) {
        score += 10;
      }
      if (normHas(envNorm, "جيده الصرف")) score += 3;
      if (normEq(normalizeArabicForMatch(p.name), "الأرز")) score -= 12;
    }

    if (wantsClay) {
      if (normHas(envNorm, "طيني") || normHas(envNorm, "طميي") || normHas(envNorm, "صفراء") || normHas(envNorm, "خصب")) {
        score += 10;
      }
    }

    if (wantsCalcareous) {
      if (normHas(envNorm, "جيري") || normHas(envNorm, "كلسي")) {
        score += 10;
      }
    }

    if (hasSalinityOrWell) {
      const isSalinitySensitive =
        normHas(irrNorm, "حساس للملوح") ||
        normHas(irrNorm, "حساسه للملوح") ||
        normHas(irrNorm, "لا يتحمل الملوح") ||
        normHas(irrNorm, "لا تتحمل الملوح");

      if (isSalinitySensitive) {
        score -= 12;
      } else if (
        normHas(irrNorm, "يتحمل الملوح") ||
        normHas(irrNorm, "متحمل للملوح") ||
        normHas(irrNorm, "تتحمل الملوح") ||
        normHas(envNorm, "ملوحه متوسطه") ||
        normHas(envNorm, "ملوحه عاليه")
      ) {
        score += 12;
      }
    }

    // Season / Planting Month Scoring
    if (wantsWinter) {
      if (
        normHas(seedNorm, "شتوي") ||
        normHas(seedNorm, "شتاء") ||
        normHas(seedNorm, "خريف") ||
        normHas(seedNorm, "سبتمبر") ||
        normHas(seedNorm, "اكتوبر") ||
        normHas(seedNorm, "نوفمبر")
      ) {
        score += 14;
      } else if (
        normHas(seedNorm, "فبراير") ||
        normHas(seedNorm, "مارس") ||
        normHas(seedNorm, "ابريل") ||
        normHas(seedNorm, "صيفي")
      ) {
        score -= 8;
      }
    }

    if (wantsSummer) {
      if (
        normHas(seedNorm, "صيفي") ||
        normHas(seedNorm, "صيف") ||
        normHas(seedNorm, "ربيع") ||
        normHas(seedNorm, "فبراير") ||
        normHas(seedNorm, "مارس") ||
        normHas(seedNorm, "ابريل") ||
        normHas(seedNorm, "مايو")
      ) {
        score += 14;
      } else if (normHas(seedNorm, "اكتوبر") || normHas(seedNorm, "نوفمبر")) {
        score -= 8;
      }
    }

    // Irrigation System Scoring
    if (wantsDrip && normHas(irrNorm, "تنقيط")) score += 7;
    if (wantsFlood && normHas(irrNorm, "غمر")) score += 7;
    if (wantsSprinkler && (normHas(irrNorm, "رش") || normHas(irrNorm, "محوري"))) score += 7;

    // Goal / Category Scoring
    if (wantsMedicinal && normHas(catNorm, "طبيه")) score += 10;
    if (wantsVeg && normHas(catNorm, "خضروات")) score += 10;
    if (wantsField && normHas(catNorm, "حقليه")) score += 10;
    if (wantsTrees && normHas(catNorm, "فاكهه")) score += 11;
    if (wantsOil && normHas(catNorm, "زيتيه")) score += 10;

    return { plant: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.plant);
}

function buildSmartAdvisorTurn(params: {
  rawUserMessage: string;
  prevNotes: string[];
  prevTurnsAsked: number;
  plantsDb: PlantDatabaseRecord[];
}): AiFlowTurnResult {
  const updatedNotes = [...params.prevNotes, params.rawUserMessage].slice(-6);
  const combinedText = updatedNotes.join(" | ");
  const dims = extractAgronomicDimensions(combinedText);
  const coreCount =
    Number(dims.hasSoil) + Number(dims.hasTime) + Number(dims.hasAreaOrIrrigation);

  // Phase 1: Ask smart, natural conversational questions to understand the farmer's land before recommending
  if (coreCount < 2 && params.prevTurnsAsked < 2) {
    const missingQuestions: string[] = [];
    if (!dims.hasSoil) {
      missingQuestions.push(
        "- **نوع التربة ومصدر المياه:** هل التربة عندك رملية، طينية، أم صفراء؟ وهل مياه الري بحاري عذبة أم آبار وفيها نسبة ملوحة؟"
      );
    }
    if (!dims.hasTime) {
      missingQuestions.push(
        "- **وقت الزراعة:** ناوي تزرع في شهر كام أو في أي موسم (شتوي / صيفي / خريفي)؟"
      );
    }
    if (!dims.hasAreaOrIrrigation) {
      missingQuestions.push(
        "- **المساحة ونظام الري:** المساحة كام فدان تقريباً؟ وطريقة الري المتاحة إيه (تنقيط، رش، أم غمر)؟"
      );
    }
    if (!dims.hasGoal) {
      missingQuestions.push(
        "- **طبيعة المحصول المفضل:** بتفضل محصول سريع العائد (خضروات / نباتات طبية وعطرية / محاصيل حقلية) أم أشجار فاكهة مستديمة؟"
      );
    }

    const nextTurnsAsked = params.prevTurnsAsked + 1;
    const fallbackIntro =
      params.prevTurnsAsked === 0
        ? "عشان نرشحلك أنسب وأنجح محصول لأرضك من قاعدة بيانات **الجمعية المصرية للزراعة الحيوية** (67 محصولاً)، محتاج أعرف منك كام تفصيلة بسيطة عن أرضك:"
        : "تمام، كده الصورة بدأت توضح. عشان الترشيح يكون دقيق ومناسب لأرضك بالظبط، ياريت توضحلي كمان:";

    const deterministicQuestionReply = `${fallbackIntro}\n\n${missingQuestions.join(
      "\n"
    )}\n\nاكتبلي التفاصيل دي في رسالتك بطبيعتك وهرد عليك بأفضل المحاصيل المناسبة لظروفك.`;

    const focusedPrompt = `[وضع المستشار الزراعي الذكي لاختيار أنسب محصول — تنبيه مهم جداً]:
المزارع يطلب مساعدة ذكية لاختيار أنسب نبات أو محصول لتربته وأرضه.
- تنبيه سياقي حاسم: حتى لو كان المزارع يتحدث في الرسائل السابقة عن محصول معين (مثل الطماطم أو غيرها)، فقد انتقل الآن لسؤال عام لاختيار أنسب محصول جديد لأرضه؛ **لا تحصر إجابتك في المحصول السابق أبداً**.
- المعلومات المتوفرة حتى الآن من كلام المزارع: "${combinedText}"
- المعلومات الناقصة التي يجب سؤال المزارع عنها بذكاء وبطريقة حوارية طبيعية ومختصرة قبل ترشيح المحصول:
${missingQuestions.join("\n")}
- المطلوب منك الآن: تفاعل بذكاء مع ما ذكره المزارع (بدون كتابة "أهلاً بيك" في البداية)، واسأله الأسئلة الناقصة أعلاه بأسلوب مستشار زراعي خبير وودود بحيث يكتب هو إجابته بحرية في الرسالة القادمة.`;

    return {
      kind: "ai_with_db",
      matched_plants: [],
      focused_db_context: focusedPrompt,
      deterministic_fallback: deterministicQuestionReply,
      quick_replies: [],
      ui_mode: "default",
      next_flow_state: {
        mode: "smart_advisor",
        step: "gather_land_conditions",
        advisor_context: {
          accumulated_notes: updatedNotes,
          turns_asked: nextTurnsAsked,
        },
      },
    };
  }

  // Phase 2: Sufficient field info gathered -> Score all 67 CSV crops and deliver smart comparative recommendation
  const topCandidates = scoreCropsForLandConditions(combinedText, params.plantsDb, 6);
  const top3 = topCandidates.slice(0, 3);

  const candidatesDossier = topCandidates
    .map((p, idx) => {
      const lines = [`${idx + 1}) المحصول: ${p.name} (${p.category})`];
      if (p.environment) lines.push(`   - التربة والمناخ: ${p.environment}`);
      if (p.seeds_and_nursery) lines.push(`   - التقاوي وميعاد الزراعة: ${p.seeds_and_nursery}`);
      if (p.irrigation) lines.push(`   - الري والملوحة: ${p.irrigation}`);
      if (p.importance) lines.push(`   - القيمة الاقتصادية: ${p.importance}`);
      if (p.fertilization) lines.push(`   - ملخص التسميد الحيوي: ${p.fertilization}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const fallbackBullets = top3
    .map((p, idx) => {
      const envSnippet = p.environment ? p.environment.split("\n")[0].slice(0, 140) : "مناسب لظروف أرضك";
      const seedSnippet = p.seeds_and_nursery
        ? ` | التقاوي والميعاد: ${p.seeds_and_nursery.split("\n")[0].slice(0, 120)}`
        : "";
      return `${idx + 1}. **${p.name}** (${p.category}):\n   - الملائمة: ${envSnippet}${seedSnippet}`;
    })
    .join("\n\n");

  const deterministicRecommendation = `بناءً على مواصفات أرضك وظروف الزراعة اللي وضحتها، دي أنسب المحاصيل الحيوية المرشحة ليك من قاعدة بيانات الجمعية:\n\n${fallbackBullets}\n\nتحب نمسك أي محصول فيهم ونحسبلك كمية التقاوي والكمبوست وبرنامج الخدمة الكامل لمساحتك، ولا عندك تفاصيل تانية عن ملوحة المياه أو التسويق تحب نراعيها؟`;

  const focusedRecommendationPrompt = `[وضع المستشار الزراعي الذكي — ترشيح أنسب المحاصيل بناءً على بيانات أرض المزارع]:
- مواصفات أرض وظروف المزارع الكاملة: "${combinedText}"
- أفضل 6 محاصيل مطابقة لظروفه من قاعدة بيانات الجمعية المصرية للزراعة الحيوية (67 محصولاً):
${candidatesDossier}

المطلوب منك كمستشار زراعي ذكي (بدون أي تحية مثل "أهلاً بيك" في البداية):
1. رشح للمزارع **أفضل 3 محاصيل** من القائمة المرفقة أعلاه تتناسب بدقة مع نوع تربته، وقت زراعته، مساحته، ونظام الري عنده.
2. وضح لكل محصول في نقاط موجزة وعملية: **لماذا هو مناسب لأرضه وموعده** + **ميعاد الزراعة وكمية التقاوي/الشتلات للفدان** من البيانات المرفقة.
3. اختم ردك **بسؤال استشاري ذكي** يحفز الحوار (مثلاً اسأله أي محصول فيهم يفضل البدء به لنجهز له برنامج الكمبوست والتسميد الحيوي لمساحته، أو اسأله عن درجة ملوحة المياه لو لم يذكرها).`;

  return {
    kind: "ai_with_db",
    matched_plants: top3,
    focused_db_context: focusedRecommendationPrompt,
    deterministic_fallback: deterministicRecommendation,
    quick_replies: [...top3.map((p) => p.name), "أخرى (محصول أو سؤال آخر)", "القائمة الرئيسية"],
    ui_mode: "whatsapp_list",
    next_flow_state: {
      mode: "smart_advisor",
      step: "advisor_followup",
      advisor_context: {
        accumulated_notes: updatedNotes,
        turns_asked: params.prevTurnsAsked + 1,
        recommended_plant_ids: top3.map((p) => p.id),
      },
    },
  };
}

const KNOWN_EXTRA_ARABIC_CROPS: string[] = [
  "مانجو",
  "مانجا",
  "زيتون",
  "نخيل",
  "نخل",
  "بلح",
  "تمر",
  "بصل",
  "ثوم",
  "توم",
  "خيار",
  "باميه",
  "قلقاس",
  "سبانخ",
  "جرجير",
  "فجل",
  "لوبيا",
  "ترمس",
  "سمسم",
  "قصب",
  "قصب السكر",
  "موز",
  "برتقال",
  "يوسفي",
  "ليمون",
  "موالح",
  "تين",
  "تين شوكي",
  "خوخ",
  "برقوق",
  "مشمش",
  "كاكي",
  "كيوي",
  "افوكادو",
  "توت",
  "زعتر",
  "بردقوش",
  "شمر",
  "شيح",
  "حبق",
  "صبار",
  "الوفيرا",
  "ازولا",
  "بونيكام",
  "برسيم حجازي",
  "حجازي",
  "دخن",
  "كانولا",
  "قرنبيط",
  "بروكلي",
  "بطيخ",
  "شمام",
  "كنتالوب",
  "شهد",
  "قثاء",
  "قته",
  "خردل",
  "زنجبيل",
  "كركم",
  "تليو",
  "ورق لورا",
];

function detectExtraArabicCropName(raw: string, norm: string): string | null {
  const stripped = stripAlPrefixWords(norm);
  const padded = ` ${norm} `;
  const paddedStripped = ` ${stripped} `;
  for (const extra of KNOWN_EXTRA_ARABIC_CROPS) {
    const nExtra = normalizeArabicForMatch(extra);
    if (
      norm === nExtra ||
      stripped === nExtra ||
      padded.includes(` ${nExtra} `) ||
      paddedStripped.includes(` ${nExtra} `)
    ) {
      return norm.split(" ").length <= 2 ? raw.trim() : extra;
    }
  }
  return null;
}

function isGeneralOtherIntent(norm: string, raw: string): boolean {
  return (
    raw.trim() === "6" ||
    normIn(norm, [
      OTHER_GENERAL_OPTION_LABEL,
      "أخرى",
      "اخري",
      "سؤال آخر",
      "استفسار آخر",
      "أخرى (سؤال آخر)",
      "أخرى (محصول أو سؤال آخر)",
      "موضوع آخر",
    ])
  );
}

function buildCustomPlantPrompt(
  customCropName: string,
  submode: "problem" | "guide"
): InstantFlowTurnResult {
  if (submode === "guide") {
    return makeInstantResult(
      `محصول **${customCropName}**:\nاختر **المرحلة الزراعية** لعرض التوصيات العضوية المبسطة، أو اختر **«أخرى»** لكتابة سؤالك مباشرة:`,
      getCropGuideStageChoices(customCropName),
      {
        mode: "crop_flow",
        step: "select_topic_or_symptom",
        crop_submode: "guide",
        selected_plant_name: customCropName,
        is_other_plant: true,
      }
    );
  }

  return makeInstantResult(
    `محصول **${customCropName}**:\nاختر **نوع المشكلة أو الاستفسار** من الاختيارات بالأسفل، أو اختر **«أخرى»** أو اكتب سؤالك مباشرة:`,
    getCropDiagnosticChoices(customCropName),
    {
      mode: "crop_flow",
      step: "select_topic_or_symptom",
      crop_submode: "problem",
      selected_plant_name: customCropName,
      is_other_plant: true,
    }
  );
}

function isPureGreeting(norm: string): boolean {
  const greetings = new Set([
    "السلام عليكم",
    "سلام عليكم",
    "وعليكم السلام",
    "اهلا",
    "اهلا بيك",
    "اهلا وسهلا",
    "مرحبا",
    "صباح الخير",
    "مساء الخير",
    "ازيك",
    "هاي",
    "hello",
    "hi",
  ]);
  return greetings.has(norm);
}

function isMeaningfulAgriculturalQuery(raw: string, norm: string): boolean {
  if (!norm || norm.length < 4) return false;
  // Reject strings made only of digits or punctuation
  if (!/[\p{L}]/u.test(raw)) return false;

  const agriKeywords = [
    "زراع",
    "محصول",
    "نبات",
    "ارض",
    "ترب",
    "ري",
    "ميه",
    "مياه",
    "ملوح",
    "تسميد",
    "سماد",
    "كمبوست",
    "شاي",
    "فوسفات",
    "فلسبار",
    "كبريت",
    "حيوي",
    "عضوي",
    "اورجانيك",
    "افه",
    "افات",
    "حشر",
    "فطر",
    "مرض",
    "امراض",
    "اصاب",
    "علاج",
    "مكافح",
    "وقاي",
    "رش",
    "دود",
    "من",
    "ذباب",
    "عنكبوت",
    "تربس",
    "جاسيد",
    "حفار",
    "نيماتودا",
    "بياض",
    "ذبول",
    "عفن",
    "اعفان",
    "صدأ",
    "تبقع",
    "اصفرار",
    "ضعف",
    "حشائش",
    "تقاوي",
    "بذور",
    "شتل",
    "ميعاد",
    "موعد",
    "حصاد",
    "انتاج",
    "فدان",
    "شجر",
    "ورق",
    "جذور",
    "ثمار",
    "تزهير",
    "عقد",
    "نيم",
    "بوتاسي",
    "ترايكوديرما",
    "باسيلس",
    "جمعيه",
    "تدريب",
    "نصيح",
    "نصائح",
    "ارشاد",
  ];

  if (agriKeywords.some((kw) => norm.includes(kw))) {
    return true;
  }

  // Also allow clear multi-word Arabic questions (>= 3 words) starting with question words
  const words = norm.split(" ").filter((w) => w.length >= 2);
  const questionStarters = ["ازاي", "كيف", "امتي", "متي", "ليه", "لماذا", "ما", "ايه", "هل", "كم", "عايز", "محتاج", "عندي"];
  if (words.length >= 3 && questionStarters.some((qs) => words[0] === qs)) {
    return true;
  }

  return false;
}

function validateFullName(raw: string): { valid: boolean; cleaned?: string; error?: string } {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (/\d/.test(trimmed)) {
    return {
      valid: false,
      error:
        "عذراً، يحتوي الاسم المدخل على أرقام. يرجى كتابة **الاسم الثنائي أو الثلاثي بالكامل** بالحروف فقط (مثال: محمد أحمد علي):",
    };
  }
  const letterWords = trimmed
    .split(" ")
    .filter((w) => /^[\p{L}]{2,}$/u.test(w));
  if (letterWords.length < 2 || trimmed.length < 5) {
    return {
      valid: false,
      error:
        "عذراً، يرجى كتابة **الاسم الثنائي أو الثلاثي بالكامل** بشكل واضح لإتمام التسجيل في الجمعية (مثال: محمد أحمد علي):",
    };
  }
  return { valid: true, cleaned: trimmed };
}

function getGovernorateRegionMenuReplies(): string[] {
  return [
    ...GOVERNORATE_REGIONS.map((r) => r.label),
    "رجوع لتعديل التليفون",
    "القائمة الرئيسية",
  ];
}

function buildRegistrationReviewPrompt(
  draft: NonNullable<SessionFlowState["draft_registration"]>
): InstantFlowTurnResult {
  const fullLoc = draft.location_detail
    ? `${draft.governorate} (${draft.location_detail})`
    : draft.governorate || "-";
  const summary =
    "يرجى مراجعة بيانات التسجيل في **الجمعية المصرية للزراعة الحيوية** والتأكد من صحتها قبل الحفظ النهائي:\n\n" +
    `- **الاسم:** ${draft.full_name || "-"}\n` +
    `- **رقم التليفون:** ${draft.phone || "-"}\n` +
    `- **المحافظة الرسمية:** ${fullLoc}\n` +
    `- **المساحة ونظام الري:** ${draft.land_and_irrigation || "-"}\n` +
    `- **المحاصيل:** ${draft.crops || "-"}\n` +
    `- **الدعم المطلوب:** ${draft.support_needed || "-"}\n\n` +
    "اضغط **«تأكيد وإرسال التسجيل»** لإتمام التسجيل، أو اختر أي بيان لتعديله:";

  return makeInstantResult(
    summary,
    [
      "تأكيد وإرسال التسجيل",
      "تعديل رقم التليفون",
      "تعديل المحافظة",
      "تعديل الاسم",
      "تعديل المساحة والري",
      "تعديل المحاصيل",
      "القائمة الرئيسية",
    ],
    {
      mode: "register",
      step: "review_registration",
      draft_registration: draft,
    }
  );
}

export function getCropDiagnosticChoices(plantName: string): string[] {
  return [
    "إصابة حشرية في المحصول",
    "إصابة فطرية أو أعفان",
    "ضعف نمو أو تسميد حيوي",
    "مشكلة في الري أو الملوحة",
    "مشكلة حشائش في الأرض",
    OTHER_CROP_TOPIC_LABEL,
    `دليل زراعة ${plantName}`,
    "اختيار محصول آخر",
    "القائمة الرئيسية",
  ];
}

export function getCropGuideStageChoices(_plantName: string): string[] {
  return [
    "1. التربة والمناخ المناسب",
    "2. التقاوي وميعاد الزراعة",
    "3. تجهيز الأرض بالكمبوست",
    "4. برنامج الري والملوحة",
    "5. برنامج التسميد الحيوي",
    "6. الوقاية والمكافحة الحيوية",
    "7. الحصاد والتخزين",
    OTHER_CROP_TOPIC_LABEL,
    "اختيار محصول آخر",
    "القائمة الرئيسية",
  ];
}

function getPostAnswerCropChoices(plantName: string, submode: "problem" | "guide"): string[] {
  if (submode === "guide") {
    return getCropGuideStageChoices(plantName);
  }
  return [
    "إصابة حشرية في المحصول",
    "إصابة فطرية أو أعفان",
    "ضعف نمو أو تسميد حيوي",
    "مشكلة في الري أو الملوحة",
    OTHER_CROP_TOPIC_LABEL,
    `دليل زراعة ${plantName}`,
    "تسجيل في الجمعية",
    "اختيار محصول آخر",
    "القائمة الرئيسية",
  ];
}

const REG_LAND_CHOICES: string[] = [
  "أقل من 5 فدان - ري غمر",
  "أقل من 5 فدان - ري تنقيط",
  "5 إلى 15 فدان - ري تنقيط",
  "أكثر من 15 فدان - تنقيط أو رش",
  "أرض جديدة تحت التجهيز",
  "أخرى (اكتب المساحة والري)",
  "رجوع لتعديل المحافظة",
  "القائمة الرئيسية",
];

const REG_CROPS_CHOICES: string[] = [
  "خضروات",
  "نباتات طبية وعطرية",
  "محاصيل حقلية وعلف",
  "أشجار فاكهة",
  "محاصيل متنوعة",
  "أخرى (اكتب المحاصيل)",
  "رجوع لتعديل المساحة والري",
  "القائمة الرئيسية",
];

const REG_SUPPORT_CHOICES: string[] = [
  "شامل (نصائح + تدريبات + متابعة)",
  "حضور تدريبات عملية للمزارعين",
  "نصائح وإرشاد زراعي حيوي",
  "تحويل الأرض للزراعة الحيوية",
  "أخرى (اكتب طلبك)",
  "رجوع لتعديل المحاصيل",
  "القائمة الرئيسية",
];

function buildCategoryPageResult(
  plantsDb: PlantDatabaseRecord[],
  category: string,
  page: number,
  submode: "problem" | "guide"
): InstantFlowTurnResult {
  const categoryPlants = plantsDb.filter((p) => p.category === category);
  const pageSize = 7;
  const totalPages = Math.max(1, Math.ceil(categoryPlants.length / pageSize));
  const safePage = ((page % totalPages) + totalPages) % totalPages;
  const slice = categoryPlants.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const replies: string[] = slice.map((p) => p.name);
  if (totalPages > 1 && safePage + 1 < totalPages) {
    replies.push("عرض باقي محاصيل القسم");
  } else if (totalPages > 1 && safePage > 0) {
    replies.push("الرجوع لأول القسم");
  }
  replies.push(OTHER_PLANT_OPTION_LABEL);
  replies.push("رجوع لأقسام المحاصيل");

  return makeInstantResult(
    `**${category}** — صفحة (${safePage + 1} من ${totalPages}):\nاختر المحصول من القائمة بالأسفل، أو **اكتب اسم المحصول مباشرة** في الرسالة:`,
    replies,
    {
      mode: "crop_flow",
      step: "select_plant_in_category",
      crop_submode: submode,
      category_filter: category,
      category_page: safePage,
    }
  );
}

function buildCropEntryScreen(submode: "problem" | "guide"): InstantFlowTurnResult {
  const intro =
    submode === "guide"
      ? "اختر **قسم المحصول** لعرض دليل زراعته من بيانات الجمعية (67 محصولاً)، أو **اكتب اسم المحصول مباشرة** في الرسالة:"
      : "اختر **قسم المحصول** الذي به المشكلة من الاختيارات بالأسفل، أو **اكتب اسم المحصول مباشرة** في الرسالة:";

  return makeInstantResult(
    intro,
    [
      ...CROP_CATEGORY_CHOICES.map((c) => c.label),
      OTHER_PLANT_OPTION_LABEL,
      "القائمة الرئيسية",
    ],
    {
      mode: "crop_flow",
      step: "select_crop_category",
      crop_submode: submode,
    }
  );
}

function buildSelectedPlantPrompt(
  plant: PlantDatabaseRecord,
  submode: "problem" | "guide"
): InstantFlowTurnResult {
  if (submode === "guide") {
    return makeInstantResult(
      `محصول **${plant.name}** (${plant.category}):\nاختر **المرحلة الزراعية** لعرض البيانات التفصيلية:`,
      getCropGuideStageChoices(plant.name),
      {
        mode: "crop_flow",
        step: "select_topic_or_symptom",
        crop_submode: "guide",
        selected_plant_id: plant.id,
        selected_plant_name: plant.name,
        is_other_plant: false,
      }
    );
  }

  return makeInstantResult(
    `محصول **${plant.name}** (${plant.category}):\nاختر **نوع المشكلة** من الاختيارات بالأسفل، أو **اكتب وصف الأعراض الظاهرة** مباشرة:`,
    getCropDiagnosticChoices(plant.name),
    {
      mode: "crop_flow",
      step: "select_topic_or_symptom",
      crop_submode: "problem",
      selected_plant_id: plant.id,
      selected_plant_name: plant.name,
      is_other_plant: false,
    }
  );
}

export function evaluateConversationalFlowTurn(params: {
  userMessage: string;
  currentFlow: SessionFlowState | undefined;
  plantsDb: PlantDatabaseRecord[];
  existingRegistrationsCount: number;
  sessionId: string;
  channel: "whatsapp" | "messenger" | "widget";
  hasPriorMessages?: boolean;
}): EvaluatedFlowTurn {
  const raw = params.userMessage.trim();
  const norm = normalizeArabicForMatch(raw);
  const flow: SessionFlowState = params.currentFlow || { mode: "idle" };

  // 1. Global Main Menu Reset at ANY step (no repeated greeting)
  if (isMainMenuResetCommand(norm)) {
    return makeInstantResult(
      "اختر الخدمة المطلوبة من القائمة بالأسفل، أو اكتب استفسارك مباشرة:",
      MAIN_MENU_SUGGESTIONS,
      { mode: "idle" }
    );
  }

  // 2. Global Top-Level Journey Triggers (when not inside registration input steps)
  if (isRegisterIntent(norm, raw) && flow.mode !== "register") {
    return makeInstantResult(
      "يسعدنا انضمامك لعضوية **الجمعية المصرية للزراعة الحيوية** للاستفادة من النصائح الزراعية والتدريبات العملية والدعم الفني.\n\n**الخطوة 1 من 6:** من فضلك اكتب **الاسم الثلاثي بالكامل**:",
      ["القائمة الرئيسية"],
      {
        mode: "register",
        step: "ask_name",
        draft_registration: {},
      }
    );
  }

  if (isAboutIntent(norm, raw) && flow.mode !== "register") {
    return makeInstantResult(
      "إحنا في **الجمعية المصرية للزراعة الحيوية** بنضم المزارعين للجمعية وبندعمهم خطوة بخطوة في الزراعة الحيوية والعضوية النقية 100% بدون أي كيماويات، من خلال:\n\n- **ضم المزارعين للجمعية:** تسجيل المزارعين وتكوين شبكة متعاونة من مزارعي الزراعة الحيوية في جميع محافظات مصر.\n- **تقديم النصائح والإرشاد الفني:** برامج خدمة وتسميد ومكافحة حيوية دقيقة لأكثر من **67 محصولاً** وأي محصول آخر.\n- **التدريبات العملية والميدانية:** تدريب المزارعين عملياً على تجهيز الكمبوست، التسميد الحيوي، والمكافحة الطبيعية لرفع الإنتاجية والجودة.\n\nاختر من الاختيارات التالية لمعرفة المزيد أو بدء التسجيل:",
      [
        "التدريبات العملية للمزارعين",
        "كيف يستفيد المزارع من الجمعية؟",
        "قواعد الزراعة الحيوية",
        "تسجيل في الجمعية",
        OTHER_GENERAL_OPTION_LABEL,
        "القائمة الرئيسية",
      ],
      { mode: "about" }
    );
  }

  if (
    normIn(norm, [
      "التدريبات العملية للمزارعين",
      "التدريبات والنصائح للمزارعين",
      "التدريبات والإرشاد للمزارعين",
    ]) &&
    flow.mode !== "register"
  ) {
    return makeInstantResult(
      "تقدم **الجمعية المصرية للزراعة الحيوية** منظومة تدريبات وإرشاد متكاملة للمزارعين المنضمين إليها:\n\n- **ورش وتدريبات حقلية عملية:** تدريب مباشر على تحضير الكمبوست المتحلل وشاي الكمبوست والبدائل الحيوية السليمة.\n- **برامج متابعة موسمية:** إرشاد فني من بداية تجهيز الأرض واختيار التقاوي وحتى الحصاد والتخزين.\n- **التشخيص المبكر للآفات:** تدريب المزارع على اكتشاف الإصابات الحشرية والفطرية مبكراً وعلاجها حيوياً بدون أي مبيدات كيماوية.\n\nيمكنك الانضمام والتسجيل معنا الآن للاستفادة من التدريبات والدعم الفني:",
      [
        "تسجيل في الجمعية",
        "كيف يستفيد المزارع من الجمعية؟",
        OTHER_GENERAL_OPTION_LABEL,
        "القائمة الرئيسية",
      ],
      { mode: "about" }
    );
  }

  if (normEq(norm, "كيف يستفيد المزارع من الجمعية؟") && flow.mode !== "register") {
    return makeInstantResult(
      "انضمام المزارع إلى **الجمعية المصرية للزراعة الحيوية** يحقق له فوائد مباشرة:\n\n- **تقليل تكلفة مستلزمات الإنتاج:** الاستغناء عن الأسمدة والمبيدات الكيماوية المكلفة بالاعتماد على البدائل الحيوية والكمبوست.\n- **استشارة فنية موثوقة:** الحصول على نصائح دقيقة لكل محصول حسب نوع التربة والمحافظة ونظام الري.\n- **تحسين خصوبة الأرض وجودة المحصول:** إنتاج محاصيل حيوية نقية عالية القيمة ومطلوبة للتصدير والسوق المحلي.\n\nابدأ رحلتك معنا الآن من خلال الاختيارات التالية:",
      [
        "تسجيل في الجمعية",
        "ترشيح أنسب محصول لأرضي",
        OTHER_GENERAL_OPTION_LABEL,
        "القائمة الرئيسية",
      ],
      { mode: "about" }
    );
  }

  if (
    normIn(norm, ["قواعد الزراعة الحيوية", "شروط الزراعة الحيوية"]) &&
    flow.mode !== "register"
  ) {
    return makeInstantResult(
      "تعتمد **الجمعية المصرية للزراعة الحيوية** معايير الزراعة الحيوية النقية 100%:\n\n- **منع الكيماويات نهائياً:** يحظر استخدام اليوريا أو النترات أو السوبر فوسفات الكيماوي أو أي مبيدات كيماوية مصنعة.\n- **التغذية الحيوية المتوازنة:** استخدام الكمبوست تام التحلل، شاي الكمبوست، صخر الفوسفات، صخر الفلسبار، الكبريت الزراعي، والأسمدة الحيوية.\n- **المكافحة الحيوية الآمنة:** استخدام زيت النيم، الصابون البوتاسي، باسيلس، وترايكوديرما والمصائد الفرمونية واللونية.\n\nاختر الخطوة التالية:",
      [
        "تسجيل في الجمعية",
        "ترشيح أنسب محصول لأرضي",
        OTHER_GENERAL_OPTION_LABEL,
        "القائمة الرئيسية",
      ],
      { mode: "about" }
    );
  }

  if (isCropProblemIntent(norm, raw) && flow.mode !== "register") {
    return buildCropEntryScreen("problem");
  }

  if (isCropGuideIntent(norm, raw) && flow.mode !== "register") {
    return buildCropEntryScreen("guide");
  }

  // Global "أخرى (سؤال آخر)" Trigger (when not inside registration or crop selection)
  if (
    isGeneralOtherIntent(norm, raw) &&
    flow.mode !== "register" &&
    flow.mode !== "crop_flow"
  ) {
    return makeInstantResult(
      "تفضل بكتابة **سؤالك أو اسم أي نبات أو استفسار زراعي** في رسالتك، وهنجاوبك فوراً بمعلومات **عضوية وحيوية (Organic 100%)** بأسلوب مبسط وعملي:",
      ["القائمة الرئيسية"],
      {
        mode: "general_ai",
        step: "open_organic_ai",
      }
    );
  }

  // Global Smart Crop Recommendation Trigger — breaks out of single-crop lock (e.g. Tomato) anytime!
  if (isSmartCropRecommendationIntent(norm, raw, params.plantsDb) && flow.mode !== "register") {
    const isMenuClick =
      raw.trim() === "4" ||
      normIn(norm, [
        "ترشيح أنسب محصول لأرضي",
        "ترشيح محصول لأرضي",
        "اختيار أنسب محصول",
        "أنسب محصول لأرضي",
      ]);

    return buildSmartAdvisorTurn({
      rawUserMessage: isMenuClick ? "عايز أعرف أنسب محصول لأرضي" : raw,
      prevNotes: [],
      prevTurnsAsked: 0,
      plantsDb: params.plantsDb,
    });
  }

  // =========================================================================
  // JOURNEY 6: OPEN ORGANIC AI ASSISTANT ("أخرى — أي سؤال أو نبات آخر")
  // =========================================================================
  if (flow.mode === "general_ai") {
    // Check if the user mentions one of the 67 CSV plants so we also enrich AI with the CSV data!
    const csvMatches = findMatchingPlants(raw, params.plantsDb, 2);
    const csvBlock =
      csvMatches.length > 0
        ? csvMatches
            .map(
              (p) =>
                `[بيانات محصول (${p.name}) من قاعدة بيانات الجمعية]:\n${p.full_reference_text}`
            )
            .join("\n\n---\n\n")
        : "";

    if (raw.length < 2 || !/[\p{L}]/u.test(raw)) {
      return makeInstantResult(
        "عذراً، يرجى كتابة سؤالك أو اسم النبات بشكل واضح بالحروف حتى نتمكن من إفادتك:",
        ["القائمة الرئيسية"],
        flow
      );
    }

    return {
      kind: "ai_with_db",
      matched_plants: csvMatches,
      focused_db_context: `[وضع الإجابة المفتوحة بالذكاء الاصطناعي (أخرى) — زراعة عضوية وحيوية 100% بأسلوب مبسط]:
${csvBlock ? `${csvBlock}\n\n` : ""}أجب على سؤال المزارع التالي بشكل مباشر ومبسط جداً في نقاط عملية واضحة يسهل تطبيقها في الحقل (نفس أسلوب بيانات الجمعية المبسطة للكمبوست والتسميد الحيوي والمكافحة العضوية للفدان)، مع الالتزام الصارم بأن تكون كل التوصيات **عضوية وحيوية (100% Organic)** بدون أي أسمدة أو مبيدات كيماوية نهائياً، وبدون كلمة "أهلاً بيك" في البداية.`,
      deterministic_fallback:
        "في الزراعة العضوية والحيوية (Organic 100%) بنعتمد بشكل مبسط على:\n\n- **تجهيز وتغذية التربة:** إضافة 10 إلى 15 م3 كمبوست تام التحلل للفدان مع صخر الفوسفات وصخر الفلسبار والكبريت الزراعي، والري بشاي الكمبوست والأسمدة الحيوية.\n- **الوقاية والمكافحة العضوية:** استخدام زيت النيم والصابون البوتاسي وباسيلس للحشرات، وترايكوديرما للوقاية من أعفان الجذور والذبول بدون أي كيماويات.",
      quick_replies: ["سؤال آخر", "ترشيح أنسب محصول لأرضي", "القائمة الرئيسية"],
      ui_mode: "whatsapp_buttons",
      next_flow_state: {
        mode: "general_ai",
        step: "open_organic_ai",
      },
    };
  }

  // =========================================================================
  // JOURNEY 5: SMART CONSULTATIVE CROP ADVISOR (MULTI-TURN NATURAL DIALOGUE)
  // =========================================================================
  if (flow.mode === "smart_advisor") {
    const prevNotes = flow.advisor_context?.accumulated_notes || [];
    const prevTurns = flow.advisor_context?.turns_asked || 0;

    // Check if the farmer now picks or mentions a specific CSV crop OR extra non-CSV crop
    const chosenPlant = findMatchingPlants(raw, params.plantsDb, 1)[0];
    if (chosenPlant && (flow.step === "advisor_followup" || prevNotes.length > 0)) {
      const farmerLandSummary = prevNotes.join(" — ");
      return {
        kind: "ai_with_db",
        matched_plants: [chosenPlant],
        active_crop_name: chosenPlant.name,
        focused_db_context: `[مواصفات أرض وظروف المزارع من الحوار السابق]:\n${farmerLandSummary}\n\n[بيانات محصول (${chosenPlant.name}) الرسمية من قاعدة بيانات الجمعية المصرية للزراعة الحيوية]:\n${chosenPlant.full_reference_text}\n\n[توجيه الرد الذكي]: اربط توصيات زراعة وخدمة وتسميد (${chosenPlant.name}) بمساحة وظروف أرض المزارع المذكورة أعلاه بأسلوب مبسط وعضوي 100% بدون أي تحية في بداية الرد، واختم بسؤال متابعة ذكي.`,
        deterministic_fallback: buildDeterministicPlantFallback(chosenPlant, raw),
        quick_replies: getPostAnswerCropChoices(chosenPlant.name, "guide").slice(0, 10),
        ui_mode: "whatsapp_list",
        next_flow_state: {
          mode: "crop_flow",
          step: "select_topic_or_symptom",
          crop_submode: "guide",
          selected_plant_id: chosenPlant.id,
          selected_plant_name: chosenPlant.name,
          is_other_plant: false,
        },
      };
    }

    const extraCropInAdvisor = detectExtraArabicCropName(raw, norm);
    if (extraCropInAdvisor && flow.step === "advisor_followup") {
      const farmerLandSummary = prevNotes.join(" — ");
      return {
        kind: "ai_with_db",
        matched_plants: [],
        active_crop_name: extraCropInAdvisor,
        focused_db_context: `[مواصفات أرض المزارع]: ${farmerLandSummary}\n[استفسار عن محصول (${extraCropInAdvisor})]: قدم خطة زراعة وخدمة وتسميد عضوي وحيوي (Organic 100%) مبسطة وعملية لمحصول (${extraCropInAdvisor}) تناسب أرض المزارع في نقاط واضحة للفدان بدون أي كيماويات وبدون تحية في البداية.`,
        deterministic_fallback: `بخصوص زراعة **${extraCropInAdvisor}** عضوياً:\n- **تجهيز الأرض:** إضافة 15 م3 كمبوست متحلل + 150 كجم صخر فوسفات + 50 كجم كبريت زراعي للفدان.\n- **التسميد والوقاية الحيوية:** التسميد بشاي الكمبوست والأسمدة الحيوية بانتظام، والرش الوقائي بزيت النيم وترايكوديرما بدون أي كيماويات.`,
        quick_replies: getPostAnswerCropChoices(extraCropInAdvisor, "guide").slice(0, 10),
        ui_mode: "whatsapp_list",
        next_flow_state: {
          mode: "crop_flow",
          step: "select_topic_or_symptom",
          crop_submode: "guide",
          selected_plant_name: extraCropInAdvisor,
          is_other_plant: true,
        },
      };
    }

    return buildSmartAdvisorTurn({
      rawUserMessage: raw,
      prevNotes,
      prevTurnsAsked: prevTurns,
      plantsDb: params.plantsDb,
    });
  }

  // =========================================================================
  // JOURNEY 1: STEP-BY-STEP FARMER REGISTRATION WITH VALIDATION, BACK & REVIEW
  // =========================================================================
  if (flow.mode === "register") {
    const draft = { ...(flow.draft_registration || {}) };
    const returnToReview = Boolean(flow.return_to_review);

    // --- Step 1: Full Name ---
    if (flow.step === "ask_name") {
      if (returnToReview && isBackCommand(norm)) {
        return buildRegistrationReviewPrompt(draft);
      }
      const nameCheck = validateFullName(raw);
      if (!nameCheck.valid || !nameCheck.cleaned) {
        return makeInstantResult(
          nameCheck.error ||
            "عذراً، يرجى كتابة **الاسم الثلاثي بالكامل** بشكل واضح (مثال: محمد أحمد علي):",
          returnToReview ? ["رجوع للمراجعة", "القائمة الرئيسية"] : ["القائمة الرئيسية"],
          flow
        );
      }

      draft.full_name = nameCheck.cleaned;
      if (returnToReview) {
        return buildRegistrationReviewPrompt(draft);
      }

      return makeInstantResult(
        `تشرفنا بحضرتك أ/ **${draft.full_name}**.\n\n**الخطوة 2 من 6:** من فضلك اكتب **رقم الموبايل / الواتساب** مكوناً من **11 رقماً** بالصيغة الصحيحة (مثال: \`01012345678\`):`,
        ["رجوع لتعديل الاسم", "القائمة الرئيسية"],
        {
          mode: "register",
          step: "ask_phone",
          draft_registration: draft,
        }
      );
    }

    // --- Step 2: Strict Phone Format & Validation ---
    if (flow.step === "ask_phone") {
      if (norm === "رجوع للمراجعه" && returnToReview) {
        return buildRegistrationReviewPrompt(draft);
      }
      if (isBackCommand(norm) || norm === "رجوع لتعديل الاسم") {
        return makeInstantResult(
          `**الخطوة 1 من 6:** من فضلك أعد كتابة **الاسم الثلاثي بالكامل**${
            draft.full_name ? ` (الاسم المسجل حالياً: ${draft.full_name})` : ""
          }:`,
          ["القائمة الرئيسية"],
          {
            mode: "register",
            step: "ask_name",
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      const phoneCheck = validateAndFormatEgyptianPhone(raw);
      if (!phoneCheck.valid || !phoneCheck.formatted) {
        return makeInstantResult(
          phoneCheck.errorMessage ||
            "عذراً، رقم التليفون غير مطابق للصيغة الصحيحة. يرجى كتابة رقم مكون من **11 رقماً** يبدأ بـ 010 أو 011 أو 012 أو 015 (مثال: `01012345678`):",
          returnToReview
            ? ["رجوع للمراجعة", "القائمة الرئيسية"]
            : ["رجوع لتعديل الاسم", "القائمة الرئيسية"],
          flow
        );
      }

      draft.phone = phoneCheck.formatted;
      draft.phone_e164 = phoneCheck.e164;

      if (returnToReview) {
        return buildRegistrationReviewPrompt(draft);
      }

      return makeInstantResult(
        `تم التحقق من رقم التليفون وحفظه بصيغة صحيحة (**${draft.phone}**).\n\n**الخطوة 3 من 6:** من فضلك **اكتب اسم المحافظة** مباشرة، أو اختر **الإقليم** من القائمة لعرض المحافظات الـ 27:`,
        getGovernorateRegionMenuReplies(),
        {
          mode: "register",
          step: "ask_location",
          draft_registration: draft,
        }
      );
    }

    // --- Step 3A: Governorate Selection (All 27 Governorates + Direct Typing + Typo Match) ---
    if (flow.step === "ask_location") {
      if (norm === "رجوع للمراجعه" && returnToReview) {
        return buildRegistrationReviewPrompt(draft);
      }
      if (
        norm === "رجوع لتعديل التليفون" ||
        norm === "رجوع لتعديل رقم التليفون" ||
        (isBackCommand(norm) && !flow.gov_region_id)
      ) {
        return makeInstantResult(
          `**الخطوة 2 من 6:** من فضلك أعد كتابة **رقم الموبايل / الواتساب** مكوناً من **11 رقماً** (الرقم الحالي: \`${
            draft.phone || "-"
          }\`):`,
          ["رجوع لتعديل الاسم", "القائمة الرئيسية"],
          {
            mode: "register",
            step: "ask_phone",
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      if (norm === "رجوع لاقاليم المحافظات" || (isBackCommand(norm) && flow.gov_region_id)) {
        return makeInstantResult(
          "**الخطوة 3 من 6:** اكتب اسم المحافظة مباشرة، أو اختر **الإقليم** لعرض محافظاته:",
          getGovernorateRegionMenuReplies(),
          {
            mode: "register",
            step: "ask_location",
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      // Check if user selected one of the 5 Governorate Region buttons
      const pickedRegion = GOVERNORATE_REGIONS.find(
        (r) => normalizeArabicForMatch(r.label) === norm
      );
      if (pickedRegion) {
        const regionGovs = EGYPT_GOVERNORATES.filter((g) => g.region_id === pickedRegion.id).map(
          (g) => g.name
        );
        return makeInstantResult(
          `**${pickedRegion.label}:**\nاختر المحافظة من القائمة بالأسفل، أو اكتب اسم المحافظة مباشرة:`,
          [...regionGovs, "رجوع لأقاليم المحافظات", "رجوع لتعديل التليفون"],
          {
            mode: "register",
            step: "ask_location",
            gov_region_id: pickedRegion.id,
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      // Match typed or clicked governorate against all 27 Egyptian governorates
      const govMatch = matchEgyptianGovernorate(raw);
      if (govMatch.status === "matched" && govMatch.governorate) {
        draft.governorate = govMatch.governorate;
        draft.location_detail = govMatch.detail;

        if (returnToReview) {
          return buildRegistrationReviewPrompt(draft);
        }

        const displayGov = draft.location_detail
          ? `${draft.governorate} (${draft.location_detail})`
          : draft.governorate;

        return makeInstantResult(
          `تم تسجيل المحافظة الرسمية: **${displayGov}**.\n\n**الخطوة 4 من 6:** اختر أو اكتب **مساحة الأرض ونظام الري**:`,
          REG_LAND_CHOICES,
          {
            mode: "register",
            step: "ask_land",
            draft_registration: draft,
          }
        );
      }

      if (govMatch.status === "fuzzy_confirm" && govMatch.suggestedGovernorate) {
        return makeInstantResult(
          `لضمان دقة تسجيل المحافظة في قاعدة بيانات الجمعية، هل تقصد محافظة **${govMatch.suggestedGovernorate}**؟`,
          [
            `نعم، ${govMatch.suggestedGovernorate}`,
            "إعادة اختيار المحافظة",
            "رجوع لتعديل التليفون",
          ],
          {
            mode: "register",
            step: "confirm_fuzzy_gov",
            pending_fuzzy_governorate: govMatch.suggestedGovernorate,
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      return makeInstantResult(
        "عذراً، لم نتمكن من التعرف على اسم المحافظة المدخل. يرجى إعادة كتابة اسم المحافظة المصرية بشكل واضح (مثال: البحيرة، المنيا، الشرقية، الفيوم)، أو اختيار الإقليم من القائمة بالأسفل:",
        getGovernorateRegionMenuReplies(),
        flow
      );
    }

    // --- Step 3B: Confirm Fuzzy Typo Governorate ---
    if (flow.step === "confirm_fuzzy_gov") {
      if (norm === "اعاده اختيار المحافظه" || norm === "لا") {
        return makeInstantResult(
          "من فضلك اكتب اسم المحافظة بشكل صحيح أو اختر الإقليم من القائمة بالأسفل:",
          getGovernorateRegionMenuReplies(),
          {
            mode: "register",
            step: "ask_location",
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }
      if (norm === "رجوع لتعديل التليفون" || isBackCommand(norm)) {
        return makeInstantResult(
          "**الخطوة 2 من 6:** من فضلك أعد كتابة **رقم الموبايل / الواتساب** مكوناً من **11 رقماً** (مثال: `01012345678`):",
          ["رجوع لتعديل الاسم", "القائمة الرئيسية"],
          {
            mode: "register",
            step: "ask_phone",
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      const confirmedGov =
        norm.startsWith("نعم") && flow.pending_fuzzy_governorate
          ? flow.pending_fuzzy_governorate
          : matchEgyptianGovernorate(raw).governorate;

      if (confirmedGov) {
        draft.governorate = confirmedGov;
        draft.location_detail = undefined;
        if (returnToReview) {
          return buildRegistrationReviewPrompt(draft);
        }
        return makeInstantResult(
          `تم تأكيد وتسجيل المحافظة الرسمية: **${confirmedGov}**.\n\n**الخطوة 4 من 6:** اختر أو اكتب **مساحة الأرض ونظام الري**:`,
          REG_LAND_CHOICES,
          {
            mode: "register",
            step: "ask_land",
            draft_registration: draft,
          }
        );
      }

      return makeInstantResult(
        "عذراً، لم نتمكن من تأكيد المحافظة. يرجى اختيار الإقليم من القائمة بالأسفل أو كتابة اسم المحافظة:",
        getGovernorateRegionMenuReplies(),
        {
          mode: "register",
          step: "ask_location",
          draft_registration: draft,
          return_to_review: returnToReview,
        }
      );
    }

    // --- Step 4: Land Area & Irrigation ---
    if (flow.step === "ask_land") {
      if (normEq(norm, "رجوع لتعديل المحافظة") || isBackCommand(norm)) {
        return makeInstantResult(
          `**الخطوة 3 من 6:** من فضلك اكتب اسم **المحافظة** أو اختر الإقليم من القائمة (المحافظة الحالية: ${
            draft.governorate || "-"
          }):`,
          getGovernorateRegionMenuReplies(),
          {
            mode: "register",
            step: "ask_location",
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      if (normIn(norm, ["أخرى (اكتب المساحة والري)", "أخرى", "اخري"])) {
        return makeInstantResult(
          "تفضل بكتابة **مساحة الأرض وطريقة الري** الخاصة بك بحرية في رسالة (مثال: 3 فدان صوب تنقيط، أو 18 قيراط ري بحاري):",
          ["رجوع لتعديل المحافظة", "القائمة الرئيسية"],
          flow
        );
      }

      if (raw.length < 2 || !/[\p{L}\d]/u.test(raw)) {
        return makeInstantResult(
          "عذراً، يرجى توضيح **مساحة الأرض ونظام الري** بشكل واضح أو الاختيار مباشرة من القائمة بالأسفل:",
          REG_LAND_CHOICES,
          flow
        );
      }

      draft.land_and_irrigation = raw;
      if (returnToReview) {
        return buildRegistrationReviewPrompt(draft);
      }

      return makeInstantResult(
        "**الخطوة 5 من 6:** ما هي أهم **المحاصيل أو النباتات** التي تزرعها حالياً أو ترغب في زراعتها مع الجمعية؟",
        REG_CROPS_CHOICES,
        {
          mode: "register",
          step: "ask_crops",
          draft_registration: draft,
        }
      );
    }

    // --- Step 5: Crops ---
    if (flow.step === "ask_crops") {
      if (normEq(norm, "رجوع لتعديل المساحة والري") || isBackCommand(norm)) {
        return makeInstantResult(
          "**الخطوة 4 من 6:** اختر أو أعد كتابة **مساحة الأرض ونظام الري**:",
          REG_LAND_CHOICES,
          {
            mode: "register",
            step: "ask_land",
            draft_registration: draft,
            return_to_review: returnToReview,
          }
        );
      }

      if (normIn(norm, ["أخرى (اكتب المحاصيل)", "أخرى", "اخري"])) {
        return makeInstantResult(
          "تفضل بكتابة **أسماء المحاصيل أو الأشجار** التي تزرعها أو ترغب في زراعتها:",
          ["رجوع لتعديل المساحة والري", "القائمة الرئيسية"],
          flow
        );
      }

      if (raw.length < 2 || !/[\p{L}]/u.test(raw)) {
        return makeInstantResult(
          "عذراً، يرجى كتابة اسم **المحاصيل** بشكل واضح أو الاختيار من القائمة بالأسفل:",
          REG_CROPS_CHOICES,
          flow
        );
      }

      draft.crops = raw;
      if (returnToReview) {
        return buildRegistrationReviewPrompt(draft);
      }

      return makeInstantResult(
        "**الخطوة 6 من 6:** ما هو **نوع الدعم أو التدريب** المطلوب من **الجمعية المصرية للزراعة الحيوية**؟",
        REG_SUPPORT_CHOICES,
        {
          mode: "register",
          step: "ask_support",
          draft_registration: draft,
        }
      );
    }

    // --- Step 6: Support & Training Needed ---
    if (flow.step === "ask_support") {
      if (normEq(norm, "رجوع لتعديل المحاصيل") || isBackCommand(norm)) {
        return makeInstantResult(
          "**الخطوة 5 من 6:** اختر أو أعد كتابة **المحاصيل المنزرعة أو المستهدفة**:",
          REG_CROPS_CHOICES,
          {
            mode: "register",
            step: "ask_crops",
            draft_registration: draft,
          }
        );
      }

      if (normIn(norm, ["أخرى (اكتب طلبك)", "أخرى", "اخري"])) {
        return makeInstantResult(
          "تفضل بكتابة **نوع الدعم أو الاستشارة أو التدريب** الذي تحتاجه من الجمعية:",
          ["رجوع لتعديل المحاصيل", "القائمة الرئيسية"],
          flow
        );
      }

      if (raw.length < 2 || !/[\p{L}]/u.test(raw)) {
        return makeInstantResult(
          "عذراً، يرجى اختيار **نوع الدعم أو التدريب** المطلوب من الاختيارات المتاحة بالأسفل:",
          REG_SUPPORT_CHOICES,
          flow
        );
      }

      draft.support_needed = raw;
      return buildRegistrationReviewPrompt(draft);
    }

    // --- Step 7: Review & Edit Any Field Before Saving ---
    if (flow.step === "review_registration") {
      if (norm === "تاكيد وارسال التسجيل" || norm === "تاكيد" || norm === "ارسال") {
        const regCode = `BIO-${1001 + params.existingRegistrationsCount}`;
        const canonicalGov = draft.governorate || "غير محدد";
        const fullLoc = draft.location_detail
          ? `${canonicalGov} - ${draft.location_detail}`
          : canonicalGov;

        const record: MemberRegistrationRecord = {
          registration_id: regCode,
          session_id: params.sessionId,
          channel: params.channel,
          full_name: draft.full_name || "عضو جديد",
          phone: draft.phone || "-",
          phone_e164: draft.phone_e164 || "",
          governorate: canonicalGov,
          location: fullLoc,
          land_and_irrigation: draft.land_and_irrigation || "-",
          crops: draft.crops || "-",
          support_needed: draft.support_needed || "شامل (نصائح + تدريبات + متابعة)",
          created_at: new Date().toISOString(),
        };

        return makeInstantResult(
          `تم تأكيد وتسجيل انضمامك بنجاح في **الجمعية المصرية للزراعة الحيوية** برقم عضوية متابعة **#${record.registration_id}**.\n\n**البيانات المسجلة:**\n- **الاسم:** ${record.full_name}\n- **رقم التليفون:** ${record.phone}\n- **المحافظة الرسمية:** ${record.governorate}${
            draft.location_detail ? ` (${draft.location_detail})` : ""
          }\n- **المساحة ونظام الري:** ${record.land_and_irrigation}\n- **المحاصيل:** ${
            record.crops
          }\n- **الدعم المطلوب:** ${record.support_needed}\n\nسيتواصل معك فريق الجمعية لضمك لبرامج النصائح الزراعية والتدريبات الميدانية. تقدر تختار من الخدمات بالأسفل لو محتاج استفسار آخر:`,
          [
            "هل توجد مشكلة في محصول؟",
            "دليل زراعة محصول كامل",
            "التدريبات العملية للمزارعين",
            "القائمة الرئيسية",
          ],
          { mode: "idle" },
          record
        );
      }

      if (norm === "تعديل رقم التليفون" || norm.includes("تعديل التليفون")) {
        return makeInstantResult(
          `اكتب **رقم الموبايل الجديد** مكوناً من **11 رقماً** (الرقم الحالي: \`${
            draft.phone || "-"
          }\`):`,
          ["رجوع للمراجعة", "القائمة الرئيسية"],
          {
            mode: "register",
            step: "ask_phone",
            draft_registration: draft,
            return_to_review: true,
          }
        );
      }

      if (norm === "تعديل المحافظه") {
        return makeInstantResult(
          `اكتب **اسم المحافظة** أو اختر الإقليم من القائمة (المحافظة الحالية: **${
            draft.governorate || "-"
          }**):`,
          getGovernorateRegionMenuReplies(),
          {
            mode: "register",
            step: "ask_location",
            draft_registration: draft,
            return_to_review: true,
          }
        );
      }

      if (norm === "تعديل الاسم") {
        return makeInstantResult(
          `اكتب **الاسم الثلاثي الصحيح** (الاسم الحالي: **${draft.full_name || "-"}**):`,
          ["رجوع للمراجعة", "القائمة الرئيسية"],
          {
            mode: "register",
            step: "ask_name",
            draft_registration: draft,
            return_to_review: true,
          }
        );
      }

      if (norm === "تعديل المساحه والري") {
        return makeInstantResult(
          "اختر أو اكتب **مساحة الأرض ونظام الري** الصحيح:",
          [
            "أقل من 5 فدان - ري غمر",
            "أقل من 5 فدان - ري تنقيط",
            "5 إلى 15 فدان - ري تنقيط",
            "أكثر من 15 فدان - تنقيط أو رش",
            "أرض جديدة تحت التجهيز",
            "القائمة الرئيسية",
          ],
          {
            mode: "register",
            step: "ask_land",
            draft_registration: draft,
            return_to_review: true,
          }
        );
      }

      if (norm === "تعديل المحاصيل") {
        return makeInstantResult(
          "اختر أو اكتب **المحاصيل** الصحيحة:",
          [
            "خضروات",
            "نباتات طبية وعطرية",
            "محاصيل حقلية وعلف",
            "أشجار فاكهة",
            "محاصيل متنوعة",
            "القائمة الرئيسية",
          ],
          {
            mode: "register",
            step: "ask_crops",
            draft_registration: draft,
            return_to_review: true,
          }
        );
      }

      return makeInstantResult(
        "عذراً، لم نتمكن من تحديد اختيارك. يرجى الضغط على **«تأكيد وإرسال التسجيل»** لحفظ بياناتك، أو اختيار البيان المطلوب تعديله من القائمة بالأسفل:",
        [
          "تأكيد وإرسال التسجيل",
          "تعديل رقم التليفون",
          "تعديل المحافظة",
          "تعديل الاسم",
          "تعديل المساحة والري",
          "تعديل المحاصيل",
          "القائمة الرئيسية",
        ],
        flow
      );
    }
  }

  // =========================================================================
  // JOURNEY 3 & 4: WHATSAPP-NATIVE CROP DIAGNOSTIC & CULTIVATION GUIDE FLOW
  // =========================================================================
  if (flow.mode === "crop_flow") {
    const submode: "problem" | "guide" = flow.crop_submode || "problem";

    // Handle category choice anywhere in crop_flow
    const pickedCategoryObj = CROP_CATEGORY_CHOICES.find(
      (c) => normalizeArabicForMatch(c.label) === norm || normalizeArabicForMatch(c.category) === norm
    );
    if (pickedCategoryObj) {
      return buildCategoryPageResult(params.plantsDb, pickedCategoryObj.category, 0, submode);
    }

    const isOtherPlantChoice =
      normIn(norm, [
        OTHER_PLANT_OPTION_LABEL,
        "نبات آخر",
        "محصول آخر غير موجود",
      ]) ||
      ((flow.step === "select_crop_category" || flow.step === "select_plant_in_category") &&
        normIn(norm, ["أخرى", "اخري"]));

    if (isOtherPlantChoice) {
      return makeInstantResult(
        "من فضلك اكتب **اسم أي نبات أو محصول** ترغب في الاستفسار عنه (حتى لو غير موجود بالقائمة)، وهنقدملك معلوماته **العضوية والحيوية (Organic 100%)** بأسلوب مبسط وعملي:",
        ["رجوع لأقسام المحاصيل", "القائمة الرئيسية"],
        {
          mode: "crop_flow",
          step: "enter_other_plant_name",
          crop_submode: submode,
          is_other_plant: true,
        }
      );
    }

    // Pagination inside a selected category (<= 10 WhatsApp list rows)
    if (flow.step === "select_plant_in_category" && flow.category_filter) {
      if (normEq(norm, "عرض باقي محاصيل القسم")) {
        return buildCategoryPageResult(
          params.plantsDb,
          flow.category_filter,
          (flow.category_page || 0) + 1,
          submode
        );
      }
      if (normEq(norm, "الرجوع لأول القسم")) {
        return buildCategoryPageResult(params.plantsDb, flow.category_filter, 0, submode);
      }
      if (isBackCommand(norm) || normEq(norm, "رجوع لأقسام المحاصيل")) {
        return buildCropEntryScreen(submode);
      }
    }

    // Confirm Fuzzy Plant Typo
    if (flow.step === "confirm_fuzzy_plant") {
      if (normEq(norm, "رجوع لأقسام المحاصيل") || isBackCommand(norm)) {
        return buildCropEntryScreen(submode);
      }
      const pendingPlant = flow.pending_fuzzy_plant_id
        ? params.plantsDb.find((p) => p.id === flow.pending_fuzzy_plant_id)
        : undefined;
      if (pendingPlant && norm.startsWith("نعم")) {
        return buildSelectedPlantPrompt(pendingPlant, submode);
      }
    }

    // Selecting a plant from category or typing its name directly (including non-CSV plants!)
    if (flow.step === "select_crop_category" || flow.step === "select_plant_in_category") {
      const matched = findMatchingPlants(raw, params.plantsDb, 1)[0];
      if (matched) {
        const wordCount = norm.split(" ").filter(Boolean).length;
        const normPlant = normalizeArabicForMatch(matched.name);
        const isJustPlantSelection =
          wordCount <= 4 ||
          norm === normPlant ||
          norm === normalizeArabicForMatch(matched.raw_name);

        if (isJustPlantSelection) {
          return buildSelectedPlantPrompt(matched, submode);
        }

        // User typed both the plant name AND their question in one message
        return {
          kind: "ai_with_db",
          matched_plants: [matched],
          active_crop_name: matched.name,
          focused_db_context: `[بيانات المحصول الرسمية من قاعدة بيانات الجمعية المصرية للزراعة الحيوية]:\n${matched.full_reference_text}`,
          deterministic_fallback: buildDeterministicPlantFallback(matched, raw),
          quick_replies: getPostAnswerCropChoices(matched.name, submode).slice(0, 10),
          ui_mode: "whatsapp_list",
          next_flow_state: {
            mode: "crop_flow",
            step: "select_topic_or_symptom",
            crop_submode: submode,
            selected_plant_id: matched.id,
            selected_plant_name: matched.name,
            is_other_plant: false,
          },
        };
      }

      // Check fuzzy typo plant match against the 67 CSV crops (e.g. "طماططم" or "الكموون")
      const fuzzyPlant = findFuzzyPlantSuggestion(raw, params.plantsDb);
      if (fuzzyPlant) {
        return makeInstantResult(
          `لم نجد تطابقاً حرفياً للاسم المكتوب، هل تقصد محصول **${fuzzyPlant.name}**؟`,
          [`نعم، ${fuzzyPlant.name}`, OTHER_PLANT_OPTION_LABEL, "رجوع لأقسام المحاصيل"],
          {
            mode: "crop_flow",
            step: "confirm_fuzzy_plant",
            crop_submode: submode,
            pending_fuzzy_plant_id: fuzzyPlant.id,
          }
        );
      }

      // Check if user directly typed a known extra crop (not in CSV, e.g. المانجو، الزيتون، البصل، الثوم...)
      const extraCrop = detectExtraArabicCropName(raw, norm);
      if (extraCrop) {
        if (norm.split(" ").filter(Boolean).length <= 2) {
          return buildCustomPlantPrompt(extraCrop, submode);
        }
        return {
          kind: "ai_with_db",
          matched_plants: [],
          active_crop_name: extraCrop,
          focused_db_context: `[استفسار عن محصول (${extraCrop}) غير الموجود بملف الـ CSV]: أجب عن (${raw}) بمعلومات زراعية **عضوية وحيوية (Organic 100%)** وبأسلوب مبسط وعملي جداً في نقاط واضحة للفدان مثل أسلوب بيانات الجمعية تماماً، بدون أي كيماويات وبدون تحية في البداية.`,
          deterministic_fallback: `بخصوص محصول **${extraCrop}** (زراعة عضوية 100%):\n- **تجهيز وتغذية الأرض:** إضافة 10–15 م3 كمبوست تام التحلل للفدان مع صخر الفوسفات والفلسبار والكبريت الزراعي، والري بشاي الكمبوست.\n- **الوقاية والمكافحة العضوية:** الرش الوقائي بزيت النيم والصابون البوتاسي للحشرات، وترايكوديرما للوقاية من أعفان الجذور والذبول.`,
          quick_replies: getPostAnswerCropChoices(extraCrop, submode).slice(0, 10),
          ui_mode: "whatsapp_list",
          next_flow_state: {
            mode: "crop_flow",
            step: "select_topic_or_symptom",
            crop_submode: submode,
            selected_plant_name: extraCrop,
            is_other_plant: true,
          },
        };
      }

      // If user wrote a full agricultural question while on category screen, answer with Organic AI directly!
      if (isMeaningfulAgriculturalQuery(raw, norm)) {
        return {
          kind: "ai_with_db",
          matched_plants: [],
          focused_db_context: `[استفسار زراعي مفتوح]: أجب على سؤال المزارع (${raw}) بمعلومات **عضوية وحيوية (Organic 100%)** وبأسلوب مبسط وعملي في نقاط واضحة للفدان بدون أي كيماويات وبدون تحية في البداية.`,
          deterministic_fallback:
            "في الزراعة العضوية والحيوية بنعتمد على الكمبوست تام التحلل وشاي الكمبوست والأسمدة الحيوية للتغذية، وزيت النيم والصابون البوتاسي وترايكوديرما للوقاية والمكافحة الآمنة بدون أي كيماويات.",
          quick_replies: [
            ...CROP_CATEGORY_CHOICES.map((c) => c.label),
            OTHER_PLANT_OPTION_LABEL,
            "القائمة الرئيسية",
          ],
          ui_mode: "whatsapp_list",
          next_flow_state: flow,
        };
      }

      // Professional message when user writes unrecognized text while selecting a crop
      return makeInstantResult(
        "عذراً، لم نتمكن من التعرف على اسم المحصول المدخل. يرجى إعادة كتابة اسم المحصول بشكل واضح، أو اختيار **قسم المحصول** من الاختيارات بالأسفل، أو اختيار **«أخرى (نبات غير موجود)»**:",
        [
          ...CROP_CATEGORY_CHOICES.map((c) => c.label),
          OTHER_PLANT_OPTION_LABEL,
          "القائمة الرئيسية",
        ],
        {
          mode: "crop_flow",
          step: "select_crop_category",
          crop_submode: submode,
        }
      );
    }

    // Entering custom "Other" plant name — accepts ANY plant name and answers via 100% Organic Simplified AI!
    if (flow.step === "enter_other_plant_name") {
      if (isBackCommand(norm) || normEq(norm, "رجوع لأقسام المحاصيل")) {
        return buildCropEntryScreen(submode);
      }

      const matched = findMatchingPlants(raw, params.plantsDb, 1)[0];
      if (matched) {
        return buildSelectedPlantPrompt(matched, submode);
      }

      if (raw.length < 2 || !/[\p{L}]/u.test(raw)) {
        return makeInstantResult(
          "عذراً، يرجى كتابة **اسم النبات أو المحصول** بالحروف بشكل واضح (مثال: المانجو، الزيتون، البصل، الزعتر):",
          ["رجوع لأقسام المحاصيل", "القائمة الرئيسية"],
          flow
        );
      }

      // If user wrote a full sentence/question (more than 4 words), answer immediately via Organic AI!
      if (raw.split(/\s+/).length > 4) {
        return {
          kind: "ai_with_db",
          matched_plants: [],
          active_crop_name: raw,
          focused_db_context: `[استفسار عن نبات خارج ملف البيانات]: أجب على (${raw}) بمعلومات زراعية **عضوية وحيوية (Organic 100%)** وبأسلوب مبسط وعملي جداً في نقاط واضحة للفدان مثل أسلوب بيانات الجمعية تماماً، بدون أي كيماويات وبدون تحية في البداية.`,
          deterministic_fallback:
            "في الزراعة العضوية والحيوية (Organic 100%) بننصح بتجهيز الأرض بالكمبوست تام التحلل (10–15 م3 للفدان) وصخر الفوسفات والكبريت الزراعي، والتسميد بشاي الكمبوست، والوقاية الحيوية بزيت النيم والصابون البوتاسي وترايكوديرما.",
          quick_replies: ["سؤال آخر", "اختيار محصول آخر", "القائمة الرئيسية"],
          ui_mode: "whatsapp_buttons",
          next_flow_state: {
            mode: "general_ai",
            step: "open_organic_ai",
          },
        };
      }

      return buildCustomPlantPrompt(raw, submode);
    }

    // Answering diagnostic / cultivation stage / "أخرى" questions for the active plant (CSV or Custom!)
    if (flow.step === "select_topic_or_symptom") {
      if (isBackCommand(norm)) {
        return buildCropEntryScreen(submode);
      }

      const activeDisplayName = flow.selected_plant_name || "المحصول";

      // Handle clicking "أخرى (سؤال آخر عن المحصول)" or "أخرى" inside a selected plant!
      if (
        normIn(norm, [
          OTHER_CROP_TOPIC_LABEL,
          "أخرى",
          "اخري",
          "سؤال آخر",
          "استفسار آخر",
        ])
      ) {
        return makeInstantResult(
          `تفضل بكتابة **سؤالك أو المشكلة الموجودة في محصول ${activeDisplayName}** بكلماتك، وهنجاوبك فوراً بتوصيات **عضوية وحيوية (Organic 100%)** مبسطة وعملية:`,
          ["اختيار محصول آخر", "القائمة الرئيسية"],
          flow
        );
      }

      const newlyMentioned = findMatchingPlants(raw, params.plantsDb, 1)[0];
      const currentPlant = flow.selected_plant_id
        ? params.plantsDb.find((p) => p.id === flow.selected_plant_id)
        : undefined;

      // Switch to newly typed CSV plant if user only wrote another plant's name
      if (
        newlyMentioned &&
        (!currentPlant || newlyMentioned.id !== currentPlant.id) &&
        norm.split(" ").filter(Boolean).length <= 2
      ) {
        return buildSelectedPlantPrompt(newlyMentioned, submode);
      }

      // Switch to newly typed extra non-CSV plant if user only wrote another plant's name (e.g. "المانجو")
      const newlyExtraCrop = !newlyMentioned ? detectExtraArabicCropName(raw, norm) : null;
      if (
        newlyExtraCrop &&
        norm.split(" ").filter(Boolean).length <= 2 &&
        normalizeArabicForMatch(newlyExtraCrop) !== normalizeArabicForMatch(activeDisplayName)
      ) {
        return buildCustomPlantPrompt(newlyExtraCrop, submode);
      }

      const activePlant =
        newlyMentioned && (!currentPlant || newlyMentioned.id !== currentPlant.id)
          ? newlyMentioned
          : currentPlant;

      if (activePlant) {
        // Switch from problem mode into full stage-by-stage guide for this plant
        if (raw.startsWith("دليل زراعة ")) {
          return buildSelectedPlantPrompt(activePlant, "guide");
        }

        let instantSection = "";

        // Structured Problem Diagnosis Buttons (Direct natural answers from CSV data when column is populated; otherwise falls through to simplified Organic AI!)
        if (normEq(norm, "إصابة حشرية في المحصول") && activePlant.pest_and_disease_control) {
          instantSection = `**الوقاية والمكافحة الحيوية للإصابات الحشرية والآفات في ${activePlant.name}:**\n\n${activePlant.pest_and_disease_control}\n\n*لو ظاهر عندك عرض معين على الورق أو الساق، قولي عمر النبات ومكان الإصابة وهشخصهولك بدقة.*`;
        } else if (normEq(norm, "إصابة فطرية أو أعفان") && activePlant.pest_and_disease_control) {
          instantSection = `**الوقاية والمكافحة الحيوية للأمراض الفطرية والأعفان في ${activePlant.name}:**\n\n${activePlant.pest_and_disease_control}\n\n*قولي برضه هل الأعراض في الجذور ولا على الأوراق، وطريقة الري عندك إيه عشان نحدد السبب بدقة.*`;
        } else if (normEq(norm, "ضعف نمو أو تسميد حيوي") && activePlant.fertilization) {
          instantSection = `**برنامج التسميد العضوي والحيوي لمحصول ${activePlant.name}:**\n\n${activePlant.fertilization}${
            activePlant.agricultural_practices
              ? `\n\n**تجهيز وخدمة الأرض:**\n${activePlant.agricultural_practices}`
              : ""
          }`;
        } else if (
          normEq(norm, "مشكلة في الري أو الملوحة") &&
          (activePlant.irrigation || activePlant.environment)
        ) {
          instantSection = `${
            activePlant.irrigation
              ? `**نظام الري والملوحة لمحصول ${activePlant.name}:**\n${activePlant.irrigation}\n\n`
              : ""
          }${
            activePlant.environment
              ? `**التربة والاحتياجات البيئية:**\n${activePlant.environment}`
              : ""
          }`.trim();
        } else if (normEq(norm, "مشكلة حشائش في الأرض") && activePlant.pest_and_disease_control) {
          instantSection = `نعتمد في مقاومة الحشائش على **العزيق الميكانيكي واليدوي، الري الكاذب قبل الزراعة، والتغطية الحيوية (الملش)** بدون أي مبيدات حشائش كيماوية.\n\n**الوقاية والمكافحة لمحصول ${activePlant.name}:**\n${activePlant.pest_and_disease_control}`;
        }

        // Structured 7-Stage Cultivation Guide Buttons
        else if (raw.startsWith("1. التربة والمناخ") && activePlant.environment) {
          instantSection = `**المرحلة 1 — التربة والمناخ المناسب لمحصول ${activePlant.name}:**\n\n${activePlant.environment}${
            activePlant.importance ? `\n\n**الأهمية الاقتصادية:**\n${activePlant.importance}` : ""
          }`;
        } else if (raw.startsWith("2. التقاوي وميعاد") && activePlant.seeds_and_nursery) {
          instantSection = `**المرحلة 2 — التقاوي والشتلات ومواعيد زراعة ${activePlant.name}:**\n\n${activePlant.seeds_and_nursery}`;
        } else if (raw.startsWith("3. تجهيز الأرض") && activePlant.agricultural_practices) {
          instantSection = `**المرحلة 3 — تجهيز الأرض والممارسات الزراعية لمحصول ${activePlant.name}:**\n\n${activePlant.agricultural_practices}`;
        } else if (raw.startsWith("4. برنامج الري") && activePlant.irrigation) {
          instantSection = `**المرحلة 4 — نظام الري والملوحة لمحصول ${activePlant.name}:**\n\n${activePlant.irrigation}`;
        } else if (raw.startsWith("5. برنامج التسميد") && activePlant.fertilization) {
          instantSection = `**المرحلة 5 — برنامج التسميد العضوي والحيوي لمحصول ${activePlant.name}:**\n\n${activePlant.fertilization}`;
        } else if (raw.startsWith("6. الوقاية والمكافحة") && activePlant.pest_and_disease_control) {
          instantSection = `**المرحلة 6 — الوقاية والمكافحة الحيوية لمحصول ${activePlant.name}:**\n\n${activePlant.pest_and_disease_control}`;
        } else if (
          raw.startsWith("7. الحصاد والتخزين") &&
          (activePlant.harvest || activePlant.post_harvest)
        ) {
          instantSection = `**المرحلة 7 — الحصاد والإنتاجية والتخزين لمحصول ${activePlant.name}:**\n\n${
            activePlant.harvest ? `${activePlant.harvest}\n\n` : ""
          }${
            activePlant.post_harvest ? `**معاملات ما بعد الحصاد:**\n${activePlant.post_harvest}` : ""
          }`.trim();
        }

        if (instantSection) {
          return makeInstantResult(
            instantSection,
            getPostAnswerCropChoices(activePlant.name, submode),
            {
              mode: "crop_flow",
              step: "select_topic_or_symptom",
              crop_submode: submode,
              selected_plant_id: activePlant.id,
              selected_plant_name: activePlant.name,
              is_other_plant: false,
            }
          );
        }

        const isKnownStageOrDiagBtn =
          /^[1-7]\.\s/.test(raw) ||
          normIn(norm, [
            "إصابة حشرية في المحصول",
            "إصابة فطرية أو أعفان",
            "ضعف نمو أو تسميد حيوي",
            "مشكلة في الري أو الملوحة",
            "مشكلة حشائش في الأرض",
          ]);

        // Check if user wrote unclear / gibberish text inside crop flow
        if (!isKnownStageOrDiagBtn && !isMeaningfulAgriculturalQuery(raw, norm) && raw.split(/\s+/).length < 2) {
          return makeInstantResult(
            `عذراً، لم نتمكن من فهم الاستفسار المكتوب بخصوص محصول **${activePlant.name}** بشكل واضح. يرجى كتابة سؤالك بجملة واضحة، أو الاختيار من القائمة بالأسفل:`,
            getPostAnswerCropChoices(activePlant.name, submode),
            flow
          );
        }

        return {
          kind: "ai_with_db",
          matched_plants: [activePlant],
          active_crop_name: activePlant.name,
          focused_db_context: `[السياق الحالي للمحادثة]: المحصول المحدد هو (${activePlant.name}).
- اعتمد أولاً على البيانات الرسمية المرفقة أدناه؛ وإذا كانت النقطة التي يسأل عنها المزارع غير مذكورة في الملف المرفق، **أكملها فوراً من خبرتك بالذكاء الاصطناعي بشرط أن تكون عضوية وحيوية (Organic 100%) وبنفس الأسلوب المبسط والعملي للنقاط الموجودة في بيانات الجمعية** (كميات للفدان، خطوات واضحة وبسيطة بدون مصطلحات معقدة وبدون أي كيماويات).
- إذا انتقل المزارع لسؤال عام لا يخص (${activePlant.name}) فأجب على سؤاله الجديد مباشرة بذكاء وبساطة.

[بيانات محصول (${activePlant.name}) الرسمية من قاعدة بيانات الجمعية المصرية للزراعة الحيوية]:
${activePlant.full_reference_text}`,
          deterministic_fallback: buildDeterministicPlantFallback(activePlant, raw),
          quick_replies: getPostAnswerCropChoices(activePlant.name, submode).slice(0, 10),
          ui_mode: "whatsapp_list",
          next_flow_state: {
            mode: "crop_flow",
            step: "select_topic_or_symptom",
            crop_submode: submode,
            selected_plant_id: activePlant.id,
            selected_plant_name: activePlant.name,
            is_other_plant: false,
          },
        };
      }

      // Custom "Other" crop not in CSV — full support for Guide Mode, Problem Mode, and any open question via 100% Organic Simplified AI!
      const customCrop = flow.selected_plant_name || "المحصول";
      if (raw.startsWith("دليل زراعة ")) {
        return buildCustomPlantPrompt(customCrop, "guide");
      }

      const isStructuredCustomBtn =
        /^[1-7]\.\s/.test(raw) ||
        normIn(norm, [
          "إصابة حشرية في المحصول",
          "إصابة فطرية أو أعفان",
          "ضعف نمو أو تسميد حيوي",
          "مشكلة في الري أو الملوحة",
          "مشكلة حشائش في الأرض",
        ]);

      if (!isStructuredCustomBtn && !isMeaningfulAgriculturalQuery(raw, norm) && raw.split(/\s+/).length < 2) {
        return makeInstantResult(
          `عذراً، لم نتمكن من فهم السؤال المكتوب بخصوص محصول **${customCrop}** بشكل واضح. يرجى كتابة سؤالك بجملة واضحة أو اختيار الموضوع من القائمة بالأسفل:`,
          getPostAnswerCropChoices(customCrop, submode),
          flow
        );
      }

      return {
        kind: "ai_with_db",
        matched_plants: [],
        active_crop_name: customCrop,
        focused_db_context: `[محصول خارج ملف البيانات — (${customCrop})]:
المزارع يستفسر عن: "${raw}" بخصوص محصول (${customCrop}).
قدم الإجابة من الذكاء الاصطناعي فوراً مع الالتزام الصارم بـ:
1. **زراعة عضوية وحيوية (Organic 100%) فقط** بدون أي أسمدة أو مبيدات كيماوية نهائياً.
2. **أسلوب مبسط وعملي جداً في نقاط واضحة للفدان** يشبه تماماً أسلوب بيانات الجمعية المصرية للزراعة الحيوية (أرقام واضحة للكمبوست، صخر الفوسفات، الفلسبار، الكبريت الزراعي، شاي الكمبوست، زيت النيم، الصابون البوتاسي، باسيلس، ترايكوديرما حسب موضوع السؤال) بدون كلام معقد وبدون تحية في البداية.`,
        deterministic_fallback: `بخصوص محصول **${customCrop}** (توصيات عضوية وحيوية 100%):\n\n- **تجهيز وتغذية الأرض:** بننصح بإضافة 10–15 م3 كمبوست تام التحلل للفدان عند التجهيز مع 150 كجم صخر فوسفات و50 كجم كبريت زراعي، والتسميد الدوري بشاي الكمبوست والأسمدة الحيوية السائلة.\n- **الوقاية والمكافحة العضوية:** نستخدم زيت النيم والصابون البوتاسي وباسيلس للحشرات واليرقات، وترايكوديرما للوقاية من أعفان الجذور والذبول، مع انتظام الري والعزيق اليدوي للحشائش بدون أي كيماويات.`,
        quick_replies: getPostAnswerCropChoices(customCrop, submode).slice(0, 10),
        ui_mode: "whatsapp_list",
        next_flow_state: {
          mode: "crop_flow",
          step: "select_topic_or_symptom",
          crop_submode: submode,
          selected_plant_name: customCrop,
          is_other_plant: true,
        },
      };
    }
  }

  // =========================================================================
  // IDLE / ABOUT / GENERAL CONVERSATION WITH ORGANIC AI & PROFESSIONAL FALLBACK
  // =========================================================================
  if (isPureGreeting(norm)) {
    const replyText = params.hasPriorMessages
      ? "تفضل باختيار الخدمة المطلوبة من القائمة بالأسفل أو اكتب سؤالك مباشرة:"
      : "أهلاً وسهلاً بيك في **الجمعية المصرية للزراعة الحيوية**، نقدر نساعدك إزاي؟";
    return makeInstantResult(replyText, MAIN_MENU_SUGGESTIONS, { mode: "idle" });
  }

  // Check if user directly mentioned any of the 67 CSV crops in free text
  const matchedPlants = findMatchingPlants(raw, params.plantsDb, 2);
  if (matchedPlants.length > 0) {
    const primary = matchedPlants[0];
    if (norm.split(" ").filter(Boolean).length <= 2) {
      return buildSelectedPlantPrompt(primary, "problem");
    }

    const combinedContext = matchedPlants
      .map(
        (p) =>
          `[بيانات محصول (${p.name}) من قاعدة بيانات الجمعية المصرية للزراعة الحيوية]:\n${p.full_reference_text}`
      )
      .join("\n\n---\n\n");

    return {
      kind: "ai_with_db",
      matched_plants: matchedPlants,
      active_crop_name: primary.name,
      focused_db_context: `${combinedContext}\n\n[توجيه]: اعتمد على بيانات المحصول أعلاه، وإذا كان السؤال عن نقطة غير مذكورة في الملف فأكملها من الذكاء الاصطناعي بمعلومات عضوية وحيوية (Organic 100%) وبأسلوب مبسط وواضح بدون تعقيد.`,
      deterministic_fallback: buildDeterministicPlantFallback(primary, raw),
      quick_replies: getPostAnswerCropChoices(primary.name, "problem").slice(0, 10),
      ui_mode: "whatsapp_list",
      next_flow_state: {
        mode: "crop_flow",
        step: "select_topic_or_symptom",
        crop_submode: "problem",
        selected_plant_id: primary.id,
        selected_plant_name: primary.name,
        is_other_plant: false,
      },
    };
  }

  // Check if user typed a slightly misspelled CSV plant name in idle mode (e.g. "طماططم" or "كموون")
  const idleFuzzyPlant = findFuzzyPlantSuggestion(raw, params.plantsDb);
  if (idleFuzzyPlant) {
    return makeInstantResult(
      `هل تقصد الاستفسار عن محصول **${idleFuzzyPlant.name}**؟`,
      [`نعم، ${idleFuzzyPlant.name}`, OTHER_PLANT_OPTION_LABEL, "القائمة الرئيسية"],
      {
        mode: "crop_flow",
        step: "confirm_fuzzy_plant",
        crop_submode: "problem",
        pending_fuzzy_plant_id: idleFuzzyPlant.id,
      }
    );
  }

  // Check if user directly mentioned a known non-CSV crop in idle mode (e.g. "المانجو", "عندي مشكلة في البصل")
  const idleExtraCrop = detectExtraArabicCropName(raw, norm);
  if (idleExtraCrop) {
    if (norm.split(" ").filter(Boolean).length <= 2) {
      return buildCustomPlantPrompt(idleExtraCrop, "problem");
    }
    return {
      kind: "ai_with_db",
      matched_plants: [],
      active_crop_name: idleExtraCrop,
      focused_db_context: `[استفسار عن محصول (${idleExtraCrop}) خارج ملف البيانات]: أجب على (${raw}) بمعلومات زراعية **عضوية وحيوية (Organic 100%)** وبأسلوب مبسط وعملي في نقاط واضحة للفدان مثل أسلوب بيانات الجمعية تماماً، بدون أي كيماويات وبدون تحية في البداية.`,
      deterministic_fallback: `بخصوص محصول **${idleExtraCrop}** (زراعة عضوية 100%):\n- **تجهيز وتغذية الأرض:** إضافة 10–15 م3 كمبوست تام التحلل للفدان مع صخر الفوسفات والفلسبار والكبريت الزراعي، والري بشاي الكمبوست.\n- **الوقاية والمكافحة العضوية:** الرش الوقائي بزيت النيم والصابون البوتاسي للحشرات، وترايكوديرما للوقاية من أعفان الجذور والذبول.`,
      quick_replies: getPostAnswerCropChoices(idleExtraCrop, "problem").slice(0, 10),
      ui_mode: "whatsapp_list",
      next_flow_state: {
        mode: "crop_flow",
        step: "select_topic_or_symptom",
        crop_submode: "problem",
        selected_plant_name: idleExtraCrop,
        is_other_plant: true,
      },
    };
  }

  // Professional unclear-input response if user wrote gibberish / wrong / non-agricultural text
  if (!isMeaningfulAgriculturalQuery(raw, norm)) {
    return makeInstantResult(
      "عذراً، لم نتمكن من فهم رسالتك بشكل واضح. يرجى إعادة كتابة استفسارك بوضوح، أو الاختيار مباشرة من خدمات **الجمعية المصرية للزراعة الحيوية** بالأسفل (أو اختيار **«أخرى»** لأي سؤال مفتوح):",
      MAIN_MENU_SUGGESTIONS,
      { mode: "idle" }
    );
  }

  // Meaningful general organic/biodynamic farming question -> answer from AI in simple 100% organic style!
  return {
    kind: "ai_with_db",
    matched_plants: [],
    focused_db_context: `[سؤال زراعي عام]: أجب على سؤال المزارع (${raw}) من الذكاء الاصطناعي بمعلومات **عضوية وحيوية (Organic 100%)** وبأسلوب مبسط وعملي جداً في نقاط واضحة يسهل على المزارع فهمها وتطبيقها (مثل أسلوب بيانات الجمعية تماماً)، بدون أي كيماويات وبدون تحية في البداية.`,
    deterministic_fallback:
      "في الزراعة العضوية والحيوية بنعتمد على الكمبوست تام التحلل وشاي الكمبوست وصخر الفوسفات والفلسبار للتغذية، وزيت النيم والصابون البوتاسي وباسيلس وترايكوديرما للوقاية والمكافحة الطبيعية بدون أي كيماويات.",
    quick_replies: MAIN_MENU_SUGGESTIONS,
    ui_mode: inferWhatsAppUiMode(MAIN_MENU_SUGGESTIONS),
    next_flow_state: { mode: "idle" },
  };
}
