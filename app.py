"""AgriPulse (EBDA & Economy of Love) — Production FastAPI + Gradio Unified App for Hugging Face Spaces."""
from __future__ import annotations

import asyncio
import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import mimetypes
import os
import re
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import gradio as gr
import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from google import genai
from google.genai import types
from PIL import Image
import uvicorn

# ---------------------------------------------------------------------------
# Logging & Environment Configuration
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("agripulse")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
META_VERIFY_TOKEN = (
    os.environ.get("META_VERIFY_TOKEN")
    or os.environ.get("WHATSAPP_VERIFY_TOKEN")
    or os.environ.get("MESSENGER_VERIFY_TOKEN")
    or "agripulse_meta_verify_2026"
).strip()
WHATSAPP_TOKEN = (
    os.environ.get("WHATSAPP_TOKEN")
    or os.environ.get("WHATSAPP_ACCESS_TOKEN")
    or ""
).strip()
WHATSAPP_PHONE_ID = (
    os.environ.get("WHATSAPP_PHONE_ID")
    or os.environ.get("WHATSAPP_PHONE_NUMBER_ID")
    or ""
).strip()
PAGE_ACCESS_TOKEN = (
    os.environ.get("PAGE_ACCESS_TOKEN")
    or os.environ.get("MESSENGER_PAGE_ACCESS_TOKEN")
    or ""
).strip()
META_APP_SECRET = os.environ.get("META_APP_SECRET", "").strip()

CANDIDATE_GEMINI_MODELS = list(
    dict.fromkeys([GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"])
)

# ---------------------------------------------------------------------------
# Official Persona & System Instructions (100% Organic & Biodynamic Only)
# ---------------------------------------------------------------------------
ADVISOR_SYSTEM_INSTRUCTION = """أنت المستشار الزراعي الذكي والحساب الرسمي لـ **الجمعية المصرية للزراعة الحيوية (EBDA)** (تأسست عام 1990 ومسجلة بوزارة التضامن الاجتماعي المصرية، وتدير علامة **ديميتر DEMETER** ومعيار شهادة **اقتصاد المحبة Economy of Love - EoL** بالتعاون مع المشروع الألماني-المصري **SI/EoL** الممول من **BMZ** وتنفيذ **bbw gGmbH** و**sequa gGmbH**).

قواعد أساسية صارمة لا استثناء فيها:
1. لغات المحادثة المتعددة (العربية · English · Deutsch):
   - تحدث بنفس اللغة المحددة للمستخدم في الجلسة:
     • **العربية**: اكتب بـ **اللهجة المصرية الزراعية المبسطة والواضحة والمحترمة** بصيغة الجمع المؤسسية ("بننصح بـ"، "بنوصي بـ"، "بنستخدم").
     • **English**: Respond in clear, professional, actionable English adhering to organic & Demeter standards.
     • **Deutsch**: Antworten Sie auf verständlichem, präzisem Deutsch im Einklang mit den BMZ / bbw / sequa / Demeter Richtlinien.
2. استدعاء المعارف الزراعية الخارجية الكاملة:
   - إذا سأل المستخدم عن أي محصول غير موجود في قاعدة البيانات المحلية أو طرح سؤالاً زراعياً مفتوحاً، استدعِ خبرتك الزراعية فوراً وقدم إجابة متكاملة وعملية بنسبة **100% زراعة عضوية وحيوية (Organic & Biodynamic)** بمعدلات الفدان، ولا تعتذر أبداً.
3. ممنوع تماماً تكرار الترحيب في الردود أو استخدام ألقاب شعبية:
   - الترحيب يظهر مرة واحدة فقط عند فتح المحادثة.
   - ممنوع بدء أي رد بـ "أهلاً بيك" أو "مرحباً"، وممنوع استخدام ألقاب مثل "يا بطل"، "يا هندسة"، "يا ريس"، "يا غالي"، "يا فندم"، "يا حاج". ادخل في الإجابة مباشرة.
4. المحاور السبعة المعتمدة (بشكل عام أو لأي محصول محدد):
   1) الاحتياجات البيئية (نوع التربة، الإضاءة، الحرارة، الرطوبة).
   2) البذور والشتلات وتحضير الأرض وممارسات الزراعة.
   3) الري (طرق الري وتكلفتها، الاحتياجات المائية، الملوحة ومصادر وتحاليل المياه).
   4) التسميد العضوي والحيوي (الكمبوست، الأسمدة السائلة الحيوية، وأماكن شراء المدخلات المعتمدة مثل EBDA ومزارع سيكم ومنافذ مركز البحوث الزراعية ARC).
   5) المكافحة الحيوية (الآفات والأمراض، المصائد والأعداء الطبيعية، وإدارة الحشائش بدون مبيدات).
   6) الحصاد (طرق ومواعيد الحصاد).
   7) معاملات ما بعد الحصاد والتسويق وشهادات اقتصاد المحبة EoL وديميتر والكربون.
5. ممنوع الكيماويات نهائياً وباتاً — زراعة عضوية وحيوية (Organic & Biodynamic 100%) فقط:
   - يُحظر نهائياً التوصية بأي سماد كيماوي (يوريا، نترات، سلفات نشادر، NPK كيماوي، سوبر فوسفات كيماوي، داب، ماب) أو أي مبيد حشري أو فطري أو حشائش كيماوي أو تبخير بالفوسفين.
   - اعتمد حصرياً على البدائل العضوية والحيوية (الكمبوست تام التحلل، الفيرمي كمبوست، شاي الكمبوست، صخر الفوسفات، الفلسبار، الكبريت الزراعي الميكروني، مستحضرات BD 500/501، زيت النيم، الصابون البوتاسي، باسيلس Bt، ترايكوديرما، كروت الترايكوجراما، الدياتوميت، المصائد، الري الكاذب، الملش، والعزيق اليدوي).
6. تخصيص التنسيق حسب القناة:
   - في **واتساب (whatsapp)**: خط عريض بنجمة واحدة (*عنوان*) وعلامة • للنقاط، بدون ** أو #.
   - في **فيسبوك ماسنجر (messenger)**: نص عربي صافي بدون أي نجوم ** أو * أو #، وعناوين بـ ▪ ونقاط بـ •.
   - في **الموقع / واجهة الاختبار (widget)**: عناوين فرعية بارزة (**عنوان:**) ونقاط عملية واضحة.
7. فحص وتشخيص صور النباتات والمحاصيل (Vision AI) بالعامية المصرية:
   - حدد اسم النبات أو الشيء المصور، شخص الحالة بدقة مع العلامات البصرية في الصورة، وقدم خطة علاج ووقاية عضوية 100% بمعدلات دقيقة بدون أي كيماويات. وإذا كانت الصورة غير واضحة أو غير زراعية اشرح بلطف كيفية التصوير بوضوح في ضوء الشمس."""

# ---------------------------------------------------------------------------
# Channel Labels, Formatting, & Smart Chunk Splitting
# ---------------------------------------------------------------------------
OTHER_GENERAL_OPTION_LABEL = "أخرى (سؤال آخر)"
OTHER_PLANT_OPTION_LABEL = "أخرى (نبات غير موجود)"
OTHER_CROP_TOPIC_LABEL = "أخرى (سؤال آخر عن المحصول)"

LANGUAGE_OPTIONS = [
    "🇪🇬 العربية (Arabic)",
    "🇬🇧 English",
    "🇩🇪 Deutsch (German)",
]

LANGUAGE_SELECTION_PROMPT = (
    "🌿 **الجمعية المصرية للزراعة الحيوية (EBDA)** & **Economy of Love**\n"
    "German-Egyptian Project (BMZ · bbw gGmbH · sequa gGmbH)\n\n"
    "من فضلك اختر لغة المحادثة:\n"
    "Please select your preferred language:\n"
    "Bitte wählen Sie Ihre Sprache:"
)

MAIN_MENU_SUGGESTIONS_AR = [
    "تسجيل في الجمعية (EBDA)",
    "عن الجمعية واقتصاد المحبة",
    "موضوعات الزراعة العضوية",
    "الأسئلة الشائعة (FAQs)",
    "هل توجد مشكلة في محصول؟",
    "ترشيح أنسب محصول لأرضي",
    "دليل زراعة محصول كامل",
    OTHER_GENERAL_OPTION_LABEL,
    "🌐 تغيير اللغة (Language)",
]

MAIN_MENU_SUGGESTIONS_EN = [
    "Register with EBDA",
    "About EBDA & Economy of Love",
    "Organic Farming Topics",
    "Frequently Asked Questions (FAQs)",
    "Crop Problem or Pest Control",
    "Recommend Best Crop for My Land",
    "Complete Organic Crop Guide",
    "Ask Any Question (Other)",
    "🌐 Change Language / تغيير اللغة",
]

MAIN_MENU_SUGGESTIONS_DE = [
    "Registrierung bei EBDA",
    "Über EBDA & Economy of Love",
    "Themen des Ökolandbaus",
    "Häufig gestellte Fragen (FAQs)",
    "Pflanzenproblem & Schädlingsbekämpfung",
    "Geeignete Kulturpflanze empfehlen",
    "Vollständiger Bio-Anbauleitfaden",
    "Offene Frage stellen (Andere)",
    "🌐 Sprache ändern / Change Language",
]

CHOICE_SHORT_MAP_20: dict[str, str] = {
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
    "3. الري والاحتياجات المائية والملوحة": "3. الري والملوحة",
    "4. التسميد والكمبوست وأماكن الشراء": "4. التسميد الحيوي",
    "5. المكافحة الحيوية والحشائش": "5. المكافحة الحيوية",
    "6. الحصاد (الطرق والمواعيد)": "6. طرق الحصاد",
    "7. معاملات ما بعد الحصاد والتسويق": "7. ما بعد الحصاد",
    "تأكيد وإرسال التسجيل": "تأكيد التسجيل",
    "رجوع لتعديل المساحة والري": "تعديل المساحة",
    "رجوع لتعديل التليفون": "تعديل التليفون",
    "رجوع لتعديل المحافظة": "تعديل المحافظة",
    "رجوع لتعديل المحاصيل": "تعديل المحاصيل",
    "رجوع لأقاليم المحافظات": "أقاليم المحافظات",
    "إعادة اختيار المحافظة": "تغيير المحافظة",
    "أقل من 5 فدان - ري غمر": "أقل من 5ف (غمر)",
    "أقل من 5 فدان - ري تنقيط": "أقل من 5ف (تنقيط)",
    "5 إلى 15 فدان - ري تنقيط": "5-15 فدان (تنقيط)",
    "أكثر من 15 فدان - تنقيط أو رش": "أكثر من 15 فدان",
    "أرض جديدة تحت التجهيز": "أرض تحت التجهيز",
    "أخرى (اكتب المساحة والري)": "أخرى (اكتب المساحة)",
    "شامل (نصائح + تدريبات + متابعة)": "دعم وتدريب شامل",
    "حضور تدريبات عملية للمزارعين": "تدريبات عملية",
    "نصائح وإرشاد زراعي حيوي": "إرشاد زراعي حيوي",
    "تحويل الأرض للزراعة الحيوية": "تحويل للحيوية",
}

CHOICE_SHORT_MAP_24: dict[str, str] = {
    "عن الجمعية واقتصاد المحبة": "عن الجمعية والمحبة",
    "أخرى (سؤال آخر عن المحصول)": "سؤال آخر عن المحصول",
    "إرشادات عامة للزراعة العضوية": "إرشادات عضوية عامة",
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
    "3. الري والاحتياجات المائية والملوحة": "3. الري والملوحة والمياه",
    "4. التسميد والكمبوست وأماكن الشراء": "4. التسميد والكمبوست",
    "5. المكافحة الحيوية والحشائش": "5. المكافحة والحشائش",
    "7. معاملات ما بعد الحصاد والتسويق": "7. ما بعد الحصاد والتسويق",
    "أكثر من 15 فدان - تنقيط أو رش": "أكثر من 15ف تنقيط/رش",
    "شامل (نصائح + تدريبات + متابعة)": "شامل (نصائح وتدريبات)",
}


def get_language_menu_suggestions(lang: str = "ar") -> list[str]:
    if lang == "en":
        return list(MAIN_MENU_SUGGESTIONS_EN)
    if lang == "de":
        return list(MAIN_MENU_SUGGESTIONS_DE)
    return list(MAIN_MENU_SUGGESTIONS_AR)


def get_choice_icon(label: str) -> str:
    clean = (label or "").strip().lower()
    if not clean:
        return "🌱"
    if clean[0] in ("🇪", "🇬", "🇩", "🌐", "📷"):
        return clean[0]
    if "رئيسية" in clean or "main menu" in clean or "hauptmenü" in clean:
        return "🏠"
    if "رجوع" in clean or "back" in clean or "zurück" in clean:
        return "↩️"
    if "تعديل" in clean:
        return "✏️"
    if "تأكيد" in clean or clean.startswith("نعم"):
        return "✅"
    if "تسجيل" in clean or "register" in clean or "registrierung" in clean:
        return "📝"
    if "موضوعات" in clean or "topics" in clean or "themen" in clean:
        return "📚"
    if "أسئلة" in clean or "faq" in clean or "fragen" in clean:
        return "❓"
    if "مشكلة" in clean or "إصابة" in clean or "problem" in clean:
        return "🔍"
    if "ترشيح" in clean or "recommend" in clean or "empfehlen" in clean:
        return "🧭"
    if "دليل" in clean or "guide" in clean or "leitfaden" in clean:
        return "📖"
    if "صورة" in clean or "photo" in clean or "foto" in clean:
        return "📷"
    if "أخرى" in clean or "other" in clean or "andere" in clean:
        return "💬"
    return "🌱"


def shorten_choice_title(raw_label: str, max_len: int = 20) -> str:
    clean = re.sub(r"\s+", " ", (raw_label or "")).strip()
    if len(clean) <= max_len:
        return clean
    if max_len <= 20 and clean in CHOICE_SHORT_MAP_20 and len(CHOICE_SHORT_MAP_20[clean]) <= max_len:
        return CHOICE_SHORT_MAP_20[clean]
    if max_len <= 24 and clean in CHOICE_SHORT_MAP_24 and len(CHOICE_SHORT_MAP_24[clean]) <= max_len:
        return CHOICE_SHORT_MAP_24[clean]
    if clean in CHOICE_SHORT_MAP_20 and len(CHOICE_SHORT_MAP_20[clean]) <= max_len:
        return CHOICE_SHORT_MAP_20[clean]

    without_parens = re.sub(r"\s*\([^)]*\)", "", clean).strip()
    if 4 <= len(without_parens) <= max_len:
        return without_parens
    src = without_parens if len(without_parens) >= 4 else clean
    if len(src) <= max_len:
        return src

    budget = max(4, max_len - 1)
    piece = src[: budget + 1]
    last_space = piece.rfind(" ")
    if last_space >= int(max_len * 0.45):
        return piece[:last_space].rstrip("،,:.-؟?") + "…"
    return src[:budget].strip() + "…"


def ensure_unique_short_titles(labels: list[str], max_len: int, with_icon: bool = True) -> list[str]:
    used: set[str] = set()
    out: list[str] = []
    for idx, label in enumerate(labels):
        if with_icon:
            icon = get_choice_icon(label)
            short = f"{icon} {shorten_choice_title(label, max(4, max_len - 2))}"
        else:
            short = shorten_choice_title(label, max_len)
        short = short[:max_len].strip()
        if short in used:
            suffix = f" {idx + 1}"
            short = short[: max(2, max_len - len(suffix))].strip() + suffix
        used.add(short)
        out.append(short)
    return out


def format_message_for_channel(raw_text: str, channel: str = "widget") -> str:
    """Apply channel-specific Markdown conversion WITHOUT stripping content."""
    trimmed = (raw_text or "").strip()
    if not trimmed or trimmed == "تفضل بكتابة سؤالك":
        return trimmed

    if channel == "whatsapp":
        wa = re.sub(r"\s*\([A-Za-z][A-Za-z0-9\s/&.,-]{2,34}\)", "", trimmed)
        wa = re.sub(r"^[ \t]*#{1,6}[ \t]+(.+)$", r"*\1*", wa, flags=re.MULTILINE)
        wa = re.sub(r"^[ \t]*[-*][ \t]+", "• ", wa, flags=re.MULTILINE)
        wa = re.sub(r"\*\*([^*\n]+)\*\*", r"*\1*", wa)
        wa = re.sub(r"`([^`\n]+)`", r"\1", wa)
        wa = re.sub(r"\*{2,}", "*", wa)
        wa = re.sub(r"\n{3,}", "\n\n", wa).strip()
        return wa

    if channel == "messenger":
        fb = re.sub(r"^[ \t]*#{1,6}[ \t]+(.+)$", r"▪ \1", trimmed, flags=re.MULTILINE)
        fb = re.sub(r"^[ \t]*\*\*([^*\n]+)\*\*(:?)[ \t]*$", r"▪ \1\2", fb, flags=re.MULTILINE)
        fb = re.sub(r"^[ \t]*[-*][ \t]+\*\*([^*\n]+)\*\*", r"• \1", fb, flags=re.MULTILINE)
        fb = re.sub(r"^[ \t]*[-*][ \t]+", "• ", fb, flags=re.MULTILINE)
        fb = re.sub(r"\*\*([^*\n]+)\*\*", r"\1", fb)
        fb = re.sub(r"\*([^*\n]+)\*", r"\1", fb)
        fb = re.sub(r"`([^`\n]+)`", r"\1", fb)
        fb = re.sub(r"\n{3,}", "\n\n", fb).strip()
        return fb

    return re.sub(r"\n{3,}", "\n\n", trimmed).strip()


def split_message_chunks(text: str, max_chars: int) -> list[str]:
    """Split long replies safely across WhatsApp (3800) or Messenger (1900) limits without losing dosages."""
    clean = (text or "").strip()
    if not clean:
        return []
    if len(clean) <= max_chars:
        return [clean]

    chunks: list[str] = []
    remaining = clean
    while remaining:
        if len(remaining) <= max_chars:
            chunks.append(remaining.strip())
            break
        window = remaining[:max_chars]
        split_at = window.rfind("\n\n")
        if split_at < int(max_chars * 0.45):
            split_at = window.rfind("\n")
        if split_at < int(max_chars * 0.45):
            for punct in (". ", "، ", "؛ "):
                idx = window.rfind(punct)
                if idx >= int(max_chars * 0.45):
                    split_at = idx + 1
                    break
        if split_at < int(max_chars * 0.4):
            space_idx = window.rfind(" ")
            split_at = space_idx if space_idx > 40 else max_chars

        part = remaining[:split_at].strip()
        if part.count("*") % 2 == 1:
            part += "*"
        chunks.append(part)
        remaining = remaining[split_at:].strip()
    return [c for c in chunks if c]


# ---------------------------------------------------------------------------
# Arabic Normalization, Phone Validation, & 27 Egyptian Governorates
# ---------------------------------------------------------------------------
ARABIC_DIGITS_MAP = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_arabic_digits(text: str) -> str:
    return (text or "").translate(ARABIC_DIGITS_MAP)


def normalize_arabic_for_match(text: str) -> str:
    s = normalize_arabic_digits(text).lower()
    s = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", s)
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
    s = re.sub(r"(.)\1{2,}", r"\1", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def strip_al_prefix(norm_text: str) -> str:
    return " ".join(w[2:] if len(w) >= 4 and w.startswith("ال") else w for w in norm_text.split()).strip()


def norm_eq(norm_input: str, raw_target: str) -> bool:
    return norm_input == normalize_arabic_for_match(raw_target)


def norm_in(norm_input: str, raw_targets: list[str]) -> bool:
    return any(norm_input == normalize_arabic_for_match(t) for t in raw_targets)


def norm_has(norm_input: str, raw_sub: str) -> bool:
    sub = normalize_arabic_for_match(raw_sub)
    return bool(sub) and sub in norm_input


def levenshtein_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


def validate_egyptian_phone(raw_input: str) -> dict[str, Any]:
    ascii_txt = normalize_arabic_digits(raw_input).strip()
    if any(ch.isalpha() for ch in ascii_txt):
        return {
            "valid": False,
            "error": "عذراً، يحتوي رقم التليفون على حروف. يرجى كتابة رقم الموبايل بالأرقام فقط مكوناً من **11 رقماً** (مثال: `01012345678`):",
        }
    cleaned = re.sub(r"[\s\-().]", "", ascii_txt)
    if cleaned.startswith("+20"):
        cleaned = "0" + cleaned[3:]
    elif cleaned.startswith("0020"):
        cleaned = "0" + cleaned[4:]
    elif len(cleaned) == 12 and cleaned.startswith("201"):
        cleaned = "0" + cleaned[2:]

    if not cleaned.isdigit():
        return {
            "valid": False,
            "error": "عذراً، الصيغة المدخلة غير صحيحة. يرجى كتابة رقم الموبايل مكوناً من **11 رقماً** (مثال: `01012345678`):",
        }
    if len(cleaned) != 11:
        return {
            "valid": False,
            "error": f"عذراً، عدد أرقام التليفون غير صحيح (أدخلت **{len(cleaned)}** أرقام). يجب أن يتكون رقم الموبايل المصري من **11 رقماً** بالضبط (مثال: `01012345678`):",
        }
    if not re.match(r"^01[0125]\d{8}$", cleaned):
        return {
            "valid": False,
            "error": "عذراً، يجب أن يبدأ رقم الموبايل المصري بـ **010** أو **011** أو **012** أو **015** ويليه 8 أرقام (مثال: `01012345678`):",
        }
    if re.match(r"^01[0125](\d)\1{7}$", cleaned):
        return {
            "valid": False,
            "error": "عذراً، يبدو أن الرقم المدخل غير حقيقي. يرجى كتابة رقم الموبايل الفعلي لسهولة تواصل فريق الجمعية معك (مثال: `01012345678`):",
        }
    return {"valid": True, "formatted": cleaned, "e164": f"+2{cleaned}"}


GOVERNORATE_REGIONS = [
    {"id": "delta", "label": "محافظات الدلتا والوجه البحري"},
    {"id": "cairo_alex", "label": "القاهرة الكبرى والإسكندرية"},
    {"id": "north_upper", "label": "محافظات شمال ووسط الصعيد"},
    {"id": "south_upper", "label": "محافظات جنوب الصعيد"},
    {"id": "canal_frontier", "label": "مدن القناة وسيناء والحدودية"},
]

EGYPT_GOVERNORATES: list[dict[str, Any]] = [
    {"id": "beheira", "name": "البحيرة", "region_id": "delta", "aliases": ["بحيره", "دمنهور", "النوباريه", "النوبارية", "وادي النطرون", "ابو المطامير", "كفر الدوار", "حوش عيسي", "الدلنجات", "كوم حماده", "ايتاي البارود", "رشيد", "ادكو", "مركز بدر", "التحرير"]},
    {"id": "dakahlia", "name": "الدقهلية", "region_id": "delta", "aliases": ["دقهليه", "المنصوره", "ميت غمر", "السنبلاوين", "بلقاس", "دكرنس", "طلخا", "شربين", "اجا", "المنزله", "جمصه"]},
    {"id": "sharqia", "name": "الشرقية", "region_id": "delta", "aliases": ["شرقيه", "الزقازيق", "بلبيس", "فاقوس", "منيا القمح", "ابو حماد", "الحسينيه", "الصالحيه", "العاشر من رمضان", "ههيا", "كفر صقر"]},
    {"id": "gharbia", "name": "الغربية", "region_id": "delta", "aliases": ["غربيه", "طنطا", "المحله", "المحله الكبري", "زفتي", "كفر الزيات", "السنطه", "بسيون", "قطور", "سمنود"]},
    {"id": "monufia", "name": "المنوفية", "region_id": "delta", "aliases": ["منوفيه", "شبين الكوم", "السادات", "مدينه السادات", "منوف", "اشمون", "قويسنا", "الباجور", "تلا", "بركه السبع", "الشهداء"]},
    {"id": "kafr_el_sheikh", "name": "كفر الشيخ", "region_id": "delta", "aliases": ["كفرالشيخ", "كفر شيخ", "دسوق", "بلطيم", "الحامول", "بيلا", "سيدي سالم", "فوه", "مطوبس", "قلين"]},
    {"id": "damietta", "name": "دمياط", "region_id": "delta", "aliases": ["دمياط الجديده", "فارسكور", "كفر سعد", "الزرقا", "كفر البطيخ"]},
    {"id": "cairo", "name": "القاهرة", "region_id": "cairo_alex", "aliases": ["قاهره", "حلوان", "مدينه نصر", "المعادي", "التجمع", "الشروق", "cairo"]},
    {"id": "giza", "name": "الجيزة", "region_id": "cairo_alex", "aliases": ["جيزه", "الواحات البحريه", "البدرشين", "الصف", "العياط", "اطفيح", "ابو النمرس", "كرداسه", "اكتوبر", "6 اكتوبر", "الشيخ زايد", "ابو غالب", "giza"]},
    {"id": "qalyubia", "name": "القليوبية", "region_id": "cairo_alex", "aliases": ["قليوبيه", "قلوبيه", "بنها", "طوخ", "قليوب", "القناطر الخيريه", "شبين القناطر", "كفر شكر", "الخانكه", "شبرا الخيمه", "العبور"]},
    {"id": "alexandria", "name": "الإسكندرية", "region_id": "cairo_alex", "aliases": ["اسكندريه", "اسكندريا", "برج العرب", "العامريه", "النهضه", "مريوط", "alex", "alexandria"]},
    {"id": "faiyum", "name": "الفيوم", "region_id": "north_upper", "aliases": ["فيوم", "اطسا", "طاميه", "سنورس", "ابشواي", "يوسف الصديق"]},
    {"id": "beni_suef", "name": "بني سويف", "region_id": "north_upper", "aliases": ["بنيسويف", "بنسويف", "الواسطي", "ناصر", "اهناسيا", "ببا", "سمسطا", "الفشن"]},
    {"id": "minya", "name": "المنيا", "region_id": "north_upper", "aliases": ["منيا", "المنيه", "المينا", "ملوي", "سمالوط", "مغاغه", "بني مزار", "مطاي", "ابو قرقاص", "ديرمواس", "العدوه", "غرب المنيا"]},
    {"id": "asyut", "name": "أسيوط", "region_id": "north_upper", "aliases": ["اسيوط", "اسوط", "ديروط", "القوصيه", "منفلوط", "ابوتيج", "ابو تيج", "الفتح", "ابنوب", "البداري", "ساحل سليم", "صدفا"]},
    {"id": "sohag", "name": "سوهاج", "region_id": "south_upper", "aliases": ["سهاج", "سوهاق", "طما", "طهطا", "المراغه", "اخميم", "جرجا", "البلينا", "المنشاه", "دار السلام", "جهينه", "ساقلته"]},
    {"id": "qena", "name": "قنا", "region_id": "south_upper", "aliases": ["قنه", "نجع حمادي", "دشنا", "قوص", "نقاده", "ابو تشت", "فرشوط", "قفط", "الوقف"]},
    {"id": "luxor", "name": "الأقصر", "region_id": "south_upper", "aliases": ["اقصر", "لقصر", "اسنا", "ارمنت", "القرنه", "البياضيه", "الطود", "الزينيه", "luxor"]},
    {"id": "aswan", "name": "أسوان", "region_id": "south_upper", "aliases": ["اسوان", "اصوان", "كوم امبو", "ادفو", "دراو", "نصر النوبه", "توشكي", "وادي النقره", "aswan"]},
    {"id": "ismailia", "name": "الإسماعيلية", "region_id": "canal_frontier", "aliases": ["اسماعيليه", "اسمعليه", "القنطره", "القنطره شرق", "القنطره غرب", "فايد", "التل الكبير", "القصاصين", "ابو صوير"]},
    {"id": "suez", "name": "السويس", "region_id": "canal_frontier", "aliases": ["سويس", "الجناين", "حي الجناين"]},
    {"id": "port_said", "name": "بورسعيد", "region_id": "canal_frontier", "aliases": ["بور سعيد", "بورفؤاد", "سهل الطينه"]},
    {"id": "matrouh", "name": "مطروح", "region_id": "canal_frontier", "aliases": ["مرسي مطروح", "الحمام", "العلمين", "الضبعه", "سيدي براني", "السلوم", "سيوه", "واحه سيوه", "مغره"]},
    {"id": "new_valley", "name": "الوادي الجديد", "region_id": "canal_frontier", "aliases": ["وادي جديد", "الوادي", "الخارجه", "الداخله", "الفرافره", "باريس", "بلاط", "شرق العوينات", "العوينات"]},
    {"id": "red_sea", "name": "البحر الأحمر", "region_id": "canal_frontier", "aliases": ["بحر احمر", "الغردقه", "سفاجا", "القصير", "مرسي علم", "راس غارب", "الشلاتين"]},
    {"id": "north_sinai", "name": "شمال سيناء", "region_id": "canal_frontier", "aliases": ["شمال سينا", "العريش", "بئر العبد", "بير العبد", "الشيخ زويد", "رفح", "الحسنه", "نخل"]},
    {"id": "south_sinai", "name": "جنوب سيناء", "region_id": "canal_frontier", "aliases": ["جنوب سينا", "الطور", "طور سيناء", "شرم الشيخ", "دهب", "نويبع", "راس سدر", "سانت كاترين", "طابا"]},
]


def match_egyptian_governorate(raw_input: str) -> dict[str, Any]:
    cleaned_raw = re.sub(r"^نعم[،,\s]+", "", re.sub(r"^محافظ[ةه]\s+", "", raw_input.strip())).strip()
    norm = normalize_arabic_for_match(cleaned_raw)
    if len(norm) < 2:
        return {"status": "not_found"}
    stripped = strip_al_prefix(norm)
    padded_norm = f" {norm} "
    padded_stripped = f" {stripped} "

    for gov in EGYPT_GOVERNORATES:
        ng = normalize_arabic_for_match(gov["name"])
        sg = strip_al_prefix(ng)
        if norm == ng or stripped == sg:
            return {"status": "matched", "governorate": gov["name"]}
        if f" {ng} " in padded_norm or f" {sg} " in padded_stripped:
            rem = cleaned_raw.replace(gov["name"], "").strip(" -،,/")
            res: dict[str, Any] = {"status": "matched", "governorate": gov["name"]}
            if len(rem) >= 2:
                res["detail"] = rem
            return res

    for gov in EGYPT_GOVERNORATES:
        sg = strip_al_prefix(normalize_arabic_for_match(gov["name"]))
        for alias in gov["aliases"]:
            na = normalize_arabic_for_match(alias)
            sa = strip_al_prefix(na)
            if norm == na or stripped == sa or f" {na} " in padded_norm or (len(sa) >= 4 and f" {sa} " in padded_stripped):
                is_spelling = levenshtein_distance(sa, sg) <= 2 or sg in na
                res = {"status": "matched", "governorate": gov["name"]}
                if not is_spelling:
                    res["detail"] = cleaned_raw
                return res

    best_gov = None
    best_dist = 99
    words = [w for w in stripped.split() if len(w) >= 3]
    for gov in EGYPT_GOVERNORATES:
        cands = [
            normalize_arabic_for_match(gov["name"]),
            strip_al_prefix(normalize_arabic_for_match(gov["name"])),
            *[strip_al_prefix(normalize_arabic_for_match(a)) for a in gov["aliases"][:4]],
        ]
        for cand in cands:
            if not cand:
                continue
            max_allowed = 2 if len(cand) >= 6 else 1
            for probe in [stripped, *words]:
                d = levenshtein_distance(probe, cand)
                if d <= max_allowed and d < best_dist:
                    best_dist = d
                    best_gov = gov
    if best_gov:
        return {"status": "fuzzy_confirm", "suggested": best_gov["name"]}
    return {"status": "not_found"}


# ---------------------------------------------------------------------------
# 7 ToR Organic Topics & 11 Official FAQs
# ---------------------------------------------------------------------------
TOR_SEVEN_TOPICS: list[dict[str, str]] = [
    {
        "id": "env",
        "buttonLabel": "1. الاحتياجات البيئية",
        "shortTitle": "الاحتياجات البيئية (التربة · الإضاءة · الحرارة · الرطوبة)",
        "generalGuideArabic": (
            "**1. الاحتياجات البيئية في الزراعة العضوية والحيوية (بشكل عام):**\n\n"
            "- **نوع التربة:** تنجح الزراعة العضوية في الأراضي الطينية والطميية والصفراء والرملية المستصلحة بشرط بناء خصوبة التربة بإضافة 15–20 م³ كمبوست تام التحلل للفدان وتحسين الصرف.\n"
            "- **الإضاءة:** معظم المحاصيل تحتاج 6–10 ساعات شمس مباشرة يومياً لرفع كفاءة التمثيل الضوئي والزيوت العطرية.\n"
            "- **الحرارة:** المحاصيل الشتوية تجود في 15–22°م (كالقمح والفول والبابونج)، والصيفية في 25–35°م (كالذرة والسمسم والكركديه). عند موجات الحر أو الصقيع يُرش مستخلص الطحالب البحرية والسليكات الطبيعية.\n"
            "- **الرطوبة:** تجنب تغريق الأرض ووسّع مسافات الزراعة للتهوية الجيدة للوقاية من أعفان الجذور والبياض."
        ),
    },
    {
        "id": "seeds",
        "buttonLabel": "2. البذور والزراعة وتجهيز الأرض",
        "shortTitle": "البذور والتقاوي والشتلات وتجهيز الأرض وممارسات الزراعة",
        "generalGuideArabic": (
            "**2. البذور والشتلات وتحضير الأرض وممارسات الزراعة:**\n\n"
            "- **التقاوي والشتلات:** تقاوي نظيفة غير معاملة كيماوياً. تربية الشتلات في صواني فوم (بيتموس + فيرميكيوليت + 20% فيرمي كمبوست + ترايكوديرما) وتُشتل آخر النهار.\n"
            "- **تحضير الأرض للفدان:** حرث سكتين متعامدتين وتشميس، ثم إضافة الخدمة العضوية: **15–20 م³ كمبوست تام التحلل + 150–300 كجم صخر فوسفات طبيعي + 150–250 كجم فلسبار بوتاسي + 50–100 كجم كبريت زراعي ميكروني** وتخميرها بالري.\n"
            "- **ممارسات الزراعة:** تطبيق الدورة الزراعية بعد البقوليات وزراعة سياج عازل حول المزرعة."
        ),
    },
    {
        "id": "irrigation",
        "buttonLabel": "3. الري والاحتياجات المائية والملوحة",
        "shortTitle": "الري (طرق الري وتكلفتها · الاحتياجات المائية · الملوحة)",
        "generalGuideArabic": (
            "**3. الري والاحتياجات المائية والملوحة عضوياً:**\n\n"
            "- **طرق الري وتكلفتها التقريبية للفدان:** التنقيط الأنسب عضوياً (يوفر 35–45% مياه ويسهل حقن شاي الكمبوست، تأسيس 18,000–28,000 ج.م/فدان)؛ الرش للمحاصيل الحقلية (20,000–32,000 ج.م)؛ أو الغمر المطور على مصاطب.\n"
            "- **المقننات المائية:** الشتوية 1,200–1,800 م³/فدان، والصيفية 2,200–3,500 م³/فدان.\n"
            "- **إدارة الملوحة:** إضافة الجبس الزراعي الطبيعي والكبريت الميكروني والكمبوست والهيوميك الطبيعي (ليونارديت) مع ري متقارب لطرد الأملاح."
        ),
    },
    {
        "id": "fertilization",
        "buttonLabel": "4. التسميد والكمبوست وأماكن الشراء",
        "shortTitle": "التسميد العضوي والحيوي (الكمبوست · أماكن شراء المدخلات)",
        "generalGuideArabic": (
            "**4. التسميد العضوي والحيوي وأماكن شراء المدخلات المعتمدة:**\n\n"
            "- **البرنامج الحيوي للفدان:** 15–20 م³ كمبوست ناضج عند التجهيز + حقن أسبوعي لـ **شاي الكمبوست الهوائي** (40–60 لتر/فدان) + مخصبات بكتيرية (أزوتوباكتر ومذيبات الفوسفات والبوتاسيوم) + مستحضرات **ديميتر BD 500 وBD 501**.\n"
            "- **أماكن شراء المدخلات المعتمدة في مصر:** الجمعية المصرية للزراعة الحيوية **(EBDA)**، مزارع سيكم **(SEKEM)**، ومنافذ ووحدات الإنتاج الحيوي بـ **مركز البحوث الزراعية (ARC)**."
        ),
    },
    {
        "id": "biocontrol",
        "buttonLabel": "5. المكافحة الحيوية والحشائش",
        "shortTitle": "المكافحة الحيوية (الآفات والأمراض · طرق المكافحة · الحشائش)",
        "generalGuideArabic": (
            "**5. المكافحة الحيوية للآفات والأمراض وإدارة الحشائش (بدون كيماويات):**\n\n"
            "- **المصائد والأعداء الطبيعية:** مصائد فرمونية ولونية (صفراء وزرقاء) + كروت طفيل الترايكوجراما (25–30 كارت/فدان) ومفترس أسد المن.\n"
            "- **الرش الحيوي آخر النهار قبل الغروب:** بكتيريا **باسيلس Bt** للديدان، **زيت النيم 5 سم/لتر + صابون بوتاسي** للثاقبة الماصة، **كبريت ميكروني** للبياض والعناكب، وفطر **ترايكوديرما** لأعفان الجذور.\n"
            "- **الحشائش:** الري الكاذب قبل الزراعة، الملش بقش الأرز النظيف، والعزيق الميكانيكي واليدوي المبكر."
        ),
    },
    {
        "id": "harvest",
        "buttonLabel": "6. الحصاد (الطرق والمواعيد)",
        "shortTitle": "الحصاد (طرق الحصاد · مواعيد الحصاد السليمة)",
        "generalGuideArabic": (
            "**6. طرق ومواعيد الحصاد في الزراعة العضوية:**\n\n"
            "- **أفضل وقت:** الصباح الباكر بعد تطاير الندى وقبل اشتداد الشمس للحفاظ على الجودة والزيوت العطرية.\n"
            "- **الأدوات والعبوات:** أدوات نظيفة وصناديق مهواة أو شكائر خيش نظيفة مخصصة للإنتاج العضوي فقط (ممنوع نهائياً استخدام عبوات كيماويات سابقة) وتظليل المحصول فوراً."
        ),
    },
    {
        "id": "postharvest",
        "buttonLabel": "7. معاملات ما بعد الحصاد والتسويق",
        "shortTitle": "معاملات ما بعد الحصاد (التجهيز · النقل · التخزين · التسويق)",
        "generalGuideArabic": (
            "**7. معاملات ما بعد الحصاد والتسويق للمنتجات العضوية:**\n\n"
            "- **التجهيز والنقل:** فرز وتدريج وغسيل بمياه نقية، وتجفيف في مناشر مظللة مهواة مرفوعة عن الأرض، والنقل بسيارات مظللة مفصولة تماماً عن التقليدي برقم تشغيلة (Lot).\n"
            "- **التخزين الآمن:** يمنع الفوسفين الكيماوي؛ يُستخدم ضبط الرطوبة والتبريد أو التراب الدياتومي الغذائي أو CO2.\n"
            "- **التسويق:** التعاقدات مع شبكة الجمعية (EBDA) وشركاء التصدير وشهادات **اقتصاد المحبة (EoL)** و**ديميتر (DEMETER)** بعلاوة سعرية (+30% إلى +60%)."
        ),
    },
]

TOR_ELEVEN_FAQS: list[dict[str, Any]] = [
    {"id": "faq_biodynamic", "number": 1, "buttonLabel": "1. ما هي الزراعة الحيوية (Biodynamic)؟", "keywords": ["الزراعه الحيويه", "بيوديناميك", "biodynamic", "ديميتر", "demeter"], "answerArabic": "**ما هي الزراعة الحيوية (Biodynamic Agriculture)؟**\n\n- أرقى مستويات الزراعة العضوية النقية 100% بقيادة **الجمعية المصرية للزراعة الحيوية (EBDA)** منذ 1990 تحت علامة **DEMETER** ومعيار **اقتصاد المحبة (EoL)**.\n- تعامل المزرعة ككائن حي متكامل بدون أي كيماويات، وتتميز بمستحضرات ديميتر الطبيعية (**BD 500** لتنشيط التربة والجذور و**BD 501** للضوء وجودة الثمار)."},
    {"id": "faq_weeds", "number": 2, "buttonLabel": "2. إزاي أكافح الحشائش عضوياً؟", "keywords": ["مكافحه الحشائش", "علاج الحشائش", "الحشائش"], "answerArabic": "**إدارة الحشائش عضوياً (بدون مبيدات حشائش):**\n\n1. **الري الكاذب قبل الزراعة** بـ 10–14 يوم ثم الحرث السطحي.\n2. **التغطية الحيوية (الملش)** بقش الأرز النظيف.\n3. **الري بالتنقيط** لحصر المياه عند الجذور.\n4. **العزيق المبكر** قبل التزهير وتطبيق الدورة الزراعية بعد البرسيم."},
    {"id": "faq_biocontrol", "number": 3, "buttonLabel": "3. إيه هي المكافحة الحيوية للآفات؟", "keywords": ["المكافحه الحيويه", "مكافحه الافات", "الرش الحيوي"], "answerArabic": "**المكافحة الحيوية في المزرعة العضوية:**\n\n- تعليق مصائد فرمونية ولونية + إطلاق كروت طفيل **الترايكوجراما** (25–30 كارت/فدان).\n- الرش آخر النهار بـ **باسيلس Bt** للديدان، **زيت النيم 5 سم/لتر + صابون بوتاسي** للمن والذبابة والتربس، **كبريت ميكروني** للبياض، و**ترايكوديرما** لأعفان الجذور."},
    {"id": "faq_inputs", "number": 4, "buttonLabel": "4. منين أشتري مستلزمات الزراعة العضوية؟", "keywords": ["منين اشتري", "شراء المدخلات", "اماكن شراء", "شراء الكمبوست"], "answerArabic": "**أماكن شراء مستلزمات الزراعة العضوية المعتمدة في مصر:**\n\n1. **الجمعية المصرية للزراعة الحيوية (EBDA):** مستحضرات BD 500/501 وقوائم الموردين المعتمدين.\n2. **مزارع وشركات سيكم (SEKEM):** الكمبوست الحيوي والشتلات العضوية.\n3. **مركز البحوث الزراعية (ARC) ووحدات الإنتاج الحيوي:** العقدين وأزوتوباكتر وفوسفورين وترايكوديرما وترايكوجراما."},
    {"id": "faq_marketing", "number": 5, "buttonLabel": "5. إزاي أسوق المنتجات العضوية والحيوية؟", "keywords": ["اسوق", "تسويق", "بيع المحصول"], "answerArabic": "**تسويق المنتجات العضوية والحيوية:**\n\n1. **الزراعة التعاقدية** مع شبكة EBDA والشركات الشريكة (مثل إيزيس ولوتس ونيتشر تكس وسيكم).\n2. **شهادتا اقتصاد المحبة (EoL) وديميتر (DEMETER)** للتتبع الرقمي والتصدير لأوروبا بعلاوة +30% إلى +60%.\n3. **المنافذ العضوية المتخصصة** والسلاسل التجارية."},
    {"id": "faq_compost", "number": 6, "buttonLabel": "6. إزاي أعمل كمبوست عالي الكفاءة؟", "keywords": ["اعمل كمبوست", "انتاج كمبوست", "عمل الكمبوست"], "answerArabic": "**إنتاج كمبوست حيوي عالي الكفاءة:**\n\n1. نسبة الخلط **65% مخلفات نباتية جافة مفرومة + 35% روث حيواني نظيف ومخلفات خضراء**.\n2. إضافة صخر فوسفات وكبريت زراعي ومنشط ميكروبي/كمبوست بين الطبقات.\n3. ضبط الرطوبة 50–60% ومراقبة ارتفاع الحرارة (55–65°م) مع التقليب كل 7–10 أيام لمدة 8–12 أسبوع حتى زوال الرائحة."},
    {"id": "faq_irrigation_sources", "number": 7, "buttonLabel": "7. إيه مصادر مياه الري المسموحة؟", "keywords": ["مصادر مياه الري", "مصادر الري"], "answerArabic": "**مصادر مياه الري المسموحة والمحظورة عضوياً:**\n\n- **مسموح:** مياه النيل والترع النظيفة، الآبار الجوفية المفحوصة، وحصاد الأمطار.\n- **محظور تماماً:** مياه الصرف الصحي أو الصناعي أو المصارف الملوثة بالكيماويات."},
    {"id": "faq_water_tests", "number": 8, "buttonLabel": "8. إيه تحاليل المياه المطلوبة للري؟", "keywords": ["تحاليل المياه", "تحليل ميه الري"], "answerArabic": "**تحاليل المياه المطلوبة للزراعة العضوية:**\n\n1. **الملوحة الكلية (EC & TDS)** بالـ ppm.\n2. **pH وSAR والكلوريد والبورون والبيكربونات**.\n3. **التحليل الميكروبيولوجي (E. coli & Salmonella)**.\n4. **المعادن الثقيلة ومتبقيات المبيدات** عند الشك في مصدر الري."},
    {"id": "faq_liquid_fertilizers", "number": 9, "buttonLabel": "9. إيه هي الأسمدة السائلة الحيوية؟", "keywords": ["الاسمده السائله", "سماد سائل", "شاي الكمبوست"], "answerArabic": "**الأسمدة السائلة الحيوية وكيفية استخدامها:**\n\n1. **شاي الكمبوست الهوائي:** نقع 10–15 كجم كمبوست + 500 جم عسل أسود في 100 لتر مياه خالية من الكلور مع تهوية 24–36 ساعة، والحقن 40–60 لتر/فدان.\n2. **الأسمدة البكتيرية السائلة (Bio-NPK)** ومستخلصات الطحالب والأحماض الأمينية النباتية."},
    {"id": "faq_planting_times", "number": 10, "buttonLabel": "10. إيه إرشادات ومواعيد الزراعة؟", "keywords": ["مواعيد الزراعه", "العروات", "امتي ازرع"], "answerArabic": "**مواعيد الزراعة في مصر:**\n\n- **الشتوية (سبتمبر–نوفمبر):** القمح، الفول، البرسيم، الشعير، البصل، الثوم، البسلة، البطاطس الشتوية، الكاموميل، الكلنديولا، الكمون، اليانسون.\n- **الصيفية (فبراير–مايو):** الطماطم، الفلفل، الباذنجان، الكوسة، الذرة، الصويا، عباد الشمس، السوداني، السمسم، الكركديه، الريحان، النعناع.\n- **النيلية (أغسطس–سبتمبر):** الفاصوليا والبطاطس النيلية والكرنب."},
    {"id": "faq_carbon_credits", "number": 11, "buttonLabel": "11. إيه هي شهادات الكربون للمزارعين؟", "keywords": ["شهادات الكربون", "سندات الكربون", "carbon credits"], "answerArabic": "**شهادات الكربون (Carbon Credits) في مشروع اقتصاد المحبة (EoL):**\n\n- التزامك بالكمبوست وزراعة الأشجار ومنع الكيماويات يحتجز الكربون في تربتك.\n- تقوم الجمعية (EBDA) ومعيار اقتصاد المحبة بقياس وتوثيق الكربون سنوياً وإصدار **شهادات كربون معتمدة** تدر عائداً مالياً إضافياً مباشراً لكل فدان للمزارعين المسجلين."},
]

# ---------------------------------------------------------------------------
# All 67 Association Crops (CSV Loader + Complete Embedded 67-Crop Catalog)
# ---------------------------------------------------------------------------
CROP_CATEGORY_CHOICES = [
    {"label": "قسم الخضروات", "category": "خضروات"},
    {"label": "قسم النباتات الطبية والعطرية", "category": "نباتات طبية وعطرية"},
    {"label": "قسم المحاصيل الحقلية", "category": "محاصيل حقلية"},
    {"label": "قسم أشجار الفاكهة", "category": "أشجار فاكهة"},
    {"label": "قسم المحاصيل الزيتية والجذرية", "category": "محاصيل زيتية وألياف وجذرية"},
]

# Tuple format: (display_name, raw_name, category, extra_aliases, env_soil, seeds_time, irrig, fert, biocontrol, harvest)
EMBEDDED_CROPS_TUPLES: list[tuple[str, str, str, list[str], str, str, str, str, str, str]] = [
    ("الطماطم", "الطماطم", "خضروات", ["طماطم", "قوطه", "بندوره"], "صيفي/نيلي، تربة خصبة جيدة الصرف 20-30°م", "5000-6000 شتلة/فدان (17.5-20 جم بذور بالمشتل)", "تنقيط منتظم دون تعطيش أو تغريق لتجنب عفن الطرف الزهري", "20-25 م³ كمبوست + 3 طن فيرمي + صخر فوسفات وفلسبار + شاي كمبوست", "زيت نيم + Bt للتوتا أبسلوتا + ترايكوديرما للأعفان + كبريت ميكروني", "بعد 70-90 يوم من الشتل؛ التلوين المبكر باليد"),
    ("النعناع", "النعناع", "نباتات طبية وعطرية", ["نعناع", "نعناع بلدي", "نعناع فلفلي"], "جميع الأراضي عدا شديدة الملوحة؛ شمس كاملة", "بالشتلات والريزومات طول العام عدا البرد القارس (20-25 ألف شتلة/فدان)", "متقارب خاصة بالصيف بعد كل حشة", "15 م³ كمبوست + شاي كمبوست لرفع الزيت العطري", "مكافحة الصدأ والمن بزيت النيم والصابون البوتاسي والكبريت الميكروني", "3-4 حشات سنوياً عند بداية التزهير؛ تجفيف بالظل"),
    ("الكاموميل (البابونج)", "الكاموميل", "نباتات طبية وعطرية", ["كاموميل", "بابونج", "شيح البابونج"], "شتوي معتدل، تربة صفراء أو رملية مستصلحة", "200 جم بالمشتل لإنتاج 22-25 ألف شتلة/فدان (أكتوبر)", "خفيف منتظم وتقليله قبل جمع النورات", "10-15 م³ كمبوست بالتجهيز + شاي كمبوست ومذيبات الفوسفات", "عزيق 2-3 مرات + كبريت ميكروني للبياض الدقيقي", "جمع النورات الزهرية يدوياً كل 10-15 يوم؛ تجفيف مظلل"),
    ("الكلانديولا (الأقحوان)", "كلانديولا", "نباتات طبية وعطرية", ["كلانديولا", "اقحوان"], "شتوي، تربة طينية وصفراء جيدة الصرف", "250-300 جم بذور/فدان بالمشتل ثم تنقل للأرض", "معتدل كل 10-14 يوم حسب حرارة الجو", "12-15 م³ كمبوست + صخر فوسفات طبيعي وشاي كمبوست", "إزالة الأزهار التالفة + Bt لديدان الورق", "جمع البتلات المتفتحة صباحاً كل 5-7 أيام؛ تجفيف مظلل"),
    ("المورينجا", "مورينجا", "نباتات طبية وعطرية", ["مورينجا"], "تجود في أغلب الأراضي المصرية وتتحمل الجفاف والحر", "3-4 كجم بذور/فدان في جور أو شتلات", "خفيف متباعد بعد التأسيس، حساسة للغمر الزائد", "احتياجات سمادية متوسطة (10 م³ كمبوست سنوياً + شاي كمبوست)", "قليلة الإصابة؛ النيم وBt عند ظهور ديدان الأوراق", "حش الأوراق كل 45-60 يوم أو جني القرون"),
    ("الكزبرة (والشبت والبقدونس)", "الكزبرة", "نباتات طبية وعطرية", ["كزبره", "كسبره", "شبت", "بقدونس", "كرفس"], "شتوي، تربة جيدة الصرف بعيدة عن الملوحة", "8-12 كجم تقاوي/فدان للورق أو 6 كجم للبذور (أكتوبر-نوفمبر)", "منتظم كل أسبوعين دون تغريق", "10-15 م³ كمبوست + صخر فوسفات + شاي كمبوست", "صابون بوتاسي وزيت نيم للمن والتربس والجاسيد", "حشات للورق بعد 45 يوم أو حصاد البذور عند تمام الجفاف"),
    ("القمح", "القمح", "محاصيل حقلية", ["قمح", "غله"], "شتوي، جميع الأراضي الطينية والرملية المستصلحة", "50 كجم تقاوي بالتسطير أو 60 كجم بدار (نوفمبر)", "4-6 ريات متوازنة وتجنب الري وقت الرياح", "15 م³ كمبوست + أزوتوباكتر للتقاوي + شاي كمبوست وطرد السنابل", "دورة زراعية للوقاية من التفحم والصدأ والحشائش + كبريت ميكروني", "أبريل-مايو عند اصفرار السنابل وجفاف الحبوب"),
    ("حبة البركة", "حبة البركة", "نباتات طبية وعطرية", ["حبه البركه", "الحبه السوداء"], "شتوي، تناسب مختلف الأراضي جيدة الصرف", "3-4 كجم بذور/فدان تزرع سطوراً في أكتوبر-نوفمبر", "معتدل بدون تغريق لتفادي الذبول", "12-15 م³ كمبوست عند التجهيز + صخر فوسفات وشاي كمبوست", "معاملة البذور بالترايكوديرما ضد الذبول الفيوزاريومي", "عند اصفرار الكبسولات وتلون البذور بالأسود"),
    ("الينسون", "الينسون", "نباتات طبية وعطرية", ["ينسون", "يانسون"], "شتوي، تربة صفراء وطينية متماسكة خفيفة", "3-4 كجم بذور/فدان (أكتوبر-نوفمبر)", "معتدل ويمنع الري عند نضج النورات", "12-15 م³ كمبوست + صخر فوسفات وفلسبار + شاي كمبوست", "ترايكوديرما للذبول + كبريت ميكروني للبياض والمن", "عند اصفرار 75% من الخيمات الزهرية صباحاً"),
    ("الكراوية", "الكراوية", "نباتات طبية وعطرية", ["كراويه", "كراويا"], "شتوي، تربة خصبة جيدة الصرف", "6-8 كجم بذور/فدان سطوراً في أكتوبر-نوفمبر", "منتظم كل 2-3 أسابيع ثم يوقف قبل الحصاد", "12-15 م³ كمبوست + صخر فوسفات وشاي كمبوست", "ترايكوديرما للذبول + صابون بوتاسي للمن", "إبريل-مايو عند تحول البذور للبني في الصباح الباكر"),
    ("الفول البلدي", "الفول البلدي", "محاصيل حقلية", ["فول بلدي", "فول تدميس"], "شتوي، تربة طينية وصفراء خالية من الهالوك", "50-60 كجم تقاوي معاملة بالعقدين/فدان (أكتوبر-نوفمبر)", "رية زراعة ومحاياة و3 ريات معتدلة بدون تغريق", "10 م³ كمبوست + تلقيح بالعقدين + صخر فوسفات", "مكافحة الهالوك يدوياً + تبقع الأوراق والمن بالنيم والصابون البوتاسي", "إبريل عند اسوداد القرون السفلية"),
    ("المريمية (المرمرية)", "المريمية", "نباتات طبية وعطرية", ["مريميه", "مرمريه"], "مناسبة لمعظم الأراضي جيدة الصرف؛ معمرة", "شتلات وعقل؛ يحتاج الفدان 12-15 ألف شتلة", "منتظم خفيف وتقل بالشتاء", "15 م³ كمبوست ناضج + صخر فوسفات وشاي كمبوست", "طعوم حيوية للحفار والدودة القارضة + زيت نيم", "حشتان إلى 3 سنوياً قبل التزهير الكامل؛ تجفيف بالظل"),
    ("الحمص", "الحمص", "محاصيل حقلية", ["حمص"], "شتوي، تربة متوسطة وخفيفة بدون غدق", "40 كجم بذور ملقحة بالعقدين/فدان (أكتوبر-نوفمبر)", "معتدل متباعد لتجنب أعفان الجذور", "10 م³ كمبوست + صخر فوسفات + عقدين", "نقاوة حشائش مبكرة (ضعيف المنافسة) + Bt لديدان القرون", "عند جفاف القرون وتحولها للأصفر الذهبي"),
    ("العدس", "العدس", "محاصيل حقلية", ["عدس"], "شتوي بالصعيد والوجه القبلي، تربة طميية خفيفة", "35-45 كجم/فدان تقاوي معاملة بالعقدين (نوفمبر)", "ريات خفيفة جداً عند التزهير وامتلاء القرون", "10 م³ كمبوست + صخر فوسفات + عقدين", "صابون بوتاسي للمن + كبريت ميكروني للصدأ", "إبريل عند جفاف النباتات واصفرار القرون"),
    ("الحلبة", "الحلبة", "محاصيل حقلية", ["حلبه"], "شتوي، أغلب الأراضي المصرية", "40 كجم/فدان (نوفمبر)", "معتدل كل 20 يوم في الشتاء", "بقولي يثبت الآزوت؛ 8-10 م³ كمبوست + صخر فوسفات + عقدين", "كبريت ميكروني للبياض الدقيقي", "عند اصفرار القرون وجفافها وتدريسها"),
    ("حشيشة الليمون", "حشيشة الليمون", "نباتات طبية وعطرية", ["حشيشه الليمون", "ليمون جراس"], "معمرة محبة للدفء، أغلب الأراضي جيدة الصرف", "التكاثر بالفسائل (خلفات) بمعدل 10-12 ألف فسيلة/فدان", "منتظم صيفاً بعد كل حشة", "15 م³ كمبوست بالتجهيز + شاي كمبوست حيوي", "قليلة الآفات؛ تطهير الفسائل بالترايكوديرما", "حش الأوراق كل 50-60 يوم؛ التقطير أو التجفيف"),
    ("بنجر السكر", "البنجر (محاصيل سكرية)", "محاصيل زيتية وألياف وجذرية", ["بنجر", "بنجر السكر", "شمندر"], "شتوي متحمل للملوحة العالية والقلوية", "3-4 كجم بذور وحيدة الأجنة/فدان (أغسطس-نوفمبر)", "منتظم وتُمنع المياه قبل القلع بـ 3 أسابيع", "15 م³ كمبوست + صخر فوسفات وفلسبار + بورون حيوي", "طعوم حيوية للحفار + Bt لدودة ورق القطن + كبريت للتبقع", "بعد 180-210 يوم عند اصفرار الأوراق السفلية"),
    ("اللفت", "اللفت", "خضروات", ["لفت"], "شتوي، جميع الأراضي خاصة الصفراء الخفيفة", "2 كجم بذور/فدان (سبتمبر-أكتوبر)", "ري منتظم متقارب لنعومة الجذور", "10-15 م³ كمبوست بالتجهيز + شاي كمبوست", "صابون بوتاسي للمن والحفار + Bt", "بعد 50-65 يوم من الزراعة"),
    ("الذرة الشامية", "الذرة", "محاصيل حقلية", ["ذره", "ذره شاميه", "دره"], "صيفي/نيلي، تربة عميقة خصبة جيدة الصرف", "10-12 كجم تقاوي/فدان ملقحة بالأزوسبرلم (مايو-يونيو)", "منتظم خاصة عند التزهير والطرد كل 10-12 يوم", "20 م³ كمبوست + صخر فوسفات + شاي كمبوست", "كروت الترايكوجراما + Bt لدودة الحشد + ترايكوديرما لأعفان الجذور", "بعد 105-120 يوم عند جفاف أغلفة الكيزان"),
    ("الستيفيا", "الستيفيا", "نباتات طبية وعطرية", ["ستيفيا", "استيفيا"], "دافئة، تربة طميية وصفراء جيدة الصرف بدون ملوحة", "شتلات من المشتل (25-30 ألف شتلة/فدان في الربيع)", "تنقيط منتظم دون جفاف أو تغريق", "20 م³ كمبوست بالتجهيز + شاي كمبوست حيوي", "ترايكوديرما وباسيلس ساتلس للفحة والأعفان", "حش الأوراق قبل التزهير لأعلى نسبة حلاوة؛ تجفيف مظلل"),
    ("فول الصويا", "فول الصويا", "محاصيل زيتية وألياف وجذرية", ["فول صويا", "صويا"], "صيفي، تربة خصبة قليلة الملوحة", "30-35 كجم تقاوي ملقحة بالعقدين/فدان (أبريل-مايو)", "منتظم أثناء التزهير والعقد مع تجنب التغريق", "10 م³ كمبوست + صخر فوسفات حيوي + عقدين", "ترايكوديرما للذبول + Bt لدودة ورق القطن والعنكبوت بالكبريت الميكروني", "عند اصفرار وتساقط 75% من الأوراق وجفاف القرون"),
    ("عباد الشمس (دوار الشمس)", "عباد الشمس", "محاصيل زيتية وألياف وجذرية", ["عباد الشمس", "دوار الشمس"], "صيفي سريع النضج يتحمل الملوحة المتوسطة", "4-5 كجم بذور/فدان (مارس-يونيو)", "متوسط 4-5 ريات منتظمة دون عطش بالتزهير", "10-15 م³ كمبوست + صخر فوسفات وفلسبار", "طعوم للحفار + مراقبة الطيور + ترايكوديرما", "بعد 90-100 يوم عند اصفرار ظهر القرص وجفاف البتلات"),
    ("الروزماري (حصى لبان)", "الروز ماري (حصي لبان)", "نباتات طبية وعطرية", ["روزماري", "حصي لبان", "اكليل الجبل"], "معمر متحمل للجفاف، جميع الأراضي عدا الغدقة", "بالعقل المجذرة بمعدل 12-15 ألف شتلة/فدان", "معتدل متباعد بعد التأسيس (يكره الغمر الزائد)", "12-15 م³ كمبوست + سماد حيوي سائل", "كبريت ميكروني للبياض الدقيقي + زيت نيم", "قص الأفرع الغضة مرتين سنوياً قبل التزهير"),
    ("الكتان", "الكتان", "محاصيل زيتية وألياف وجذرية", ["كتان", "بذر الكتان"], "شتوي، تربة طينية وصفراء متماسكة خالية من الحشائش", "70 كجم بدار أو 55 كجم تسطير/فدان (نوفمبر)", "4-5 ريات معتدلة بدون ركود مياه", "12 م³ كمبوست + صخر فوسفات حيوي", "عزيق ونقاوة حشائش مبكرة (الحامول) + كبريت للصدأ", "إبريل-مايو عند اصفرار الكبسولات وجفاف السوق"),
    ("السورجم (الذرة الرفيعة)", "سورجم", "محاصيل حقلية", ["سورجم", "ذره رفيعه", "حشيشه السودان"], "صيفي متحمل للحر والملوحة والجفاف في الصعيد", "6-8 كجم/فدان تسطير أو 12 كجم بدار", "يتحمل فترات جفاف؛ 4-6 ريات", "15 م³ كمبوست + شاي كمبوست + أزوسبرلم", "كروت الترايكوجراما + Bt للثاقبات والديدان", "عند تمام تصلب الحبوب أو حش العلف على ارتفاع مناسب"),
    ("الفول السوداني", "الفول السوداني", "محاصيل زيتية وألياف وجذرية", ["فول سوداني", "سوداني"], "صيفي، تربة رملية خفيفة جيدة الصرف والتهوية", "45-50 كجم بذرة مقشرة معاملة بالعقدين/فدان (إبريل-مايو)", "تنقيط أو رش منتظم ويوقف قبل القلع بـ 10 أيام", "10 م³ كمبوست + جبس زراعي طبيعي 500 كجم وقت التزهير لتكوين القرون", "دورة زراعية + ترايكوديرما ضد النيماتودا وأعفان الجذور", "سبتمبر-أكتوبر عند تلون الغلاف الداخلي بالبني؛ تجفيف جيد ضد الأفلاتوكسين"),
    ("الفاصوليا", "الفاصوليا", "خضروات", ["فاصوليا"], "ربيعي/خريفي معتدل، تربة صفراء خالية من الملوحة", "35-45 كجم/فدان في جور (فبراير أو سبتمبر)", "خفيف منتظم دون تغريق لتفادي أعفان الجذور", "10-15 م³ كمبوست + صخر فوسفات + عقدين", "ترايكوديرما لأعفان الجذور والريزوكتونيا + زيت نيم للذبابة", "خضراء بعد 55 يوم أو جافة بعد 95-110 يوم"),
    ("الملوخية", "الملوخية", "خضروات", ["ملوخيه"], "صيفي سريع النمو في معظم الأراضي", "8-12 كجم/فدان (مارس-أغسطس)", "منتظم كل 7-10 أيام بعد كل حشة", "10-15 م³ كمبوست بالتجهيز + شاي كمبوست", "صابون بوتاسي وزيت نيم للمن والعنكبوت + Bt للدودة الخضراء", "الحشة الأولى بعد 45 يوم ثم كل 25-30 يوم"),
    ("العتر", "العتر", "نباتات طبية وعطرية", ["عتر", "عطر", "عطرشان"], "معمر، تربة صفراء ورملية مستصلحة خالية من الغدق", "بالعقلة الطرفية بمعدل 10-12 ألف عقلة/فدان", "متوازن كل 10-15 يوم مع منع الري قبل الحش", "15-20 م³ كمبوست + صخر فوسفات وفلسبار + شاي كمبوست", "طعوم للحفار + كبريت ميكروني للصدأ", "2-3 حشات سنوياً عند بداية التزهير؛ تقطير مباشر"),
    ("اللوف", "اللوف", "محاصيل زيتية وألياف وجذرية", ["لوف"], "صيفي متسلق على تكاعيب، أراضي خصبة عميقة", "1.5-2 كجم بذور/فدان في جور (مارس-أبريل)", "غزير منتظم وقت النمو والإثمار", "15-20 م³ كمبوست بالجور + شاي كمبوست", "كبريت ميكروني للبياض الدقيقي + نيم للذبابة", "عند اصفرار الثمار وبدء جفافها ونقعها وتقشير الألياف"),
    ("الخرشوف", "الخرشوف", "نباتات طبية وعطرية", ["خرشوف"], "شتوي، تربة خصبة جيدة الصرف والتهوية", "تجزئة الأمهات (الفسائل) في أغسطس-سبتمبر (5-6 آلاف فسيلة/فدان)", "منتظم خاصة أثناء تكوين النورات", "15-20 م³ كمبوست + شاي كمبوست وفلسبار", "كبريت ميكروني للبياض + Bt للديدان", "نوفمبر-إبريل عند كبر النورات قبل تفتح القنابات"),
    ("الكركديه", "الكركديه", "نباتات طبية وعطرية", ["كركديه"], "صيفي محب للحر بالصعيد، يتحمل الملوحة المتوسطة", "6-8 كجم بذور/فدان في إبريل-مايو", "معتدل متباعد دون تعطيش وقت التزهير", "15-20 م³ كمبوست بالتجهيز + شاي كمبوست", "مصائد لونية وصابون بوتاسي للمن والبق الدقيقي", "أكتوبر-نوفمبر بقطف السبلات وتجفيفها بالظل بعيداً عن الأتربة"),
    ("الريحان", "الريحان", "نباتات طبية وعطرية", ["ريحان"], "صيفي، كافة الأراضي غير الملحية؛ شمس مباشرة", "شتلات بالمشتل (20-25 ألف شتلة/فدان في الربيع)", "منتظم كل 7-10 أيام بعد كل قرطة", "15 م³ كمبوست + شاي كمبوست حيوي بعد كل حشة", "طعوم للحفار + Bt للديدان + نيم وصابون للمن", "قرط القمم عند بداية التزهير كل 45 يوم؛ تجفيف مظلل"),
    ("الشعير", "شعير", "محاصيل حقلية", ["شعير"], "شتوي متحمل للملوحة والجفاف والأراضي الصحراوية والجيرية", "35-45 كجم/فدان تسطير أو 55 كجم بدار (نوفمبر)", "3-4 ريات فقط أو زراعة مطرية بالساحل", "10 م³ كمبوست + أزوتوباكتر وشاي كمبوست", "الدورة الزراعية ونقاوة الحشائش المبكرة", "إبريل عند جفاف السنابل وتصلب الحبوب"),
    ("الشوفان", "الشوفان", "محاصيل حقلية", ["شوفان"], "شتوي معتدل البرودة، جميع الأراضي جيدة الصرف", "50-70 كجم تقاوي/فدان (نوفمبر)", "معتدل 4-5 ريات", "8-15 م³ كمبوست + شاي كمبوست ومخصبات حيوية", "كبريت ميكروني للصدأ والبياض + نيم للمن", "إبريل-مايو عند جفاف الحبوب وتحول الساق للأصفر"),
    ("الأرز", "الارز", "محاصيل حقلية", ["ارز", "رز"], "صيفي بالأراضي الطينية الثقيلة بشمال الدلتا لاستصلاح الملوحة", "50-60 كجم تقاوي/فدان شتل أو بدار (مايو)", "غمر متقطع موفر للمياه (تجفيف وتجديد)", "15 م³ كمبوست + أزولا وطحالب خضراء مزرقة مثبتة للأزوت + صخر فوسفات", "نقاوة يدوية وضبط منسوب المياه للحشائش + ترايكوجراما للثاقبات", "سبتمبر-أكتوبر عند اصفرار 85% من السنابل"),
    ("الكينوا", "الكينوا", "محاصيل حقلية", ["كينوا"], "شتوي يتحمل الملوحة الشديدة والجفاف والبرد", "3-5 كجم بذور نقية/فدان (أكتوبر-نوفمبر)", "معتدل 3-4 ريات، لا يتحمل الغرق بعد الإنبات", "10-12 م³ كمبوست + صخر فوسفات وشاي كمبوست", "صابون بوتاسي وزيت نيم للمن والبق + Bt للديدان", "بعد 110-130 يوم عند جفاف النورات وتصلب البذور"),
    ("العرقسوس", "العرقسوس", "محاصيل زيتية وألياف وجذرية", ["عرقسوس", "عرق سوس"], "معمر صيفي، أراضي طميية ورملية عميقة", "بالعقل الجذرية (مدادات) بمعدل 10-12 ألف عقلة/فدان", "معتدل متباعد لتشجيع تعمق الجذور", "15 م³ كمبوست بالتجهيز + شاي كمبوست", "صابون بوتاسي وزيت نيم للذبابة البيضاء", "تُقلع الجذور بعد سنتين من الزراعة في الخريف أو الشتاء"),
    ("الكرات", "كرات", "خضروات", ["كرات"], "شتوي وصيفي بالأراضي الطميية والخفيفة", "3-4 كجم بذور/فدان بالبذر أو الشتل", "منتظم متقارب لنمو الأوراق الغضة", "10-15 م³ كمبوست بالتجهيز + شاي كمبوست", "زيت نيم للتربس والمن + ترايكوديرما", "حش الأوراق باستمرار كل 30-40 يوم"),
    ("الخلة", "الخلة", "نباتات طبية وعطرية", ["خله", "خله بلدي"], "شتوي بالأراضي الطينية والصفراء", "2-3 كجم بذور/فدان (أكتوبر-نوفمبر)", "معتدل وتوقف قبل نضج الثمار", "10-15 م³ كمبوست + صخر فوسفات", "كبريت ميكروني للبياض + صابون بوتاسي للمن", "مايو-يونيو عند اصفرار النورات الخيمية صباحاً"),
    ("الجوجوبا (الهوهوبا)", "الجوجوبا", "نباتات طبية وعطرية", ["جوجوبا", "هوهوبا"], "معمر صحراوي، يتحمل العطش والحرارة والملوحة العالية", "شتلات مؤنثة ومذكرة (10:1) على مسافات 2×4 م", "تنقيط قليل متباعد بعد السنة الثانية", "10 م³ كمبوست لكل فدان سنوياً + هيوميك طبيعي", "مقاومة طبيعية عالية؛ نيم وترايكوديرما عند الحاجة", "جمع البذور الناضجة صيفاً بدءاً من العام الرابع"),
    ("الرمان", "الرمان", "أشجار فاكهة", ["رمان", "رمان منفلوطي"], "مستديم يتحمل الحرارة والملوحة المتوسطة، جفاف الصيف", "شتلات على مسافات 3×5 أو 4×5 م (فبراير)", "تنقيط منتظم تماماً وقت النضج لمنع تشقق الثمار", "15-20 كجم كمبوست/شجرة شتاءً + كبريت وصخر فوسفات", "تكييس الثمار وأكياس ورقية ضد فراشة الرمان + كبريت ميكروني", "أغسطس-أكتوبر عند تلوّن الثمار وسماع طقطقة الحب"),
    ("الحناء (الحنة)", "الحناء", "نباتات طبية وعطرية", ["حناء", "حنه"], "معمرة بالصعيد وأسوان، محبة للحرارة وتتحمل الملوحة", "10-12 ألف شتلة أو عقلة مجذرة/فدان (فبراير-مارس)", "منتظم كل 10-15 يوم صيفاً", "15 م³ كمبوست بالتجهيز + شاي كمبوست بعد الحش", "ترايكوديرما لأعفان الجذور + نيم", "حشتان سنوياً (يونيو وأكتوبر) وتجفيف الأوراق بالظل"),
    ("الكمون", "الكمون", "نباتات طبية وعطرية", ["كمون"], "شتوي حساس للرطوبة الأرضية الزائدة والصقيع", "8-10 كجم بذور/فدان (أكتوبر-نوفمبر)", "ريات خفيفة متباعدة جداً بدون تغريق", "15 م³ كمبوست متحلل + صخر فوسفات وشاي كمبوست", "الوقاية الحاسمة من الذبول الفيوزاريومي بالترايكوديرما وتنظيم الري", "إبريل-مايو عند اصفرار النباتات صباحاً؛ تجفيف بالظل"),
    ("السافوري", "السافوري", "نباتات طبية وعطرية", ["سافوري", "ندغ"], "مناسب لأغلب الأراضي الخفيفة جيدة الصرف", "بذر أو شتلات (15-18 ألف شتلة/فدان)", "منتظم بدون ركود مياه", "15-20 م³ كمبوست + شاي كمبوست", "مصائد صفراء وزيت نيم للذبابة البيضاء", "حش القمم قبل التزهير الكامل؛ تجفيف مظلل"),
    ("الميليسيا (المليسة)", "ميليسيا", "نباتات طبية وعطرية", ["ميليسيا", "مليسه", "ترنجان"], "تربة خصبة جيدة الصرف وإضاءة معتدلة", "بالعقل أو البذور والمشتل (15-20 ألف شتلة/فدان)", "منتظم كل 7-10 أيام خاصة بعد القرط", "15-20 م³ كمبوست + شاي كمبوست حيوي", "طعوم للحفار والدودة القارضة + نيم", "عدة حشات سنوياً قبل التزهير؛ تجفيف سريع بالظل"),
    ("السلاميكي (السنامكي)", "السلاميكي", "نباتات طبية وعطرية", ["سلاميكي", "سنامكي", "سنا مكي"], "صحراوي وحراري بالصعيد، أراضي خفيفة جيدة الصرف", "2.5-4.5 كجم بذور/فدان (مارس-إبريل)", "احتياجات مائية قليلة ومتباعدة", "10-15 م³ كمبوست متحلل + 50 كجم كبريت زراعي", "قليلة الآفات والأمراض؛ نيم احتياطياً", "قطف الوريقات والقرون الخضراء وتجفيفها بالظل"),
    ("البطاطس", "البطاطس", "خضروات", ["بطاطس"], "شتوي/صيفي/نيلي، تربة رملية وصفراء جيدة الصرف", "1.2-1.75 طن تقاوي درنات مفحوصة/فدان", "منتظم كل 4-7 أيام دون تغريق أو تذبذب لتفادي التشقق", "20 م³ كمبوست + صخر فوسفات حيوي + فلسبار + 150 كجم كبريت لمنع الجرب", "ترايكوديرما وباسيلس ساتلس للندوة المتأخرة والعفن البني + طعوم للحفار", "بعد 95-115 يوم وتجفيف العرش ميكانيكياً قبل القلع"),
    ("الجزر", "الجزر", "خضروات", ["جزر"], "شتوي، أراضي عميقة خفيفة رملية أو طميية ناعمة", "2-5 كجم بذور/فدان (أغسطس-يناير)", "انتظام الري لمنع تشقق الجذور وتفرعها", "10-15 م³ كمبوست تام التحلل + صخر فوسفات حيوي وفلسبار", "باسيلس ساتلس للفحة الأوراق + نيم للمن", "بعد 90-110 يوم عندما تبلغ الجذور الحجم التسويقي"),
    ("العنب", "العنب", "أشجار فاكهة", ["عنب", "كرمه العنب"], "مستديم في مدى واسع من الأراضي؛ شمس كاملة وتقليم شتوي", "800-1100 شتلة مطعومة/فدان على مسافات 2×3 م", "تنقيط متوازن ويقلل وقت النضج لرفع السكريات", "كمبوست شتوي حول الجور (15-20 كجم/كرمة) + توازن أزوتي منخفض + فلسبار", "كبريت ميكروني وباسيلس ساتلس للبياض الدقيقي والزغبي + مصائد فرمونية لدودة ثمار العنب", "مايو-أغسطس حسب الصنف؛ الجمع صباحاً في صناديق مهواة"),
    ("الكوسة", "الكوسة", "خضروات", ["كوسه"], "سريعة النضج صيفي وشتوي في معظم الأراضي", "2-3 كجم بذور/فدان (أغلب شهور السنة)", "صباحاً باكراً دون تغريق لعدم تعفن الثمار", "10-15 م³ كمبوست + صخر فوسفات وشاي كمبوست", "كبريت ميكروني وبيكربونات بوتاسيوم للبياض + زيت نيم للذبابة البيضاء والمن", "الجمع بعد 40-50 يوم كل يومين"),
    ("الباذنجان", "الباذنجان", "خضروات", ["باذنجان", "بتنجان"], "صيفي ونيلي، أراضي خصبة جيدة الصرف", "100-150 جم بذور بالمشتل/فدان (10-12 ألف شتلة)", "منتظم بدون تغريق حول عنق النبات", "10-15 م³ كمبوست + 200 كجم صخر فوسفات حيوي + شاي كمبوست", "ترايكوديرما لموت البادرات + كبريت للبياض + نيم وBt للثاقبات", "بعد 65-75 يوم من الشتل بلمعان الثمار"),
    ("الفلفل", "الفلفل", "خضروات", ["فلفل", "فلفل رومي", "شطه"], "صيفي/نيلي/صوب، أراضي صفراء جيدة الصرف", "150-200 جم بذور بالمشتل/فدان (12-16 ألف شتلة)", "انتظام الري لمنع تساقط الأزهار واللفحة", "10-15 م³ كمبوست + 150 كجم صخر فوسفات حيوي + شاي كمبوست", "مصائد زرقاء وصفراء + نيم للتربس والمن + Bt لديدان الثمار", "الجمع عند تمام الحجم الأخضر أو التلوين الكامل"),
    ("التفاح", "تفاح", "أشجار فاكهة", ["تفاح"], "أراضي صفراء عميقة جيدة الصرف واحتياج لساعات برودة شتوية", "شتلات مطعومة على أصول مقاومة للنيماتودا 4×4 أو 4×5 م", "تنقيط متوازن يزيد أثناء الإثمار ويقل شتاءً", "15-20 م³ كمبوست بالتجهيز وخدمة شتوية حول الجذع + شاي كمبوست", "ترايكوديرما وأعداء حيوية ضد التدرن التاجي + مصائد ذبابة الفاكهة", "يونيو-أغسطس حسب الصنف؛ تبريد فوري"),
    ("البرسيم المصري", "البرسيم", "محاصيل حقلية", ["برسيم", "برسيم مسقاوي"], "شتوي بقولي مخصب للتربة في جميع الأراضي", "36 كجم تقاوي بالدار أو 18-24 كجم بآلة + عقدين", "رية كل 18-25 يوم حسب حرارة الشتاء", "10 م³ كمبوست + تلقيح بالعقدين (يثبت النيتروجين طبيعياً)", "دورة زراعية + Bt إذا ظهرت دودة ورق القطن", "4-5 حشات خلال الشتاء والربيع؛ عمل دريس نظيف"),
    ("البطاطا الحلوة", "البطاطا", "خضروات", ["بطاطا", "بطاطا حلوه"], "صيفي بالأراضي الصفراء والرملية الخفيفة", "عروتين إبريل وأغسطس بالعقل الساقية (15-18 ألف عقلة/فدان)", "غزير بعد أسبوع من الشتل ثم كل 10-12 يوم", "10-15 م³ كمبوست + 150 كجم صخر فوسفات حيوي + فلسبار", "طعوم للحفار والدودة القارضة + Bt لدودة ورق القطن", "بعد 4 أشهر عند اصفرار الأوراق وسهولة تقشير الدرنات"),
    ("البازلاء (البسلة)", "البازلاء", "خضروات", ["بازلاء", "بسله"], "شتوي، أراضي جيدة الصرف قليلة الملوحة", "30-45 كجم/فدان تزرع من أكتوبر وتشتد بالبرد", "حساسة للتغريق؛ ري معتدل كل 12-15 يوم", "10-15 م³ كمبوست + عقدين + صخر فوسفات", "ترايكوديرما لأعفان الجذور والأنثراكنوز + كبريت للبياض", "يُجمع عند امتلاء القرون قبل تصلب البذور"),
    ("الفجل", "الفجل", "خضروات", ["فجل"], "جو معتدل مائل للبرودة في جميع الأراضي الخفيفة", "4-6 كجم بذور/فدان سطوراً", "منتظم متقارب لمنع التحزيم والمرار", "10-15 م³ كمبوست + 150 كجم صخر فوسفات", "طعوم للحفار والدودة القارضة + Bt", "الأصناف البلدية صالحة للتسويق بعد 30-40 يوم"),
    ("الخس", "الخس", "خضروات", ["خس", "كابوتشا"], "شتوي، أراضي صفراء ثقيلة ورملية مخدومة", "شتلات من سبتمبر وأكتوبر (30-40 ألف شتلة/فدان)", "توفير الرطوبة السطحية بانتظام", "15 م³ كمبوست + شاي كمبوست غني ومخصبات بكتيرية سطحية", "زيت نيم وصابون بوتاسي للمن + Bt + ترايكوديرما", "بعد 3-4 أشهر من البذر أو 60-75 يوم من الشتل"),
    ("الكرنب (الملفوف)", "الكرنب", "خضروات", ["كرنب", "ملفوف"], "شتوي وخريفي معتدل البرودة في أراضي خصبة", "150-200 جم بالمشتل/فدان؛ الشتل على مسافات 50-60 سم", "بعد 3-4 أيام من الشتل ثم أسبوعياً دون إهمال", "20 م³ كمبوست (نبات شره للتغذية) + شاي كمبوست", "Bt لديدان الكرنب وأبو دقيق + صابون بوتاسي للمن", "عند اكتمال تكوين الرؤوس وصلابتها بالضغط"),
    ("المشمش", "المشمش", "أشجار فاكهة", ["مشمش"], "حساس للصقيع وقت التزهير؛ أراضي صفراء جيدة الصرف", "شتلات على مسافات 6×7 أو 7×7 م", "متقارب للشتلات الصغيرة؛ منظم للبالغة ويوقف وقت التزهير", "كمبوست شتوي متوازن بعد خروج البراعم + شاي كمبوست", "تقليم وحرق الأفرع المصابة بخنافس القلف + زيت نيم ومصائد ذبابة الفاكهة", "أسبوع أول من يوليو (الكانينو) أو مايو حسب الصنف"),
    ("الكمثرى", "الكمثري", "أشجار فاكهة", ["كمثري", "كمثرى"], "صنف ليكونت يتحمل حرارة الصيف وأغلب الأراضي جيد الصرف", "شتلات مطعومة على 4×5 أو 5×5 م", "تنظيم الري ومنع الغدق للوقاية من اللفحة النارية", "كمبوست شتوي 20 م³/فدان + صخر فوسفات وفلسبار + شاي كمبوست", "كبريت ميكروني وزيت نيم للأكاروس + باسيلس ساتلس وتقليم صحي", "أغسطس عند اكتمال الحجم وسهولة فصل العنق"),
    ("الجوافة", "الجوافة", "أشجار فاكهة", ["جوافه"], "تتحمل حتى 50°م وأغلب الأراضي والملوحة المتوسطة", "شتلات 5×5 م (حوالي 168 شجرة/فدان)", "اهتمام بالري في يناير-فبراير ووقت التحجيم", "1-2 مقطف كمبوست للأشجار الصغيرة وتزيد للبالغة شتاءً", "مصائد فرمونية وغذائية لذبابة الفاكهة + صابون بوتاسي للحشرات القشرية", "بعد 14 أسبوع من التزهير (أغسطس-نوفمبر)"),
    ("الفراولة", "فراولة", "أشجار فاكهة", ["فراوله", "فريز"], "شتوي تصديري بالأراضي الرملية والصفراء عدا الجيرية والملحية", "30-40 ألف شتلة فريش أو فريحو/فدان (سبتمبر-أكتوبر)", "تنقيط دقيق منتظم مع التغطية بالملش الحيوي", "10-15 م³ كمبوست + 200-250 كجم صخر فوسفات حيوي + شاي كمبوست", "ترايكوديرما للقلب الأحمر وأعفان الجذور + كبريت ميكروني وزيت نيم للعنكبوت", "نوفمبر-إبريل عند التلوين للأغراض التصديرية والطازجة"),
    ("اللافندر (الخزامى)", "اللافندر", "نباتات طبية وعطرية", ["لافندر", "خزامي"], "شمس لا تقل عن 8 ساعات يومياً ويتحمل البرودة؛ أراضي جافة صرفها ممتاز", "بذر بالمشتل سبتمبر-أكتوبر أو عقل نصف متخشبة", "حساس لزيادة الري؛ تباعد الريات بشدة", "10-15 م³ كمبوست بالتجهيز + 200 كجم صخر فوسفات حيوي", "ترايكوديرما للذبول وتبقع الأوراق وأعفان الجذور", "قص النورات الزهرية في السنة الأولى والثانية صيفاً صباحاً"),
    ("الشيا", "الشيا", "نباتات طبية وعطرية", ["شيا", "بذور الشيا"], "تحتاج جواً مشمساً للإنبات وحرارة معتدلة بدون صقيع", "3-5 كجم بذور نقية/فدان؛ ربيع أو خريف مبكر", "منتظم متقارب بالبداية ثم يقل قبل النضج", "8-10 م³ كمبوست بالتجهيز + 150 كجم صخر فوسفات حيوي", "ترايكوديرما للفحة وعفن الجذور + نيم للمن والذبابة", "حصاد البذور عند جفاف الأزهار وتحولها للبني (بعد 110-130 يوم)"),
    ("اللوز", "اللوز", "أشجار فاكهة", ["لوز"], "ينمو بالحرارة ويعيش بالبرودة (ساحلي/جيرى/مستصلح جيد الصرف)", "شتلات مطعومة على مسافة 4×5 م شتاءً", "مهم جداً للحفاظ على رطوبة الجذر دون غمر", "تسميد عضوي حذر للأشجار الصغيرة بالكمبوست الناضج ويزداد عند الإثمار", "كبريت ميكروني وباسيلس لصدأ اللوز والعفن البني + مصائد", "يثمر من العام الثالث؛ الجمع عند تشقق القشرة الخضراء صيفاً"),
]

CLEAN_NAME_OVERRIDES: dict[str, dict[str, Any]] = {
    row[1]: {"display": row[0], "aliases": row[3]} for row in EMBEDDED_CROPS_TUPLES
}


def normalize_category(raw_cat: str) -> str:
    c = (raw_cat or "").strip()
    if not c:
        return "محاصيل حقلية"
    if "طبية" in c:
        return "نباتات طبية وعطرية"
    if "خضروات" in c:
        return "خضروات"
    if "حقلية" in c or "علف" in c:
        return "محاصيل حقلية"
    if "فاكهة" in c:
        return "أشجار فاكهة"
    if "زيتية" in c or "ألياف" in c or "جزرية" in c or "جذرية" in c:
        return "محاصيل زيتية وألياف وجذرية"
    return c


def build_search_keys(raw_name: str, clean_name: str, aliases: list[str]) -> list[str]:
    raw_keys = [raw_name, clean_name, re.sub(r"\(.*?\)", "", clean_name).strip(), *aliases]
    seen: list[str] = []
    for k in raw_keys:
        nk = normalize_arabic_for_match(k)
        sk = strip_al_prefix(nk)
        for cand in (nk, sk):
            if len(cand) >= 2 and cand not in seen:
                seen.append(cand)
    return seen


def _build_plant_record(
    idx: int,
    name: str,
    raw_name: str,
    category: str,
    aliases: list[str],
    importance: str = "",
    environment: str = "",
    seeds_and_nursery: str = "",
    agricultural_practices: str = "",
    irrigation: str = "",
    fertilization: str = "",
    pest_and_disease_control: str = "",
    harvest: str = "",
    post_harvest: str = "",
    extra_notes: str = "",
) -> dict[str, Any]:
    sections = [f"المحصول: {name} ({category})"]
    if importance:
        sections.append(f"- القيمة الاقتصادية والأهمية:\n{importance}")
    if environment:
        sections.append(f"- التربة والمناخ والاحتياجات البيئية:\n{environment}")
    if seeds_and_nursery:
        sections.append(f"- كمية التقاوي والشتلات ومواعيد الزراعة:\n{seeds_and_nursery}")
    if agricultural_practices:
        sections.append(f"- تجهيز الأرض وطريقة الزراعة والخدمة:\n{agricultural_practices}")
    if irrigation:
        sections.append(f"- نظام الري والاحتياجات المائية والملوحة:\n{irrigation}")
    if fertilization:
        sections.append(f"- برنامج التسميد العضوي والحيوي:\n{fertilization}")
    if pest_and_disease_control:
        sections.append(f"- الآفات والأمراض وطرق الوقاية والمكافحة الحيوية:\n{pest_and_disease_control}")
    if harvest:
        sections.append(f"- مواعيد وطرق الحصاد والإنتاجية:\n{harvest}")
    if post_harvest:
        sections.append(f"- معاملات ما بعد الحصاد والتجفيف والتخزين:\n{post_harvest}")
    if extra_notes:
        sections.append(f"- ملاحظات إضافية:\n{extra_notes}")

    return {
        "id": f"plant_{idx}",
        "name": name,
        "raw_name": raw_name,
        "category": category,
        "importance": importance,
        "environment": environment,
        "seeds_and_nursery": seeds_and_nursery,
        "agricultural_practices": agricultural_practices,
        "irrigation": irrigation,
        "fertilization": fertilization,
        "pest_and_disease_control": pest_and_disease_control,
        "harvest": harvest,
        "post_harvest": post_harvest,
        "extra_notes": extra_notes,
        "search_keys": build_search_keys(raw_name, name, aliases),
        "full_reference_text": "\n\n".join(sections),
    }


def load_plants_database() -> list[dict[str, Any]]:
    """Load full 67-crop CSV if present on disk, else use the complete 67-crop embedded catalog."""
    base_dir = Path(__file__).resolve().parent
    candidate_csvs = [
        base_dir / "data" / "association_plants_database.csv",
        base_dir / "association_plants_database.csv",
        base_dir / "Plants_Data_Collection__Responses_.xlsx_-_Form_Responses_1_293b71cd.csv",
    ]
    csv_path = next((p for p in candidate_csvs if p.exists()), None)
    if csv_path:
        try:
            records: list[dict[str, Any]] = []
            with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    col_sel = (row.get("اختر المحصول") or "").strip()
                    col_other = (row.get("إذا كانت إجابة السؤال السابق أخرى، من فضلك حدد المحصول") or "").strip()
                    raw_name = col_sel if col_sel and col_sel not in ("أخرى", "اخري") else col_other
                    if len(raw_name) < 2:
                        continue
                    importance = (row.get("حدد القيمة الاقتصادية أو اهمية المحصول") or "").strip()
                    env = (row.get("حدد الاحتياجات البيئية للمحصول (نوع التربة - الضوء - الحرارة - الرطوبة)؟") or "").strip()
                    seeds = (row.get("بالنسبة للبذور وتقاوي الزراعة (ما كمية البذور والشتلات للفدان - طرق ومواعيد النقل)؟") or "").strip()
                    prac = (row.get("حدد الممارسات الزراعية المطلوبة (تحضير الارض قبل الزراعة - ممارسات اثناء الزراعة)؟") or "").strip()
                    irr = (row.get("الري (طرق الري وتكلفتها - مواعيد الري - الاحتياجات المائية - الملوحة)؟") or "").strip()
                    fert = (row.get("حدد التسميد (الكمبوست - اماكن شراء المنتجات)؟") or "").strip()
                    pest = (row.get("طرق الوقاية والمكافحة (الافات والامراض المحتملة - الوقاية - المكافحة - الحشائش)؟") or "").strip()
                    harv = (row.get("ما هي طرق ومواعيد الحصاد؟") or "").strip()
                    post = (row.get("اذكر معاملات بعد الحصاد (النقل - التخزين)؟") or "").strip()
                    extra = (row.get("معلومات إضافية") or "").strip()
                    if not any(len(v) > 2 for v in (importance, env, seeds, prac, irr, fert, pest, harv, post, extra)):
                        continue
                    ov = CLEAN_NAME_OVERRIDES.get(raw_name, {})
                    clean_name = ov.get("display", raw_name)
                    aliases = ov.get("aliases", [])
                    cat = normalize_category(row.get("نوع المحصول") or "")
                    records.append(
                        _build_plant_record(
                            idx=len(records) + 1,
                            name=clean_name,
                            raw_name=raw_name,
                            category=cat,
                            aliases=aliases,
                            importance=importance,
                            environment=env,
                            seeds_and_nursery=seeds,
                            agricultural_practices=prac,
                            irrigation=irr,
                            fertilization=fert,
                            pest_and_disease_control=pest,
                            harvest=harv,
                            post_harvest=post,
                            extra_notes=extra,
                        )
                    )
            if records:
                logger.info("Loaded %d crops from %s", len(records), csv_path)
                return records
        except Exception as exc:
            logger.warning("CSV crop load warning (%s); falling back to embedded 67 crops.", exc)

    embedded = [
        _build_plant_record(
            idx=i,
            name=row[0],
            raw_name=row[1],
            category=row[2],
            aliases=row[3],
            environment=row[4],
            seeds_and_nursery=row[5],
            irrigation=row[6],
            fertilization=row[7],
            pest_and_disease_control=row[8],
            harvest=row[9],
        )
        for i, row in enumerate(EMBEDDED_CROPS_TUPLES, start=1)
    ]
    logger.info("Loaded %d crops from embedded catalog.", len(embedded))
    return embedded


PLANTS_DB = load_plants_database()


# ---------------------------------------------------------------------------
# Crop Search, Fuzzy Suggestions, Extra Crops & Smart Recommendation Scoring
# ---------------------------------------------------------------------------
KNOWN_EXTRA_ARABIC_CROPS = [
    "مانجو", "مانجا", "زيتون", "نخيل", "نخل", "بلح", "تمر", "بصل", "ثوم", "توم",
    "خيار", "باميه", "قلقاس", "سبانخ", "جرجير", "لوبيا", "ترمس", "سمسم", "قصب",
    "موز", "برتقال", "يوسفي", "ليمون", "موالح", "تين", "تين شوكي", "خوخ", "برقوق",
    "كاكي", "كيوي", "افوكادو", "توت", "زعتر", "بردقوش", "شمر", "شيح", "حبق",
    "صبار", "الوفيرا", "ازولا", "بونيكام", "برسيم حجازي", "دخن", "كانولا",
    "قرنبيط", "بروكلي", "بطيخ", "شمام", "كنتالوب", "خردل", "زنجبيل", "كركم",
]


def find_matching_plants(query: str, max_matches: int = 2) -> list[dict[str, Any]]:
    cleaned = re.sub(r"^نعم[،,\s]+", "", query.strip())
    norm_q = normalize_arabic_for_match(cleaned)
    if not norm_q:
        return []
    stripped_q = strip_al_prefix(norm_q)
    padded_norm = f" {norm_q} "
    padded_stripped = f" {stripped_q} "

    for p in PLANTS_DB:
        if (
            normalize_arabic_for_match(p["name"]) == norm_q
            or normalize_arabic_for_match(p["raw_name"]) == norm_q
            or norm_q in p["search_keys"]
            or stripped_q in p["search_keys"]
        ):
            return [p]

    candidates: list[tuple[int, dict[str, Any]]] = []
    for p in PLANTS_DB:
        best_len = 0
        for key in p["search_keys"]:
            if len(key) < 2:
                continue
            if f" {key} " in padded_norm or f" {key} " in padded_stripped:
                if len(key) > best_len:
                    best_len = len(key)
        if best_len > 0:
            candidates.append((best_len, p))
    candidates.sort(key=lambda x: x[0], reverse=True)
    return [c[1] for c in candidates[:max_matches]]


def find_fuzzy_plant_suggestion(query: str) -> dict[str, Any] | None:
    norm_q = strip_al_prefix(normalize_arabic_for_match(query))
    if not norm_q or len(norm_q) < 3 or len(norm_q.split()) > 3:
        return None
    best_plant = None
    best_dist = 99
    for p in PLANTS_DB:
        for key in p["search_keys"]:
            sk = strip_al_prefix(key)
            if len(sk) < 3:
                continue
            dist = levenshtein_distance(norm_q, sk)
            max_allowed = 2 if len(sk) >= 6 else 1
            if dist <= max_allowed and dist < best_dist:
                best_dist = dist
                best_plant = p
    return best_plant


def detect_extra_arabic_crop(raw: str, norm: str) -> str | None:
    stripped = strip_al_prefix(norm)
    padded = f" {norm} "
    padded_stripped = f" {stripped} "
    for extra in KNOWN_EXTRA_ARABIC_CROPS:
        ne = normalize_arabic_for_match(extra)
        if norm == ne or stripped == ne or f" {ne} " in padded or f" {ne} " in padded_stripped:
            return raw.strip() if len(norm.split()) <= 2 else extra
    return None


def score_crops_for_land(combined_notes: str, top_n: int = 6) -> list[dict[str, Any]]:
    n = normalize_arabic_for_match(combined_notes)
    wants_sandy = any(norm_has(n, t) for t in ("رملي", "رمل", "صحراو", "خفيف", "مستصلح"))
    wants_clay = any(norm_has(n, t) for t in ("طيني", "طين", "ثقيل", "طميي", "صفراء"))
    wants_calc = norm_has(n, "جيري") or norm_has(n, "كلسي")
    has_salinity = any(norm_has(n, t) for t in ("ملوح", "ملح", "ابار", "بئر", "ارتوازي"))
    wants_winter = any(norm_has(n, t) for t in ("شتاء", "شتوي", "خريف", "سبتمبر", "اكتوبر", "نوفمبر", "ديسمبر"))
    wants_summer = any(norm_has(n, t) for t in ("صيف", "صيفي", "ربيع", "فبراير", "مارس", "ابريل", "مايو", "يونيو"))
    wants_drip = norm_has(n, "تنقيط")
    wants_flood = norm_has(n, "غمر")
    wants_sprinkler = norm_has(n, "رش") or norm_has(n, "محوري")
    wants_med = norm_has(n, "طبي") or norm_has(n, "عطري") or norm_has(n, "تصدير")
    wants_veg = norm_has(n, "خضار") or norm_has(n, "خضروات") or norm_has(n, "سريع")
    wants_field = norm_has(n, "حقلي") or norm_has(n, "حبوب") or norm_has(n, "علف")
    wants_trees = norm_has(n, "فاكهه") or norm_has(n, "اشجار") or norm_has(n, "شجر") or norm_has(n, "مستديم")

    scored: list[tuple[int, dict[str, Any]]] = []
    for p in PLANTS_DB:
        score = 0
        env_n = normalize_arabic_for_match(p.get("environment", "") + " " + p.get("extra_notes", ""))
        seed_n = normalize_arabic_for_match(p.get("seeds_and_nursery", "") + " " + p.get("environment", ""))
        irr_n = normalize_arabic_for_match(p.get("irrigation", "") + " " + p.get("environment", ""))
        cat_n = normalize_arabic_for_match(p.get("category", ""))

        if wants_sandy:
            if any(norm_has(env_n, t) for t in ("رملي", "خفيف", "صحراو", "مستصلح")):
                score += 10
            if normalize_arabic_for_match(p["name"]) == normalize_arabic_for_match("الأرز"):
                score -= 12
        if wants_clay and any(norm_has(env_n, t) for t in ("طيني", "طميي", "صفراء", "خصب")):
            score += 10
        if wants_calc and (norm_has(env_n, "جيري") or norm_has(env_n, "كلسي")):
            score += 10
        if has_salinity:
            if any(norm_has(irr_n, t) for t in ("حساس للملوح", "عدا الملوح", "بدون ملوح")):
                score -= 12
            elif any(norm_has(env_n + " " + irr_n, t) for t in ("ملوح", "يتحمل الملوح", "متحمل للملوح")):
                score += 12
        if wants_winter:
            if any(norm_has(seed_n + " " + env_n, t) for t in ("شتوي", "شتاء", "سبتمبر", "اكتوبر", "نوفمبر")):
                score += 14
            elif any(norm_has(seed_n + " " + env_n, t) for t in ("فبراير", "مارس", "صيفي")):
                score -= 8
        if wants_summer:
            if any(norm_has(seed_n + " " + env_n, t) for t in ("صيفي", "صيف", "ربيع", "ابريل", "مايو")):
                score += 14
            elif any(norm_has(seed_n + " " + env_n, t) for t in ("اكتوبر", "نوفمبر", "شتوي")):
                score -= 8
        if wants_drip and norm_has(irr_n, "تنقيط"):
            score += 7
        if wants_flood and norm_has(irr_n, "غمر"):
            score += 7
        if wants_sprinkler and norm_has(irr_n, "رش"):
            score += 7
        if wants_med and norm_has(cat_n, "طبيه"):
            score += 10
        if wants_veg and norm_has(cat_n, "خضروات"):
            score += 10
        if wants_field and norm_has(cat_n, "حقليه"):
            score += 10
        if wants_trees and norm_has(cat_n, "فاكهه"):
            score += 11
        scored.append((score, p))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [s[1] for s in scored[:top_n]]


# ---------------------------------------------------------------------------
# Intent Detection & Guided Flow Engine (Language, Registration, Crops, Topics)
# ---------------------------------------------------------------------------
def is_meaningful_agri_query(raw: str, norm: str) -> bool:
    if not norm or len(norm) < 3 or not any(ch.isalpha() for ch in raw):
        return False
    low = raw.lower()
    ar_kw = (
        "زراع", "محصول", "نبات", "ارض", "ترب", "ري", "ميه", "مياه", "ملوح", "تسميد", "سماد",
        "كمبوست", "شاي", "فوسفات", "فلسبار", "كبريت", "حيوي", "عضوي", "اورجانيك", "افه", "حشر",
        "فطر", "مرض", "اصاب", "علاج", "مكافح", "وقاي", "رش", "دود", "من", "ذباب", "عنكبوت",
        "تربس", "نيماتودا", "بياض", "ذبول", "عفن", "اصفرار", "حشائش", "تقاوي", "بذور", "شتل",
        "حصاد", "فدان", "شجر", "ورق", "جذور", "ثمار", "نيم", "بوتاسي", "ترايكوديرما", "باسيلس",
        "طقس", "حراره", "موقع", "فستق", "بولونيا", "تنين", "دراجون", "افوكادو", "كيوي",
    )
    if any(k in norm for k in ar_kw):
        return True
    multi_kw = (
        "organic", "biodynamic", "agriculture", "farming", "crop", "plant", "soil", "fertiliz",
        "compost", "pest", "disease", "fungus", "harvest", "irrigation", "seed", "tomato", "wheat",
        "demeter", "carbon", "ebda", "ökolandbau", "ökologisch", "landwirtschaft", "pflanze",
        "boden", "kompost", "schädling", "bewässerung", "ernte",
    )
    if any(k in low for k in multi_kw):
        return True
    words = [w for w in norm.split() if len(w) >= 2]
    latin_words = [w for w in low.split() if len(w) >= 2]
    return len(words) >= 2 or len(latin_words) >= 3


def is_pure_greeting(norm: str) -> bool:
    return norm in {
        "السلام عليكم", "سلام عليكم", "وعليكم السلام", "اهلا", "اهلا بيك", "اهلا وسهلا",
        "مرحبا", "صباح الخير", "مساء الخير", "ازيك", "هاي", "hello", "hi",
    }


def detect_selected_language(raw: str) -> str | None:
    l = raw.lower().strip()
    if "عربية" in l or "عربي" in l or "arabic" in l or l == "1" or "🇪🇬" in l:
        return "ar"
    if "english" in l or "انجليزي" in l or "إنجليزي" in l or l == "en" or l == "2" or "🇬🇧" in l:
        return "en"
    if "deutsch" in l or "german" in l or "الماني" in l or "ألماني" in l or l == "de" or l == "3" or "🇩🇪" in l:
        return "de"
    return None


def get_crop_diagnostic_choices(plant_name: str) -> list[str]:
    return [
        "إصابة حشرية في المحصول",
        "إصابة فطرية أو أعفان",
        "ضعف نمو أو تسميد حيوي",
        "مشكلة في الري أو الملوحة",
        "مشكلة حشائش في الأرض",
        OTHER_CROP_TOPIC_LABEL,
        f"دليل زراعة {plant_name}",
        "اختيار محصول آخر",
        "القائمة الرئيسية",
    ]


def get_crop_guide_choices() -> list[str]:
    return [
        *[t["buttonLabel"] for t in TOR_SEVEN_TOPICS],
        OTHER_CROP_TOPIC_LABEL,
        "اختيار محصول آخر",
        "القائمة الرئيسية",
    ]


def build_plant_topic_answer(plant: dict[str, Any], topic_id: str) -> str:
    name = plant["name"]
    if topic_id == "env":
        return f"**1. الاحتياجات البيئية لمحصول {name}:**\n\n" + (
            plant.get("environment") or "يجود في الأراضي جيدة الصرف والتهوية المخدومة بالكمبوست مع إضاءة شمسية كافية."
        )
    if topic_id == "seeds":
        return f"**2. البذور والشتلات وتجهيز الأرض لمحصول {name}:**\n\n" + (
            (plant.get("seeds_and_nursery") or "")
            + ("\n\n" + plant["agricultural_practices"] if plant.get("agricultural_practices") else "")
            or "استخدام تقاوي نظيفة غير معاملة كيماوياً وتجهيز الأرض بالكمبوست وصخر الفوسفات والفلسبار."
        ).strip()
    if topic_id == "irrigation":
        return f"**3. الري والملوحة لمحصول {name}:**\n\n" + (
            plant.get("irrigation") or "يفضل الري بالتنقيط المنتظم لتوفير المياه وتجنب الملوحة المرتفعة والأعفان."
        )
    if topic_id == "fertilization":
        return (
            f"**4. التسميد العضوي والحيوي لمحصول {name}:**\n\n"
            + (plant.get("fertilization") or "إضافة 15 م³ كمبوست تام التحلل للفدان مع صخر فوسفات وفلسبار وشاي الكمبوست.")
            + "\n\n**أماكن شراء المدخلات المعتمدة:** الجمعية المصرية للزراعة الحيوية (EBDA)، مزارع سيكم، ومنافذ مركز البحوث الزراعية (ARC)."
        )
    if topic_id == "biocontrol":
        return f"**5. المكافحة الحيوية والحشائش لمحصول {name}:**\n\n" + (
            plant.get("pest_and_disease_control")
            or "مصائد فرمونية ولونية، زيت النيم والصابون البوتاسي، باسيلس Bt، وترايكوديرما بدون أي كيماويات."
        )
    if topic_id == "harvest":
        return f"**6. طرق ومواعيد الحصاد لمحصول {name}:**\n\n" + (
            plant.get("harvest") or "يتم الحصاد صباحاً بعد تطاير الندى باستخدام أدوات وعبوات نظيفة مخصصة للأورجانيك."
        )
    return (
        f"**7. معاملات ما بعد الحصاد والتسويق لمحصول {name}:**\n\n"
        + (plant.get("post_harvest") or "الفرز والتدريج، النقل المفصول، التخزين الجاف الآمن بدون فوسفين، والتسويق عبر شبكة EBDA وشهادتي EoL وDEMETER.")
    )


def build_deterministic_plant_fallback(plant: dict[str, Any], query: str) -> str:
    q = normalize_arabic_for_match(query)
    parts = [f"بخصوص محصول **{plant['name']}**:"]
    if any(k in q for k in ("حشر", "فطر", "اعفان", "عفن", "افه", "مرض", "مكافح", "دود", "بياض", "ذبول")):
        if plant.get("pest_and_disease_control"):
            parts.append(f"**المكافحة الحيوية المعتمدة:**\n{plant['pest_and_disease_control']}")
    elif any(k in q for k in ("تسميد", "سماد", "كمبوست", "ضعف", "اصفرار")):
        if plant.get("fertilization"):
            parts.append(f"**التسميد العضوي والحيوي:**\n{plant['fertilization']}")
    elif any(k in q for k in ("ري", "مياه", "ملوح", "ترب")):
        if plant.get("irrigation"):
            parts.append(f"**الري والملوحة:**\n{plant['irrigation']}")
        if plant.get("environment"):
            parts.append(f"**البيئة والتربة:**\n{plant['environment']}")
    elif any(k in q for k in ("تقاوي", "بذور", "شتل", "ميعاد", "زراع")):
        if plant.get("seeds_and_nursery"):
            parts.append(f"**التقاوي وميعاد الزراعة:**\n{plant['seeds_and_nursery']}")
    elif any(k in q for k in ("حصاد", "جمع", "تخزين")):
        if plant.get("harvest"):
            parts.append(f"**الحصاد:**\n{plant['harvest']}")
    if len(parts) == 1:
        for k, lbl in (("environment", "التربة والمناخ"), ("seeds_and_nursery", "التقاوي"), ("fertilization", "التسميد الحيوي"), ("irrigation", "الري"), ("pest_and_disease_control", "المكافحة الحيوية")):
            if plant.get(k):
                parts.append(f"**{lbl}:** {plant[k]}")
    return "\n\n".join(parts)


REG_LAND_CHOICES = [
    "أقل من 5 فدان - ري غمر",
    "أقل من 5 فدان - ري تنقيط",
    "5 إلى 15 فدان - ري تنقيط",
    "أكثر من 15 فدان - تنقيط أو رش",
    "أرض جديدة تحت التجهيز",
    "أخرى (اكتب المساحة والري)",
    "رجوع لتعديل المحافظة",
    "القائمة الرئيسية",
]

REG_CROPS_CHOICES = [
    "خضروات",
    "نباتات طبية وعطرية",
    "محاصيل حقلية وعلف",
    "أشجار فاكهة",
    "محاصيل متنوعة",
    "أخرى (اكتب المحاصيل)",
    "رجوع لتعديل المساحة والري",
    "القائمة الرئيسية",
]

REG_SUPPORT_CHOICES = [
    "شامل (نصائح + تدريبات + متابعة)",
    "حضور تدريبات عملية للمزارعين",
    "نصائح وإرشاد زراعي حيوي",
    "تحويل الأرض للزراعة الحيوية",
    "أخرى (اكتب طلبك)",
    "رجوع لتعديل المحاصيل",
    "القائمة الرئيسية",
]


def evaluate_flow_turn(
    user_message: str,
    current_flow: dict[str, Any] | None,
    session_id: str,
    channel: str,
    registrations_count: int,
    has_prior_messages: bool,
) -> dict[str, Any]:
    raw = (user_message or "").strip()
    norm = normalize_arabic_for_match(raw)
    flow = dict(current_flow or {"mode": "idle"})
    low = raw.lower().strip()

    def instant(answer: str, replies: list[str], next_state: dict[str, Any], completed_reg: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "kind": "instant",
            "answer": answer,
            "quick_replies": replies[:10],
            "next_flow_state": next_state,
            "completed_registration": completed_reg,
        }

    # 0. Language switcher
    if any(k in low for k in ("تغيير اللغة", "تغير اللغه", "change language", "sprache ändern", "select language")):
        return instant(LANGUAGE_SELECTION_PROMPT, LANGUAGE_OPTIONS, {"mode": "select_language", "language": flow.get("language")})

    lang_choice = detect_selected_language(raw)
    if lang_choice and (flow.get("mode") == "select_language" or (not flow.get("language") and not has_prior_messages)):
        welcomes = {
            "en": "Welcome to the **Egyptian BioDynamic Association (EBDA)** & **Economy of Love (EoL)**! 🌿\n\nPlease choose a service below or send a plant photo / question:",
            "de": "Herzlich willkommen bei der **Egyptian BioDynamic Association (EBDA)** & **Economy of Love (EoL)**! 🌿\n\nBitte wählen Sie einen Dienst aus oder senden Sie ein Pflanzenfoto:",
            "ar": "أهلاً وسهلاً بحضرتك في **الجمعية المصرية للزراعة الحيوية (EBDA)** ومبادرة **اقتصاد المحبة (Economy of Love)**! 🌿\n\nندعم المزارعين في الزراعة العضوية والحيوية وشهادات الكربون وديميتر.\nاختر الخدمة المطلوبة من القائمة بالأسفل، أو أرسل سؤالك أو صورة النبات مباشرة:",
        }
        return instant(welcomes[lang_choice], get_language_menu_suggestions(lang_choice), {"mode": "idle", "language": lang_choice})

    if flow.get("mode") == "select_language" or (not flow.get("language") and not has_prior_messages):
        if is_pure_greeting(norm):
            return instant(LANGUAGE_SELECTION_PROMPT, LANGUAGE_OPTIONS, {"mode": "select_language"})
        # Default directly to Arabic if farmer starts immediately with an actual agricultural question or image
        flow["language"] = "ar"

    lang = flow.get("language") or "ar"

    # 1. Global Main Menu reset
    if norm_in(norm, ["القائمة الرئيسية", "رجوع للقائمة الرئيسية", "إلغاء", "بداية جديدة", "قائمة رئيسية"]) or low in ("main menu", "hauptmenü", "home", "menu"):
        prompts = {
            "en": "Please choose a service from the menu below, or type your question directly:",
            "de": "Bitte wählen Sie einen Dienst aus dem Menü oder stellen Sie direkt Ihre Frage:",
            "ar": "اختر الخدمة المطلوبة من القائمة بالأسفل، أو اكتب سؤالك أو أرسل صورة أو موقع مزرعتك مباشرة:",
        }
        return instant(prompts[lang], get_language_menu_suggestions(lang), {"mode": "idle", "language": lang})

    # Helper back check
    def is_back(n: str) -> bool:
        return norm_in(n, ["رجوع", "السابق", "الخطوة السابقة"]) or n.startswith(normalize_arabic_for_match("رجوع لتعديل")) or n in ("back", "zuruck")

    # 2. Top-level Registration Intent
    reg_triggers = ["تسجيل في الجمعية", "تسجيل في الجمعية (EBDA)", "التسجيل في الجمعية", "تسجيل عضوية", "register with ebda", "registrierung bei ebda"]
    if (raw == "1" or norm_in(norm, reg_triggers)) and flow.get("mode") != "register":
        msg = {
            "en": "Welcome to **EBDA & Economy of Love** Farmer Registration.\n\n**Step 1 of 6:** Please type your **Full Name**:",
            "de": "Willkommen bei der **EBDA**-Registrierung.\n\n**Schritt 1 von 6:** Bitte geben Sie Ihren **vollständigen Namen** ein:",
            "ar": "يسعدنا انضمامك لعضوية **الجمعية المصرية للزراعة الحيوية (EBDA)** ومعايير **اقتصاد المحبة (EoL)**.\n\n**الخطوة 1 من 6:** من فضلك اكتب **الاسم الثلاثي بالكامل**:",
        }[lang]
        return instant(msg, ["القائمة الرئيسية"], {"mode": "register", "step": "ask_name", "draft": {}, "language": lang})

    # 3. About EBDA & EoL
    about_triggers = ["عن الجمعية واقتصاد المحبة", "عن الجمعية", "ما هي الجمعية؟", "about ebda", "über ebda"]
    if (raw == "2" or norm_in(norm, about_triggers)) and flow.get("mode") != "register":
        return instant(
            "**الجمعية المصرية للزراعة الحيوية (EBDA):**\n"
            "منظمة غير حكومية مسجلة بوزارة التضامن الاجتماعي منذ **1990** لتعزيز الزراعة العضوية والحيوية في مصر.\n\n"
            "- **شهادة اقتصاد المحبة (EoL) وعلامة ديميتر (DEMETER):** دعم المزارعين ضد التغير المناخي (شهادات الكربون Carbon Credits) وفتح التصدير للمنتجات العضوية.\n"
            "- **الشراكة الألمانية-المصرية (SI/EoL):** بتمويل **BMZ** وتنفيذ **bbw gGmbH** و**sequa gGmbH**.\n"
            "- **خدماتنا:** تسجيل المزارع، تدريبات عملية، إرشاد فني للتفتيش الدولي، وقاعدة بيانات **67+ محصولاً**.",
            ["تسجيل في الجمعية (EBDA)", "موضوعات الزراعة العضوية", "الأسئلة الشائعة (FAQs)", "القائمة الرئيسية"],
            {"mode": "about", "language": lang},
        )

    # 4. Topics Hub & FAQs
    if (raw == "3" or norm_in(norm, ["موضوعات الزراعة العضوية", "مواضيع الزراعة العضوية", "organic farming topics", "themen des ökolandbaus"])) and flow.get("mode") != "register":
        return instant(
            "**موضوعات الزراعة العضوية والحيوية (7 محاور أساسية):**\nتحب تستعرضها **بشكل عام** ولا **مخصصة لمحصول معين**؟",
            ["إرشادات عامة للزراعة العضوية", "توصيات موضوعات لمحصول محدد", "القائمة الرئيسية"],
            {"mode": "topics_hub", "step": "choose_topic_scope", "language": lang},
        )

    if norm_in(norm, ["إرشادات عامة للزراعة العضوية", "رجوع للموضوعات العامة"]) and flow.get("mode") != "register":
        return instant(
            "**الإرشادات العامة لموضوعات الزراعة العضوية:** اختر الموضوع لعرض تفاصيله:",
            [*[t["buttonLabel"] for t in TOR_SEVEN_TOPICS], "توصيات موضوعات لمحصول محدد", "القائمة الرئيسية"],
            {"mode": "topics_hub", "step": "select_general_topic", "language": lang},
        )

    def faq_page(pg: int) -> dict[str, Any]:
        safe_pg = 1 if pg == 1 else 0
        sl = TOR_ELEVEN_FAQS[:6] if safe_pg == 0 else TOR_ELEVEN_FAQS[6:11]
        reps = [f["buttonLabel"] for f in sl]
        if safe_pg == 0:
            reps += ["عرض باقي الأسئلة الشائعة (7–11)", "القائمة الرئيسية"]
        else:
            reps += ["رجوع للأسئلة الشائعة (1–6)", "تسجيل في الجمعية (EBDA)", "القائمة الرئيسية"]
        return instant(f"**الأسئلة الشائعة (صفحة {safe_pg + 1} من 2):** اختر السؤال لعرض الإجابة:", reps, {"mode": "faq", "step": "browse_faqs", "faq_page": safe_pg, "language": lang})

    if (raw == "4" or norm_in(norm, ["الأسئلة الشائعة (FAQs)", "الأسئلة الشائعة", "frequently asked questions", "häufig gestellte fragen"])) and flow.get("mode") != "register":
        return faq_page(0)
    if norm_in(norm, ["عرض باقي الأسئلة الشائعة (7–11)", "عرض باقي الأسئلة الشائعة"]) and flow.get("mode") != "register":
        return faq_page(1)
    if norm_in(norm, ["رجوع للأسئلة الشائعة (1–6)", "رجوع للأسئلة الشائعة"]) and flow.get("mode") != "register":
        return faq_page(0)

    if flow.get("mode") != "register":
        clicked_faq = next((f for f in TOR_ELEVEN_FAQS if norm_eq(norm, f["buttonLabel"])), None)
        if clicked_faq:
            ret_btn = "رجوع للأسئلة الشائعة (1–6)" if clicked_faq["number"] <= 6 else "عرض باقي الأسئلة الشائعة (7–11)"
            return instant(clicked_faq["answerArabic"], [ret_btn, "تسجيل في الجمعية (EBDA)", OTHER_GENERAL_OPTION_LABEL, "القائمة الرئيسية"], {"mode": "faq", "step": "browse_faqs", "language": lang})

    def crop_entry(submode: str, pending_topic_id: str | None = None) -> dict[str, Any]:
        intro = (
            "اختر **قسم المحصول** لعرض دليل زراعته الكامل (67 محصولاً)، أو **اكتب اسم المحصول مباشرة**:"
            if submode == "guide"
            else "اختر **قسم المحصول** الذي به المشكلة، أو **اكتب اسم المحصول مباشرة** في الرسالة:"
        )
        return instant(
            intro,
            [*[c["label"] for c in CROP_CATEGORY_CHOICES], OTHER_PLANT_OPTION_LABEL, "القائمة الرئيسية"],
            {"mode": "crop_flow", "step": "select_crop_category", "crop_submode": submode, "pending_topic_id": pending_topic_id, "language": lang},
        )

    if norm_eq(norm, "تطبيق هذا الموضوع على محصول محدد") and flow.get("pending_topic_id"):
        return crop_entry("guide", flow.get("pending_topic_id"))

    if flow.get("mode") in ("topics_hub", "idle", "about"):
        topic = next((t for t in TOR_SEVEN_TOPICS if norm_eq(norm, t["buttonLabel"])), None)
        if topic:
            return instant(
                topic["generalGuideArabic"],
                ["تطبيق هذا الموضوع على محصول محدد", "رجوع للموضوعات العامة", OTHER_GENERAL_OPTION_LABEL, "القائمة الرئيسية"],
                {"mode": "topics_hub", "step": "select_general_topic", "pending_topic_id": topic["id"], "language": lang},
            )

    if norm_eq(norm, "توصيات موضوعات لمحصول محدد") or raw == "7" or norm_in(norm, ["دليل زراعة محصول كامل", "دليل زراعة محصول", "complete organic crop guide"]):
        return crop_entry("guide")
    if raw == "5" or norm_in(norm, ["هل توجد مشكلة في محصول؟", "اختيار محصول آخر", "رجوع لأقسام المحاصيل", "crop problem or pest control"]):
        return crop_entry("problem")

    # 5. Open Organic AI Trigger
    if (raw == "8" or norm_in(norm, [OTHER_GENERAL_OPTION_LABEL, "أخرى", "سؤال آخر"])) and flow.get("mode") not in ("register", "crop_flow"):
        return instant("تفضل بكتابة سؤالك", ["القائمة الرئيسية"], {"mode": "general_ai", "step": "open_organic_ai", "language": lang})

    # 6. Smart Crop Recommendation Trigger
    rec_phrases = ("ترشيح أنسب محصول", "انسب محصول", "ازرع ايه", "ترشحلي", "رشحلي", "recommend best crop")
    if (raw == "6" or any(p in norm or p in low for p in rec_phrases)) and flow.get("mode") != "register":
        flow = {"mode": "smart_advisor", "step": "gather", "notes": [], "turns": 0, "language": lang}

    # -----------------------------------------------------------------------
    # JOURNEY 1: 6-Step Registration Flow with Review & Edit
    # -----------------------------------------------------------------------
    if flow.get("mode") == "register":
        draft = dict(flow.get("draft") or {})
        step = flow.get("step")
        ret_rev = bool(flow.get("return_to_review"))

        def build_review() -> dict[str, Any]:
            full_loc = f"{draft.get('governorate', '-')} ({draft['location_detail']})" if draft.get("location_detail") else draft.get("governorate", "-")
            summary = (
                "يرجى مراجعة بيانات التسجيل في **الجمعية المصرية للزراعة الحيوية** قبل الحفظ النهائي:\n\n"
                f"- **الاسم:** {draft.get('full_name', '-')}\n"
                f"- **رقم التليفون:** {draft.get('phone', '-')}\n"
                f"- **المحافظة الرسمية:** {full_loc}\n"
                f"- **المساحة ونظام الري:** {draft.get('land_and_irrigation', '-')}\n"
                f"- **المحاصيل:** {draft.get('crops', '-')}\n"
                f"- **الدعم المطلوب:** {draft.get('support_needed', '-')}\n\n"
                "اضغط **«تأكيد وإرسال التسجيل»** لإتمام التسجيل، أو اختر أي بيان لتعديله:"
            )
            return instant(
                summary,
                ["تأكيد وإرسال التسجيل", "تعديل رقم التليفون", "تعديل المحافظة", "تعديل الاسم", "تعديل المساحة والري", "تعديل المحاصيل", "القائمة الرئيسية"],
                {"mode": "register", "step": "review_registration", "draft": draft, "language": lang},
            )

        def reg_region_replies() -> list[str]:
            return [*[r["label"] for r in GOVERNORATE_REGIONS], "رجوع لتعديل التليفون", "القائمة الرئيسية"]

        if step == "ask_name":
            if ret_rev and is_back(norm):
                return build_review()
            cleaned_name = re.sub(r"\s+", " ", raw).strip()
            letter_words = [w for w in cleaned_name.split() if len(w) >= 2 and all(ch.isalpha() for ch in w)]
            if any(ch.isdigit() for ch in cleaned_name) or len(letter_words) < 2 or len(cleaned_name) < 5:
                return instant("عذراً، يرجى كتابة **الاسم الثنائي أو الثلاثي بالكامل** بالحروف فقط (مثال: محمد أحمد علي):", ["القائمة الرئيسية"], flow)
            draft["full_name"] = cleaned_name
            if ret_rev:
                return build_review()
            return instant(
                f"تشرفنا بحضرتك أ/ **{cleaned_name}**.\n\n**الخطوة 2 من 6:** اكتب **رقم الموبايل / الواتساب** مكوناً من **11 رقماً** (مثال: `01012345678`):",
                ["رجوع لتعديل الاسم", "القائمة الرئيسية"],
                {"mode": "register", "step": "ask_phone", "draft": draft, "language": lang},
            )

        if step == "ask_phone":
            if ret_rev and norm == "رجوع للمراجعه":
                return build_review()
            if is_back(norm) or norm == "رجوع لتعديل الاسم":
                return instant("**الخطوة 1 من 6:** أعد كتابة **الاسم الثلاثي بالكامل**:", ["القائمة الرئيسية"], {"mode": "register", "step": "ask_name", "draft": draft, "return_to_review": ret_rev, "language": lang})
            pcheck = validate_egyptian_phone(raw)
            if not pcheck["valid"]:
                return instant(pcheck["error"], ["رجوع لتعديل الاسم", "القائمة الرئيسية"], flow)
            draft["phone"] = pcheck["formatted"]
            draft["phone_e164"] = pcheck["e164"]
            if ret_rev:
                return build_review()
            return instant(
                f"تم التحقق من الرقم (**{draft['phone']}**).\n\n**الخطوة 3 من 6:** اكتب **اسم المحافظة** مباشرة، أو اختر الإقليم:",
                reg_region_replies(),
                {"mode": "register", "step": "ask_location", "draft": draft, "language": lang},
            )

        if step == "ask_location":
            if norm in ("رجوع لتعديل التليفون", "رجوع لتعديل رقم التليفون"):
                return instant("**الخطوة 2 من 6:** أعد كتابة **رقم الموبايل (11 رقماً)**:", ["رجوع لتعديل الاسم", "القائمة الرئيسية"], {"mode": "register", "step": "ask_phone", "draft": draft, "return_to_review": ret_rev, "language": lang})
            if norm == "رجوع لاقاليم المحافظات":
                return instant("**الخطوة 3 من 6:** اكتب اسم المحافظة أو اختر الإقليم:", reg_region_replies(), {"mode": "register", "step": "ask_location", "draft": draft, "return_to_review": ret_rev, "language": lang})
            picked_reg = next((r for r in GOVERNORATE_REGIONS if norm_eq(norm, r["label"])), None)
            if picked_reg:
                govs = [g["name"] for g in EGYPT_GOVERNORATES if g["region_id"] == picked_reg["id"]]
                return instant(f"**{picked_reg['label']}:** اختر المحافظة أو اكتب اسمها:", [*govs, "رجوع لأقاليم المحافظات", "رجوع لتعديل التليفون"], {"mode": "register", "step": "ask_location", "draft": draft, "return_to_review": ret_rev, "language": lang})
            gmatch = match_egyptian_governorate(raw)
            if gmatch["status"] == "matched":
                draft["governorate"] = gmatch["governorate"]
                draft["location_detail"] = gmatch.get("detail")
                if ret_rev:
                    return build_review()
                return instant(
                    f"تم تسجيل المحافظة: **{draft['governorate']}**.\n\n**الخطوة 4 من 6:** اختر أو اكتب **مساحة الأرض ونظام الري**:",
                    REG_LAND_CHOICES,
                    {"mode": "register", "step": "ask_land", "draft": draft, "language": lang},
                )
            if gmatch["status"] == "fuzzy_confirm":
                return instant(
                    f"هل تقصد محافظة **{gmatch['suggested']}**؟",
                    [f"نعم، {gmatch['suggested']}", "إعادة اختيار المحافظة", "رجوع لتعديل التليفون"],
                    {"mode": "register", "step": "confirm_fuzzy_gov", "pending_gov": gmatch["suggested"], "draft": draft, "return_to_review": ret_rev, "language": lang},
                )
            return instant("لم نتعرف على اسم المحافظة. اكتب اسم المحافظة المصرية بوضوح (مثال: البحيرة، المنيا، الفيوم) أو اختر الإقليم:", reg_region_replies(), flow)

        if step == "confirm_fuzzy_gov":
            if norm in ("اعاده اختيار المحافظه", "لا"):
                return instant("اكتب اسم المحافظة أو اختر الإقليم:", reg_region_replies(), {"mode": "register", "step": "ask_location", "draft": draft, "return_to_review": ret_rev, "language": lang})
            confirmed = flow.get("pending_gov") if norm.startswith("نعم") else match_egyptian_governorate(raw).get("governorate")
            if confirmed:
                draft["governorate"] = confirmed
                draft["location_detail"] = None
                if ret_rev:
                    return build_review()
                return instant(f"تم تأكيد المحافظة: **{confirmed}**.\n\n**الخطوة 4 من 6:** اختر أو اكتب **مساحة الأرض ونظام الري**:", REG_LAND_CHOICES, {"mode": "register", "step": "ask_land", "draft": draft, "language": lang})
            return instant("اختر الإقليم أو اكتب اسم المحافظة:", reg_region_replies(), {"mode": "register", "step": "ask_location", "draft": draft, "language": lang})

        if step == "ask_land":
            if norm_eq(norm, "رجوع لتعديل المحافظة") or is_back(norm):
                return instant("**الخطوة 3 من 6:** اكتب أو اختر المحافظة:", reg_region_replies(), {"mode": "register", "step": "ask_location", "draft": draft, "return_to_review": ret_rev, "language": lang})
            if norm_in(norm, ["أخرى (اكتب المساحة والري)", "أخرى"]):
                return instant("تفضل بكتابة **مساحة الأرض وطريقة الري** (مثال: 5 فدان ري تنقيط):", ["رجوع لتعديل المحافظة", "القائمة الرئيسية"], flow)
            if len(raw) < 2:
                return instant("يرجى توضيح المساحة ونظام الري من الاختيارات بالأسفل:", REG_LAND_CHOICES, flow)
            draft["land_and_irrigation"] = raw
            if ret_rev:
                return build_review()
            return instant("**الخطوة 5 من 6:** ما هي أهم **المحاصيل أو الأشجار** المنزرعة أو المستهدفة؟", REG_CROPS_CHOICES, {"mode": "register", "step": "ask_crops", "draft": draft, "language": lang})

        if step == "ask_crops":
            if norm_eq(norm, "رجوع لتعديل المساحة والري") or is_back(norm):
                return instant("**الخطوة 4 من 6:** اختر المساحة ونظام الري:", REG_LAND_CHOICES, {"mode": "register", "step": "ask_land", "draft": draft, "return_to_review": ret_rev, "language": lang})
            if norm_in(norm, ["أخرى (اكتب المحاصيل)", "أخرى"]):
                return instant("تفضل بكتابة **أسماء المحاصيل أو الأشجار**:", ["رجوع لتعديل المساحة والري", "القائمة الرئيسية"], flow)
            if len(raw) < 2 or not any(ch.isalpha() for ch in raw):
                return instant("يرجى كتابة أو اختيار نوع المحاصيل:", REG_CROPS_CHOICES, flow)
            draft["crops"] = raw
            if ret_rev:
                return build_review()
            return instant("**الخطوة 6 من 6:** ما هو **نوع الدعم أو التدريب** المطلوب من **الجمعية (EBDA)**؟", REG_SUPPORT_CHOICES, {"mode": "register", "step": "ask_support", "draft": draft, "language": lang})

        if step == "ask_support":
            if norm_eq(norm, "رجوع لتعديل المحاصيل") or is_back(norm):
                return instant("**الخطوة 5 من 6:** اختر أو اكتب المحاصيل:", REG_CROPS_CHOICES, {"mode": "register", "step": "ask_crops", "draft": draft, "language": lang})
            if norm_in(norm, ["أخرى (اكتب طلبك)", "أخرى"]):
                return instant("تفضل بكتابة **نوع الدعم أو التدريب المطلوب**:", ["رجوع لتعديل المحاصيل", "القائمة الرئيسية"], flow)
            draft["support_needed"] = raw
            return build_review()

        if step == "review_registration":
            if norm in ("تاكيد وارسال التسجيل", "تاكيد", "ارسال"):
                reg_id = f"BIO-{1001 + registrations_count}"
                record = {
                    "registration_id": reg_id,
                    "session_id": session_id,
                    "channel": channel,
                    "full_name": draft.get("full_name", "عضو جديد"),
                    "phone": draft.get("phone", "-"),
                    "phone_e164": draft.get("phone_e164", ""),
                    "governorate": draft.get("governorate", "غير محدد"),
                    "land_and_irrigation": draft.get("land_and_irrigation", "-"),
                    "crops": draft.get("crops", "-"),
                    "support_needed": draft.get("support_needed", "شامل"),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                return instant(
                    f"تم تأكيد وتسجيل انضمامك بنجاح في **الجمعية المصرية للزراعة الحيوية (EBDA)** برقم عضوية **#{reg_id}**.\n\n"
                    f"- **الاسم:** {record['full_name']}\n- **التليفون:** {record['phone']}\n- **المحافظة:** {record['governorate']}\n"
                    f"- **المساحة والري:** {record['land_and_irrigation']}\n- **المحاصيل:** {record['crops']}\n- **الدعم:** {record['support_needed']}\n\n"
                    "سيتواصل معك مهندسو الجمعية قريباً. يمكنك الاستمرار في أي استفسار زراعي من القائمة بالأسفل:",
                    ["هل توجد مشكلة في محصول؟", "دليل زراعة محصول كامل", "القائمة الرئيسية"],
                    {"mode": "idle", "language": lang},
                    completed_reg=record,
                )
            edit_map = {
                "تعديل رقم التليفون": ("ask_phone", "**تعديل التليفون:** اكتب الرقم الجديد (11 رقماً):", ["القائمة الرئيسية"]),
                "تعديل المحافظة": ("ask_location", "**تعديل المحافظة:** اكتب المحافظة أو اختر الإقليم:", reg_region_replies()),
                "تعديل الاسم": ("ask_name", "**تعديل الاسم:** اكتب الاسم الثلاثي الصحيح:", ["القائمة الرئيسية"]),
                "تعديل المساحة والري": ("ask_land", "**تعديل المساحة والري:**", REG_LAND_CHOICES),
                "تعديل المحاصيل": ("ask_crops", "**تعديل المحاصيل:**", REG_CROPS_CHOICES),
            }
            for btn_lbl, (st_name, st_msg, st_reps) in edit_map.items():
                if norm_eq(norm, btn_lbl):
                    return instant(st_msg, st_reps, {"mode": "register", "step": st_name, "draft": draft, "return_to_review": True, "language": lang})
            return build_review()

    # -----------------------------------------------------------------------
    # JOURNEY 2: Smart Consultative Crop Advisor
    # -----------------------------------------------------------------------
    if flow.get("mode") == "smart_advisor":
        notes = list(flow.get("notes") or [])
        turns = int(flow.get("turns") or 0)
        chosen = find_matching_plants(raw, 1)
        if chosen and flow.get("step") == "advisor_followup":
            p = chosen[0]
            return {
                "kind": "ai_with_db",
                "matched_plants": [p],
                "focused_db_context": f"[ظروف أرض المزارع]: {' — '.join(notes)}\n\n{p['full_reference_text']}\nاربط خطة زراعة {p['name']} العضوية بظروف أرض المزارع.",
                "deterministic_fallback": build_deterministic_plant_fallback(p, raw),
                "quick_replies": get_crop_guide_choices(),
                "next_flow_state": {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": "guide", "selected_plant_id": p["id"], "selected_plant_name": p["name"], "language": lang},
            }

        notes = (notes + [raw])[-6:]
        combined = " | ".join(notes)
        has_soil = any(t in normalize_arabic_for_match(combined) for t in ("رملي", "طيني", "صفراء", "طميي", "ملوح", "جيري", "ابار", "عذب"))
        has_time = any(t in normalize_arabic_for_match(combined) for t in ("شتاء", "شتوي", "صيف", "صيفي", "خريف", "ربيع", "يناير", "فبراير", "مارس", "ابريل", "مايو", "اكتوبر", "نوفمبر"))
        has_area = any(t in normalize_arabic_for_match(combined) for t in ("فدان", "قيراط", "تنقيط", "غمر", "رش", "محوري"))

        if (int(has_soil) + int(has_time) + int(has_area)) < 2 and turns < 2:
            missing = []
            if not has_soil:
                missing.append("• **نوع التربة والملوحة:** هل التربة رملية أم طينية أم صفراء، ومياه الري عذبة أم آبار مالحة؟")
            if not has_time:
                missing.append("• **موعد الزراعة:** بتخطط تزرع في أي موسم (شتوي أم صيفي) أو في شهر كام؟")
            if not has_area:
                missing.append("• **المساحة ونظام الري:** المساحة كام فدان وطريقة الري (تنقيط، رش، أم غمر)؟")
            return {
                "kind": "ai_with_db",
                "matched_plants": [],
                "focused_db_context": f"[المستشار الذكي لترشيح المحصول]: المعلومات حتى الآن: ({combined}). اسأل المزارع بلطف وبنقاط قصيرة عن التفاصيل الناقصة قبل الترشيح:\n" + "\n".join(missing),
                "deterministic_fallback": "عشان نرشحلك أنسب وأربح محصول عضوي لأرضك، وضحلي التفاصيل دي:\n\n" + "\n".join(missing),
                "quick_replies": ["أرض رملية - ري تنقيط - صيفي", "أرض طينية - ري غمر - شتوي", "القائمة الرئيسية"],
                "next_flow_state": {"mode": "smart_advisor", "step": "gather", "notes": notes, "turns": turns + 1, "language": lang},
            }

        top_crops = score_crops_for_land(combined, 6)
        top3 = top_crops[:3]
        dossier = "\n\n".join(f"{i+1}) {p['name']} ({p['category']}): {p.get('environment','')} | التقاوي: {p.get('seeds_and_nursery','')}" for i, p in enumerate(top_crops))
        fallback_txt = "بناءً على مواصفات أرضك، أنسب المحاصيل الحيوية ليك:\n\n" + "\n\n".join(
            f"{i+1}. **{p['name']}** ({p['category']}): {p.get('environment','')[:110]}" for i, p in enumerate(top3)
        )
        return {
            "kind": "ai_with_db",
            "matched_plants": top3,
            "focused_db_context": f"[ترشيح أنسب المحاصيل لأرض المزارع ({combined})]: رشح أفضل 3 محاصيل من البيانات التالية مع توضيح سبب الملاءمة وموعد الزراعة وكمية التقاوي:\n{dossier}",
            "deterministic_fallback": fallback_txt,
            "quick_replies": [*[p["name"] for p in top3], OTHER_GENERAL_OPTION_LABEL, "القائمة الرئيسية"],
            "next_flow_state": {"mode": "smart_advisor", "step": "advisor_followup", "notes": notes, "turns": turns + 1, "language": lang},
        }

    # -----------------------------------------------------------------------
    # JOURNEY 3: 67-Crop Diagnostic & Guide Flow
    # -----------------------------------------------------------------------
    if flow.get("mode") == "crop_flow":
        submode = flow.get("crop_submode") or "problem"
        pending_tid = flow.get("pending_topic_id")

        picked_cat = next((c for c in CROP_CATEGORY_CHOICES if norm_eq(norm, c["label"]) or norm_eq(norm, c["category"])), None)
        if picked_cat:
            cat_plants = [p for p in PLANTS_DB if p["category"] == picked_cat["category"]]
            page_size = 7
            total_pages = max(1, (len(cat_plants) + page_size - 1) // page_size)
            sl = cat_plants[:page_size]
            reps = [p["name"] for p in sl]
            if total_pages > 1:
                reps.append("عرض باقي محاصيل القسم")
            reps += [OTHER_PLANT_OPTION_LABEL, "رجوع لأقسام المحاصيل"]
            return instant(f"**{picked_cat['category']}** (صفحة 1 من {total_pages}): اختر المحصول أو اكتب اسمه مباشرة:", reps, {"mode": "crop_flow", "step": "select_plant_in_category", "category_filter": picked_cat["category"], "category_page": 0, "crop_submode": submode, "pending_topic_id": pending_tid, "language": lang})

        if flow.get("step") == "select_plant_in_category" and flow.get("category_filter"):
            cat_plants = [p for p in PLANTS_DB if p["category"] == flow["category_filter"]]
            page_size = 7
            total_pages = max(1, (len(cat_plants) + page_size - 1) // page_size)
            cur_pg = int(flow.get("category_page") or 0)
            if norm_eq(norm, "عرض باقي محاصيل القسم"):
                nxt_pg = (cur_pg + 1) % total_pages
                sl = cat_plants[nxt_pg * page_size : (nxt_pg + 1) * page_size]
                reps = [p["name"] for p in sl]
                reps.append("عرض باقي محاصيل القسم" if nxt_pg + 1 < total_pages else "الرجوع لأول القسم")
                reps += [OTHER_PLANT_OPTION_LABEL, "رجوع لأقسام المحاصيل"]
                return instant(f"**{flow['category_filter']}** (صفحة {nxt_pg + 1} من {total_pages}):", reps, {**flow, "category_page": nxt_pg})
            if norm_eq(norm, "الرجوع لأول القسم"):
                sl = cat_plants[:page_size]
                reps = [p["name"] for p in sl] + (["عرض باقي محاصيل القسم"] if total_pages > 1 else []) + [OTHER_PLANT_OPTION_LABEL, "رجوع لأقسام المحاصيل"]
                return instant(f"**{flow['category_filter']}** (صفحة 1 من {total_pages}):", reps, {**flow, "category_page": 0})

        if norm_in(norm, [OTHER_PLANT_OPTION_LABEL, "نبات آخر"]):
            return instant("اكتب **اسم أي نبات أو محصول** للاستفسار عنه عضوياً 100%:", ["رجوع لأقسام المحاصيل", "القائمة الرئيسية"], {"mode": "crop_flow", "step": "enter_other_plant_name", "crop_submode": submode, "language": lang})

        def select_plant_turn(plant: dict[str, Any], force_submode: str | None = None) -> dict[str, Any]:
            sm = force_submode or submode
            if pending_tid:
                return instant(build_plant_topic_answer(plant, pending_tid), get_crop_guide_choices(), {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": "guide", "selected_plant_id": plant["id"], "selected_plant_name": plant["name"], "language": lang})
            if sm == "guide":
                return instant(f"محصول **{plant['name']}** ({plant['category']}):\nاختر المحور المطلوب من المحاور الـ 7 بالأسفل:", get_crop_guide_choices(), {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": "guide", "selected_plant_id": plant["id"], "selected_plant_name": plant["name"], "language": lang})
            return instant(f"محصول **{plant['name']}** ({plant['category']}):\nاختر **نوع المشكلة** أو اكتب الأعراض مباشرة:", get_crop_diagnostic_choices(plant["name"]), {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": "problem", "selected_plant_id": plant["id"], "selected_plant_name": plant["name"], "language": lang})

        if flow.get("step") == "confirm_fuzzy_plant" and norm.startswith("نعم"):
            p = next((x for x in PLANTS_DB if x["id"] == flow.get("pending_fuzzy_plant_id")), None)
            if p:
                return select_plant_turn(p)

        if flow.get("step") in ("select_crop_category", "select_plant_in_category", "enter_other_plant_name"):
            found = find_matching_plants(raw, 1)
            if found:
                p = found[0]
                if len(norm.split()) <= 3:
                    return select_plant_turn(p)
                return {
                    "kind": "ai_with_db",
                    "matched_plants": [p],
                    "focused_db_context": f"[بيانات محصول {p['name']}]:\n{p['full_reference_text']}",
                    "deterministic_fallback": build_deterministic_plant_fallback(p, raw),
                    "quick_replies": get_crop_diagnostic_choices(p["name"]),
                    "next_flow_state": {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": submode, "selected_plant_id": p["id"], "selected_plant_name": p["name"], "language": lang},
                }
            fuzzy_p = find_fuzzy_plant_suggestion(raw)
            if fuzzy_p:
                return instant(f"هل تقصد محصول **{fuzzy_p['name']}**؟", [f"نعم، {fuzzy_p['name']}", OTHER_PLANT_OPTION_LABEL, "رجوع لأقسام المحاصيل"], {"mode": "crop_flow", "step": "confirm_fuzzy_plant", "crop_submode": submode, "pending_fuzzy_plant_id": fuzzy_p["id"], "language": lang})
            if is_meaningful_agri_query(raw, norm):
                return {
                    "kind": "ai_with_db",
                    "matched_plants": [],
                    "focused_db_context": f"[محصول أو سؤال زراعي خارج القائمة]: أجب عن ({raw}) بمعلومات عضوية وحيوية 100% بمعدلات الفدان.",
                    "deterministic_fallback": "في الزراعة العضوية 100% نعتمد على 10-15 م³ كمبوست ناضج للفدان وشاي الكمبوست والترايكوديرما وزيت النيم بدون أي كيماويات.",
                    "quick_replies": [OTHER_PLANT_OPTION_LABEL, "القائمة الرئيسية"],
                    "next_flow_state": flow,
                }
            return instant("اختر قسم المحصول أو اكتب اسم النبات بوضوح:", [*[c["label"] for c in CROP_CATEGORY_CHOICES], OTHER_PLANT_OPTION_LABEL, "القائمة الرئيسية"], flow)

        if flow.get("step") == "select_topic_or_symptom":
            if norm_in(norm, [OTHER_CROP_TOPIC_LABEL, "أخرى", "سؤال آخر"]):
                return instant("تفضل بكتابة سؤالك", ["اختيار محصول آخر", "القائمة الرئيسية"], flow)
            cur_p = next((x for x in PLANTS_DB if x["id"] == flow.get("selected_plant_id")), None)
            if cur_p:
                if raw.startswith("دليل زراعة "):
                    return select_plant_turn(cur_p, "guide")
                topic_ans = ""
                if norm_eq(norm, "إصابة حشرية في المحصول") and cur_p.get("pest_and_disease_control"):
                    topic_ans = f"**المكافحة الحيوية للإصابات الحشرية في {cur_p['name']}:**\n\n{cur_p['pest_and_disease_control']}"
                elif norm_eq(norm, "إصابة فطرية أو أعفان") and cur_p.get("pest_and_disease_control"):
                    topic_ans = f"**المكافحة الحيوية للفطريات والأعفان في {cur_p['name']}:**\n\n{cur_p['pest_and_disease_control']}"
                elif norm_eq(norm, "ضعف نمو أو تسميد حيوي") and cur_p.get("fertilization"):
                    topic_ans = f"**التسميد العضوي لمحصول {cur_p['name']}:**\n\n{cur_p['fertilization']}"
                elif norm_eq(norm, "مشكلة في الري أو الملوحة") and cur_p.get("irrigation"):
                    topic_ans = f"**الري والملوحة لمحصول {cur_p['name']}:**\n\n{cur_p['irrigation']}"
                elif norm_eq(norm, "مشكلة حشائش في الأرض"):
                    topic_ans = f"**إدارة الحشائش عضوياً في {cur_p['name']}:** الري الكاذب والعزيق اليدوي والتغطية بالملش. {cur_p.get('pest_and_disease_control','')}"
                elif raw.startswith("1. "):
                    topic_ans = build_plant_topic_answer(cur_p, "env")
                elif raw.startswith("2. "):
                    topic_ans = build_plant_topic_answer(cur_p, "seeds")
                elif raw.startswith("3. "):
                    topic_ans = build_plant_topic_answer(cur_p, "irrigation")
                elif raw.startswith("4. "):
                    topic_ans = build_plant_topic_answer(cur_p, "fertilization")
                elif raw.startswith("5. "):
                    topic_ans = build_plant_topic_answer(cur_p, "biocontrol")
                elif raw.startswith("6. "):
                    topic_ans = build_plant_topic_answer(cur_p, "harvest")
                elif raw.startswith("7. "):
                    topic_ans = build_plant_topic_answer(cur_p, "postharvest")

                if topic_ans:
                    reps = get_crop_guide_choices() if submode == "guide" else get_crop_diagnostic_choices(cur_p["name"])
                    return instant(topic_ans, reps, flow)

                return {
                    "kind": "ai_with_db",
                    "matched_plants": [cur_p],
                    "focused_db_context": f"[بيانات محصول {cur_p['name']}]:\n{cur_p['full_reference_text']}",
                    "deterministic_fallback": build_deterministic_plant_fallback(cur_p, raw),
                    "quick_replies": get_crop_diagnostic_choices(cur_p["name"]),
                    "next_flow_state": flow,
                }

    # -----------------------------------------------------------------------
    # IDLE / FREE TEXT ROUTING
    # -----------------------------------------------------------------------
    if is_pure_greeting(norm):
        return instant(
            "اختر الخدمة المطلوبة من القائمة بالأسفل أو اكتب استفسارك مباشرة:" if has_prior_messages else "أهلاً وسهلاً بحضرتك في **الجمعية المصرية للزراعة الحيوية (EBDA)** ومبادرة **اقتصاد المحبة (EoL)** — نقدر نساعدك إزاي النهارده؟",
            get_language_menu_suggestions(lang),
            {"mode": "idle", "language": lang},
        )

    matched = find_matching_plants(raw, 2)
    if matched:
        primary = matched[0]
        if len(norm.split()) <= 2:
            return instant(
                f"محصول **{primary['name']}** ({primary['category']}):\nاختر **نوع المشكلة أو الدليل** من الاختيارات بالأسفل، أو اكتب سؤالك مباشرة:",
                get_crop_diagnostic_choices(primary["name"]),
                {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": "problem", "selected_plant_id": primary["id"], "selected_plant_name": primary["name"], "language": lang},
            )
        return {
            "kind": "ai_with_db",
            "matched_plants": matched,
            "focused_db_context": "\n\n---\n\n".join(m["full_reference_text"] for m in matched),
            "deterministic_fallback": build_deterministic_plant_fallback(primary, raw),
            "quick_replies": get_crop_diagnostic_choices(primary["name"]),
            "next_flow_state": {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": "problem", "selected_plant_id": primary["id"], "selected_plant_name": primary["name"], "language": lang},
        }

    faq_hit = next((f for f in TOR_ELEVEN_FAQS if any(norm_has(norm, kw) for kw in f["keywords"])), None)
    if faq_hit:
        return instant(faq_hit["answerArabic"], ["الأسئلة الشائعة (FAQs)", "تسجيل في الجمعية (EBDA)", "القائمة الرئيسية"], {"mode": "faq", "language": lang})

    extra_crop = detect_extra_arabic_crop(raw, norm)
    if extra_crop and len(norm.split()) <= 2:
        return instant(
            f"محصول **{extra_crop}**:\nاختر **نوع الاستفسار العضوي** أو اكتب سؤالك مباشرة:",
            get_crop_diagnostic_choices(extra_crop),
            {"mode": "crop_flow", "step": "select_topic_or_symptom", "crop_submode": "problem", "selected_plant_name": extra_crop, "language": lang},
        )

    if not is_meaningful_agri_query(raw, norm) and flow.get("mode") != "general_ai":
        return instant(
            "عذراً، لم نتمكن من فهم الاستفسار بوضوح. يرجى إعادة كتابة سؤالك الزراعي أو الاختيار من القائمة بالأسفل:",
            get_language_menu_suggestions(lang),
            {"mode": "idle", "language": lang},
        )

    return {
        "kind": "ai_with_db",
        "matched_plants": [],
        "focused_db_context": f"[سؤال زراعي عضوي مفتوح]: أجب عن ({raw}) بتوصيات عضوية وحيوية 100% بمعدلات الفدان بدون أي كيماويات وبدون تحية مكررة.",
        "deterministic_fallback": "في الزراعة العضوية والحيوية (Organic 100%) نعتمد على الكمبوست تام التحلل (10–15 م³/فدان)، شاي الكمبوست الهوائي، صخر الفوسفات والفلسبار للتغذية، وزيت النيم والصابون البوتاسي وباسيلس Bt وترايكوديرما للوقاية والمكافحة بدون أي كيماويات.",
        "quick_replies": get_language_menu_suggestions(lang),
        "next_flow_state": {"mode": "idle" if flow.get("mode") != "general_ai" else "general_ai", "language": lang},
    }


# ---------------------------------------------------------------------------
# Open-Meteo Live Ag-Weather & Organic Spraying Recommendation Connector
# ---------------------------------------------------------------------------
async def fetch_location_spray_advisory(latitude: float, longitude: float, label: str = "موقع مزرعتك", channel: str = "widget") -> str:
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,soil_temperature_6cm,soil_moisture_3_to_9cm",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration",
        "timezone": "auto",
        "forecast_days": 5,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Open-Meteo request failed: %s", exc)
        return (
            f"تم استلام إحداثيات الموقع ({latitude:.3f}, {longitude:.3f}) لمزرعتك، وتعذر سحب رصد الطقس اللحظي حالياً.\n\n"
            "• **قاعدة الرش الحيوي العامة:** يُنصح برش زيت النيم وباسيلس Bt وترايكوديرما آخر النهار قبل الغروب عندما تكون سرعة الرياح أقل من 15 كم/ساعة والحرارة أقل من 32°م."
        )

    cur = data.get("current", {})
    daily = data.get("daily", {})
    temp = cur.get("temperature_2m")
    rh = cur.get("relative_humidity_2m")
    wind = cur.get("wind_speed_10m") or 0
    rain_now = cur.get("precipitation") or 0
    soil_temp = cur.get("soil_temperature_6cm")
    soil_moist = cur.get("soil_moisture_3_to_9cm")

    et0_list = [x or 0.0 for x in (daily.get("et0_fao_evapotranspiration") or [])]
    rain_list = [x or 0.0 for x in (daily.get("precipitation_sum") or [])]
    deficit_mm = max(0.0, round(sum(et0_list) - sum(rain_list), 1))
    water_m3_feddan = round(deficit_mm * 4.2)

    spray_ok = (wind < 15) and (rain_now == 0) and (temp is None or temp <= 32)
    spray_status = (
        "✅ **مناسب للرش الحيوي آخر النهار قبل الغروب** (الرياح هادئة والظروف ممتازة لفاعلية زيت النيم وباسيلس Bt وترايكوديرما)."
        if spray_ok
        else "⚠️ **يفضل تأجيل الرش الحيوي الآن** بسبب ارتفاع سرعة الرياح أو الحرارة أو الأمطار، والانتظار لهدوء الرياح قبل الغروب."
    )
    fungal_note = (
        "• **تنبيه رطوبة:** الرطوبة النسبية مرتفعة؛ يُنصح بتوسيع التهوية والرش الوقائي بباسيلس ساتلس أو الكبريت الميكروني."
        if (rh is not None and rh >= 70)
        else "• **حالة الرطوبة:** معتدلة ومستقرة للعمليات الحقلية والرش الورقي لشاي الكمبوست."
    )
    msg = (
        f"**نشرة الطقس الحي وتوصيات الرش والري العضوي — {label}** ({latitude:.3f}, {longitude:.3f}):\n\n"
        f"- **الطقس الآن:** الحرارة {temp}°م · الرطوبة {rh}% · سرعة الرياح {wind} كم/س · حرارة التربة {soil_temp}°م · رطوبة التربة {soil_moist} م³/م³.\n"
        f"- **قرار الرش الحيوي:** {spray_status}\n"
        f"{fungal_note}\n"
        f"- **مقنن الري المتوقع (5 أيام القادمة):** البخر-نتح {round(sum(et0_list), 1)} مم مقابل مطر {round(sum(rain_list), 1)} مم (~**{water_m3_feddan} م³ مياه للفدان** مضروباً في معامل المحصول)."
    )
    return format_message_for_channel(msg, channel)


# ---------------------------------------------------------------------------
# Google Gemini Client (Text + Multimodal Vision + Voice Transcription)
# ---------------------------------------------------------------------------
_genai_client: genai.Client | None = None


def get_genai_client() -> genai.Client | None:
    global _genai_client
    api_key = os.environ.get("GEMINI_API_KEY", "").strip() or GEMINI_API_KEY
    if not api_key:
        return None
    if _genai_client is None:
        _genai_client = genai.Client(api_key=api_key)
    return _genai_client


async def call_gemini_generate(
    contents: list[Any],
    timeout_sec: float = 20.0,
) -> tuple[str, str]:
    client = get_genai_client()
    if client is None:
        return "", "no-gemini-api-key"

    def _sync_call() -> tuple[str, str]:
        last_err: Exception | None = None
        for model_name in CANDIDATE_GEMINI_MODELS:
            try:
                resp = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=ADVISOR_SYSTEM_INSTRUCTION,
                    ),
                )
                txt = (resp.text or "").strip()
                if txt:
                    return txt, model_name
            except Exception as exc:
                last_err = exc
                logger.warning("Gemini model %s fallback (%s)", model_name, exc)
        if last_err:
            logger.error("All Gemini candidate models failed: %s", last_err)
        return "", "fallback"

    try:
        return await asyncio.wait_for(asyncio.to_thread(_sync_call), timeout=timeout_sec)
    except asyncio.TimeoutError:
        logger.warning("Gemini request timed out after %.1fs", timeout_sec)
        return "", "timeout-fallback"


async def transcribe_audio_bytes(audio_bytes: bytes, mime_type: str = "audio/ogg") -> str:
    client = get_genai_client()
    if not client or not audio_bytes:
        return ""
    prompt = "فرّغ هذه الرسالة الصوتية باللغة العربية أو اللهجة المصرية بدقة كما نطقها المزارع، واكتب النص فقط."
    part = types.Part.from_bytes(data=audio_bytes, mime_type=mime_type.split(";")[0].strip() or "audio/ogg")
    txt, _ = await call_gemini_generate([types.Content(role="user", parts=[part, types.Part.from_text(text=prompt)])], timeout_sec=14.0)
    return txt.strip()


def strip_leading_greeting(text: str) -> str:
    return re.sub(
        r"^(?:[*\s]*(?:يا\s+)?(?:أهلاً|اهلا|مرحباً|مرحبا|حياك\s+الله)(?:\s+وسهلاً|\s+وسهلا)?(?:\s+بيك|\s+بك|\s+بحضرتك)?[،,!.:\-\s]*\n*)+",
        "",
        text or "",
        flags=re.IGNORECASE,
    ).strip()


# ---------------------------------------------------------------------------
# In-Memory Session Store, Registration Log, & Webhook Idempotency Cache
# ---------------------------------------------------------------------------
SESSIONS: dict[str, dict[str, Any]] = {}
REGISTRATIONS: list[dict[str, Any]] = []
PROCESSED_MESSAGE_IDS: OrderedDict[str, float] = OrderedDict()
MAX_IDEMPOTENCY_CACHE = 5000
IDEMPOTENCY_TTL_SEC = 1800.0


def is_duplicate_message(msg_id: str) -> bool:
    if not msg_id:
        return False
    now = time.time()
    while PROCESSED_MESSAGE_IDS:
        oldest_key, oldest_ts = next(iter(PROCESSED_MESSAGE_IDS.items()))
        if now - oldest_ts > IDEMPOTENCY_TTL_SEC or len(PROCESSED_MESSAGE_IDS) >= MAX_IDEMPOTENCY_CACHE:
            PROCESSED_MESSAGE_IDS.popitem(last=False)
        else:
            break
    if msg_id in PROCESSED_MESSAGE_IDS:
        return True
    PROCESSED_MESSAGE_IDS[msg_id] = now
    return False


def get_or_create_session(session_id: str, channel: str = "widget", user_id: str = "tester", profile_name: str = "مزارع") -> dict[str, Any]:
    if session_id not in SESSIONS:
        SESSIONS[session_id] = {
            "session_id": session_id,
            "channel": channel,
            "external_user_id": user_id,
            "profile_name": profile_name,
            "flow_state": {"mode": "idle"},
            "language": "ar",
            "messages": [],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    return SESSIONS[session_id]


async def process_advisor_turn(
    session_id: str,
    channel: str,
    external_user_id: str,
    profile_name: str = "مزارع",
    user_text: str = "",
    image_bytes: bytes | None = None,
    image_mime: str = "image/jpeg",
    location: tuple[float, float, str] | None = None,
) -> dict[str, Any]:
    session = get_or_create_session(session_id, channel, external_user_id, profile_name)
    has_prior = len(session["messages"]) > 0

    if location is not None:
        lat, lon, loc_label = location
        weather_answer = await fetch_location_spray_advisory(lat, lon, loc_label, channel)
        session["messages"].append({"role": "user", "content": f"📍 موقع جغرافي ({lat:.3f}, {lon:.3f})"})
        session["messages"].append({"role": "assistant", "content": weather_answer})
        return {
            "answer": weather_answer,
            "quick_replies": get_language_menu_suggestions(session.get("language", "ar")),
            "model_used": "open-meteo-live",
        }

    has_image = bool(image_bytes)
    effective_text = user_text.strip() or ("فحص وتشخيص صورة نبات 📷" if has_image else "")
    is_explicit_nav = bool(re.match(r"^(القائمة الرئيسية|الرئيسية|خروج|رجوع|بداية جديدة)$", effective_text))

    flow_turn = evaluate_flow_turn(
        user_message=effective_text,
        current_flow=session.get("flow_state"),
        session_id=session_id,
        channel=channel,
        registrations_count=len(REGISTRATIONS),
        has_prior_messages=has_prior,
    )

    if not has_image or is_explicit_nav:
        session["flow_state"] = flow_turn["next_flow_state"]
        if flow_turn["next_flow_state"].get("language"):
            session["language"] = flow_turn["next_flow_state"]["language"]

    if flow_turn["kind"] == "instant" and (not has_image or is_explicit_nav):
        if flow_turn.get("completed_registration"):
            REGISTRATIONS.insert(0, flow_turn["completed_registration"])
        formatted = format_message_for_channel(flow_turn["answer"], channel)
        session["messages"].append({"role": "user", "content": effective_text})
        session["messages"].append({"role": "assistant", "content": formatted})
        return {
            "answer": formatted,
            "quick_replies": flow_turn.get("quick_replies") or [],
            "model_used": "ebda-flow-engine",
        }

    lang = session.get("language") or "ar"
    focused_ctx = flow_turn.get("focused_db_context", "")
    fallback_txt = flow_turn.get("deterministic_fallback", "")

    style_rule = (
        "نقاط قصيرة للموبايل، خط عريض *نص* وعلامة • بدون ** أو #."
        if channel == "whatsapp"
        else "نص عربي صافي بدون نجوم ** أو * أو #، عناوين ▪ ونقاط •."
        if channel == "messenger"
        else "إجابة منظمة بعناوين (**عنوان:**) ونقاط عملية بمعدلات الفدان."
    )
    prompt = f"[القناة]: {channel}\n[التنسيق]: {style_rule}\n[اللغة]: {lang}\n{focused_ctx}\n\n[رسالة المستخدم]: {effective_text}"

    if has_image:
        prompt += (
            "\n\n[طلب فحص وتشخيص صورة مرفقة 📷]:\n"
            "افحص الصورة كخبير زراعة عضوية وأمراض نبات، وأجب مباشرة بدون تحية:\n"
            "1) اسم النبات أو الآفة أو المحتوى المصور.\n"
            "2) التشخيص والأعراض المرئية بدقة.\n"
            "3) الحل والعلاج العضوي 100% فقط (مثل زيت النيم 5 سم/لتر + صابون بوتاسي، باسيلس Bt، ترايكوديرما، كبريت ميكروني، شاي كمبوست) مع منع الكيماويات نهائياً."
        )

    history_contents: list[types.Content] = []
    for m in session["messages"][-4:]:
        role = "model" if m["role"] == "assistant" else "user"
        history_contents.append(types.Content(role=role, parts=[types.Part.from_text(text=m["content"][:500])]))

    user_parts: list[types.Part] = []
    if has_image and image_bytes:
        user_parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime.split(";")[0].strip() or "image/jpeg"))
    user_parts.append(types.Part.from_text(text=prompt))
    history_contents.append(types.Content(role="user", parts=user_parts))

    ai_text, model_used = await call_gemini_generate(history_contents, timeout_sec=24.0 if has_image else 16.0)
    answer = strip_leading_greeting(ai_text) or ai_text
    if not answer and has_image:
        answer = (
            "تم استلام الصورة بنجاح 📷\n\nتوصيات الوقاية والعلاج العضوي 100% المعتمدة من الجمعية (EBDA):\n"
            "• رش زيت نيم نقي (5 سم/لتر ماء) + صابون بوتاسي زراعي لمكافحة الحشرات الثاقبة الماصة.\n"
            "• رش كبريت ميكروني (250 جم/100 لتر) للوقاية من البياض الدقيقي وفطريات الأوراق.\n"
            "• حقن شاي كمبوست هوائي مع فطر ترايكوديرما حول الجذور لتقوية المناعة.\n"
            "• لو الإضاءة ضعيفة، صوّر الورقة عن قرب في ضوء الشمس وارفعها مرة أخرى."
        )
        model_used = "ebda-vision-fallback"
    elif not answer:
        answer = fallback_txt

    quick_replies = (
        ["موضوعات الزراعة العضوية", "هل توجد مشكلة في محصول؟", "القائمة الرئيسية"]
        if has_image
        else (flow_turn.get("quick_replies") or [])
    )
    formatted = format_message_for_channel(answer, channel)
    session["messages"].append({"role": "user", "content": effective_text})
    session["messages"].append({"role": "assistant", "content": formatted})
    return {"answer": formatted, "quick_replies": quick_replies, "model_used": model_used}


# ---------------------------------------------------------------------------
# Meta Graph API Media Downloader & Smart Split Dispatchers (WhatsApp & FB)
# ---------------------------------------------------------------------------
async def download_whatsapp_media(media_id: str) -> tuple[bytes | None, str]:
    if not WHATSAPP_TOKEN or not media_id:
        return None, "image/jpeg"
    headers = {"Authorization": f"Bearer {WHATSAPP_TOKEN}"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            meta_resp = await client.get(f"https://graph.facebook.com/v21.0/{media_id}", headers=headers)
            meta_resp.raise_for_status()
            info = meta_resp.json()
            media_url = info.get("url")
            mime = info.get("mime_type") or "image/jpeg"
            if not media_url:
                return None, mime
            bin_resp = await client.get(media_url, headers=headers)
            bin_resp.raise_for_status()
            return bin_resp.content, mime
    except Exception as exc:
        logger.warning("WhatsApp media download failed (%s): %s", media_id, exc)
        return None, "image/jpeg"


async def download_url_bytes(url: str) -> tuple[bytes | None, str]:
    if not url:
        return None, "image/jpeg"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
            return resp.content, ctype
    except Exception as exc:
        logger.warning("URL media download failed: %s", exc)
        return None, "image/jpeg"


async def send_whatsapp_split_messages(
    recipient_phone: str,
    reply_text: str,
    choices: list[str] | None = None,
    phone_number_id: str | None = None,
) -> None:
    token = WHATSAPP_TOKEN
    pid = phone_number_id or WHATSAPP_PHONE_ID
    if not token or not pid or recipient_phone in ("live-test", "unknown"):
        return

    url = f"https://graph.facebook.com/v21.0/{pid}/messages"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    valid_choices = [c for c in (choices or []) if c][:10]
    clean_text = format_message_for_channel(reply_text, "whatsapp")

    def build_interactive_payload(body_str: str) -> dict[str, Any]:
        if len(valid_choices) <= 3:
            titles = ensure_unique_short_titles(valid_choices, 20)
            return {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient_phone,
                "type": "interactive",
                "interactive": {
                    "type": "button",
                    "body": {"text": body_str[:1024]},
                    "action": {
                        "buttons": [
                            {"type": "reply", "reply": {"id": lbl[:256], "title": titles[i]}}
                            for i, lbl in enumerate(valid_choices)
                        ]
                    },
                },
            }
        titles = ensure_unique_short_titles(valid_choices, 24)
        rows = []
        for i, lbl in enumerate(valid_choices):
            row: dict[str, Any] = {"id": lbl[:200], "title": titles[i]}
            if titles[i] != lbl or len(lbl) > 24:
                row["description"] = lbl[:72]
            rows.append(row)
        return {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": body_str[:1024]},
                "action": {
                    "button": "اختر من القائمة",
                    "sections": [{"title": "خدمات الجمعية (EBDA)", "rows": rows}],
                },
            },
        }

    async with httpx.AsyncClient(timeout=12.0) as client:
        if valid_choices and len(clean_text) <= 1005:
            payload = build_interactive_payload(clean_text)
            resp = await client.post(url, headers=headers, json=payload)
            if not resp.is_success:
                logger.warning("WhatsApp API error (%s): %s", resp.status_code, resp.text[:250])
            return

        # Long message: split safely up to 3800 chars per WhatsApp message so NO dosage/info is lost
        chunks = split_message_chunks(clean_text, 3800)
        for idx, chunk in enumerate(chunks):
            is_last = idx == len(chunks) - 1
            if is_last and valid_choices and len(chunk) <= 1005:
                payload = build_interactive_payload(chunk)
            else:
                payload = {
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": recipient_phone,
                    "type": "text",
                    "text": {"preview_url": False, "body": chunk},
                }
            resp = await client.post(url, headers=headers, json=payload)
            if not resp.is_success:
                logger.warning("WhatsApp chunk %d error (%s): %s", idx, resp.status_code, resp.text[:250])

        # If final text chunk exceeded 1005 chars and had choices, follow up with native interactive menu
        if valid_choices and chunks and len(chunks[-1]) > 1005:
            menu_payload = build_interactive_payload("اختر الخطوة التالية من القائمة بالأسفل:")
            await client.post(url, headers=headers, json=menu_payload)


async def send_messenger_split_messages(
    recipient_psid: str,
    reply_text: str,
    choices: list[str] | None = None,
) -> None:
    token = PAGE_ACCESS_TOKEN
    if not token or recipient_psid in ("live-test", "unknown"):
        return

    url = "https://graph.facebook.com/v21.0/me/messages"
    params = {"access_token": token}
    clean_text = format_message_for_channel(reply_text, "messenger")
    valid_choices = [c for c in (choices or []) if c][:13]
    titles = ensure_unique_short_titles(valid_choices, 20) if valid_choices else []

    # Messenger max ~2000 chars: split safely at 1900 chars per sequential message
    chunks = split_message_chunks(clean_text, 1900)
    async with httpx.AsyncClient(timeout=12.0) as client:
        for idx, chunk in enumerate(chunks):
            msg_obj: dict[str, Any] = {"text": chunk}
            if idx == len(chunks) - 1 and valid_choices:
                msg_obj["quick_replies"] = [
                    {"content_type": "text", "title": titles[i], "payload": lbl[:1000]}
                    for i, lbl in enumerate(valid_choices)
                ]
            resp = await client.post(url, params=params, json={"recipient": {"id": recipient_psid}, "messaging_type": "RESPONSE", "message": msg_obj})
            if not resp.is_success:
                logger.warning("Messenger chunk %d error (%s): %s", idx, resp.status_code, resp.text[:250])


# ---------------------------------------------------------------------------
# FastAPI Background Processor for Inbound Meta Webhook Payloads
# ---------------------------------------------------------------------------
async def process_webhook_payload_async(payload: dict[str, Any]) -> None:
    try:
        entries = payload.get("entry") or []
        for entry in entries:
            # 1. WhatsApp Business Cloud API events
            for change in entry.get("changes") or []:
                val = change.get("value") or {}
                # Ignore status updates (sent, delivered, read, failed)
                if val.get("statuses") and not val.get("messages"):
                    continue
                contacts = val.get("contacts") or []
                profile_name = contacts[0].get("profile", {}).get("name", "مزارع") if contacts else "مزارع"
                inbound_phone_id = (val.get("metadata") or {}).get("phone_number_id") or WHATSAPP_PHONE_ID

                for msg in val.get("messages") or []:
                    msg_id = str(msg.get("id") or "").strip()
                    if msg_id and is_duplicate_message(f"wa:{msg_id}"):
                        continue

                    sender = str(msg.get("from") or "unknown")
                    mtype = str(msg.get("type") or "")
                    text_in = ""
                    img_bytes = None
                    img_mime = "image/jpeg"
                    loc_tuple = None

                    if mtype == "text":
                        text_in = (msg.get("text") or {}).get("body", "").strip()
                    elif mtype == "interactive":
                        inter = msg.get("interactive") or {}
                        text_in = (
                            (inter.get("button_reply") or {}).get("id")
                            or (inter.get("button_reply") or {}).get("title")
                            or (inter.get("list_reply") or {}).get("id")
                            or (inter.get("list_reply") or {}).get("title")
                            or ""
                        ).strip()
                    elif mtype == "button":
                        btn = msg.get("button") or {}
                        text_in = (btn.get("payload") or btn.get("text") or "").strip()
                    elif mtype == "location":
                        loc = msg.get("location") or {}
                        if loc.get("latitude") is not None and loc.get("longitude") is not None:
                            loc_tuple = (
                                float(loc["latitude"]),
                                float(loc["longitude"]),
                                str(loc.get("name") or loc.get("address") or "موقع المزرعة"),
                            )
                    elif mtype == "image":
                        img_obj = msg.get("image") or {}
                        text_in = (img_obj.get("caption") or "").strip()
                        if img_obj.get("base64"):
                            img_bytes = base64.b64decode(re.sub(r"^data:[^;]+;base64,", "", str(img_obj["base64"])))
                            img_mime = str(img_obj.get("mime_type") or "image/jpeg")
                        elif img_obj.get("id"):
                            img_bytes, img_mime = await download_whatsapp_media(str(img_obj["id"]))
                    elif mtype == "audio":
                        aud = msg.get("audio") or {}
                        aud_bytes = None
                        aud_mime = str(aud.get("mime_type") or "audio/ogg")
                        if aud.get("base64"):
                            aud_bytes = base64.b64decode(re.sub(r"^data:[^;]+;base64,", "", str(aud["base64"])))
                        elif aud.get("id"):
                            aud_bytes, aud_mime = await download_whatsapp_media(str(aud["id"]))
                        if aud_bytes:
                            text_in = await transcribe_audio_bytes(aud_bytes, aud_mime)

                    if text_in or img_bytes or loc_tuple:
                        turn = await process_advisor_turn(
                            session_id=f"whatsapp:{sender}",
                            channel="whatsapp",
                            external_user_id=sender,
                            profile_name=profile_name,
                            user_text=text_in,
                            image_bytes=img_bytes,
                            image_mime=img_mime,
                            location=loc_tuple,
                        )
                        await send_whatsapp_split_messages(
                            sender,
                            turn["answer"],
                            turn.get("quick_replies"),
                            inbound_phone_id,
                        )

            # 2. Facebook Messenger Platform events
            for event in entry.get("messaging") or []:
                message = event.get("message") or {}
                postback = event.get("postback") or {}
                if message.get("is_echo"):
                    continue
                if not message and not postback:
                    continue  # Skip delivery / read receipts

                psid = str((event.get("sender") or {}).get("id") or "unknown")
                mid = str(message.get("mid") or "").strip()
                if not mid and postback and event.get("timestamp"):
                    mid = f"pb:{psid}:{event.get('timestamp')}"
                if mid and is_duplicate_message(f"fb:{mid}"):
                    continue
                text_in = (
                    (message.get("quick_reply") or {}).get("payload")
                    or postback.get("payload")
                    or message.get("text")
                    or ""
                ).strip()
                img_bytes = None
                img_mime = "image/jpeg"
                loc_tuple = None

                for att in message.get("attachments") or []:
                    atype = att.get("type")
                    apayload = att.get("payload") or {}
                    if atype == "image" and not img_bytes:
                        if apayload.get("base64"):
                            img_bytes = base64.b64decode(re.sub(r"^data:[^;]+;base64,", "", str(apayload["base64"])))
                            img_mime = str(apayload.get("mime_type") or "image/jpeg")
                        elif apayload.get("url"):
                            img_bytes, img_mime = await download_url_bytes(str(apayload["url"]))
                    elif atype == "location" and not loc_tuple:
                        coords = apayload.get("coordinates") or {}
                        if coords.get("lat") is not None and coords.get("long") is not None:
                            loc_tuple = (float(coords["lat"]), float(coords["long"]), str(att.get("title") or "موقع المزرعة"))
                    elif atype == "audio" and not text_in:
                        aud_bytes, aud_mime = await download_url_bytes(str(apayload.get("url") or ""))
                        if aud_bytes:
                            text_in = await transcribe_audio_bytes(aud_bytes, aud_mime)

                if text_in or img_bytes or loc_tuple:
                    turn = await process_advisor_turn(
                        session_id=f"messenger:{psid}",
                        channel="messenger",
                        external_user_id=psid,
                        profile_name=f"عضو ماسنجر ({psid[-4:]})",
                        user_text=text_in,
                        image_bytes=img_bytes,
                        image_mime=img_mime,
                        location=loc_tuple,
                    )
                    await send_messenger_split_messages(psid, turn["answer"], turn.get("quick_replies"))
    except Exception as exc:
        logger.exception("Async webhook background task error: %s", exc)


# ---------------------------------------------------------------------------
# FastAPI App & Cryptographically Verified Meta Webhook Endpoints
# ---------------------------------------------------------------------------
app = FastAPI(title="AgriPulse EBDA Organic Advisor", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_x_hub_signature(raw_body: bytes, signature_header: str | None) -> None:
    if not META_APP_SECRET:
        return
    if not signature_header or not signature_header.startswith("sha256="):
        raise HTTPException(status_code=403, detail="Missing x-hub-signature-256 header.")
    expected_mac = hmac.new(META_APP_SECRET.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(f"sha256={expected_mac}", signature_header.strip()):
        raise HTTPException(status_code=403, detail="Invalid x-hub-signature-256.")


@app.get("/api/health")
async def health_check() -> dict[str, Any]:
    return {
        "status": "ok",
        "crops_loaded": len(PLANTS_DB),
        "governorates": len(EGYPT_GOVERNORATES),
        "gemini_configured": bool(os.environ.get("GEMINI_API_KEY", "").strip() or GEMINI_API_KEY),
        "whatsapp_configured": bool(WHATSAPP_TOKEN and WHATSAPP_PHONE_ID),
        "messenger_configured": bool(PAGE_ACCESS_TOKEN),
        "meta_app_secret_enforced": bool(META_APP_SECRET),
    }


@app.get("/webhook")
@app.get("/webhooks/whatsapp")
@app.get("/webhooks/messenger")
async def meta_webhook_verify(
    hub_mode: str | None = Query(default=None, alias="hub.mode"),
    hub_verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(default=None, alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_verify_token == META_VERIFY_TOKEN and hub_challenge is not None:
        return PlainTextResponse(content=hub_challenge, status_code=200)
    raise HTTPException(status_code=403, detail="Webhook verification failed.")


@app.post("/webhook")
@app.post("/webhooks/whatsapp")
@app.post("/webhooks/messenger")
async def meta_webhook_inbound(request: Request, background_tasks: BackgroundTasks):
    raw_body = await request.body()
    verify_x_hub_signature(raw_body, request.headers.get("x-hub-signature-256"))
    try:
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.")

    background_tasks.add_task(process_webhook_payload_async, payload)
    return PlainTextResponse(content="EVENT_RECEIVED", status_code=200)


# ---------------------------------------------------------------------------
# Gradio Interactive UI (Mounted at "/")
# ---------------------------------------------------------------------------
def _load_image_bytes(image_path: str | None) -> tuple[bytes | None, str]:
    if not image_path:
        return None, "image/jpeg"
    p = Path(image_path)
    if not p.exists():
        return None, "image/jpeg"
    raw_bytes = p.read_bytes()
    mime, _ = mimetypes.guess_type(str(p))
    if mime in ("image/jpeg", "image/png", "image/webp"):
        return raw_bytes, mime
    with Image.open(io.BytesIO(raw_bytes)) as img:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=88)
        return buf.getvalue(), "image/jpeg"


MAX_QUICK_BTN = 10


async def gradio_handle_turn(
    user_text: str,
    image_path: str | None,
    channel: str,
    session_id: str,
    history: list[dict[str, Any]],
):
    txt = (user_text or "").strip()
    img_bytes, img_mime = _load_image_bytes(image_path)
    if not txt and not img_bytes:
        return history, "", None, session_id, *([gr.update()] * MAX_QUICK_BTN)

    display_user = txt or "📷 فحص وتشخيص صورة النبات المرفقة"
    if img_bytes and txt:
        display_user = f"📷 {txt}"

    res = await process_advisor_turn(
        session_id=session_id,
        channel=channel,
        external_user_id="gradio-tester",
        profile_name="مختبر الويب",
        user_text=txt,
        image_bytes=img_bytes,
        image_mime=img_mime,
    )

    new_history = list(history or [])
    new_history.append({"role": "user", "content": display_user})
    new_history.append({"role": "assistant", "content": res["answer"]})

    replies = res.get("quick_replies") or []
    btn_updates = []
    for i in range(MAX_QUICK_BTN):
        if i < len(replies):
            btn_updates.append(gr.update(value=replies[i], visible=True))
        else:
            btn_updates.append(gr.update(visible=False))

    return new_history, "", None, session_id, *btn_updates


async def gradio_send_location(
    lat: float | None,
    lon: float | None,
    loc_name: str,
    channel: str,
    session_id: str,
    history: list[dict[str, Any]],
):
    if lat is None or lon is None:
        return history
    res = await process_advisor_turn(
        session_id=session_id,
        channel=channel,
        external_user_id="gradio-tester",
        user_text="",
        location=(float(lat), float(lon), loc_name or "مزرعتي"),
    )
    new_history = list(history or [])
    new_history.append({"role": "user", "content": f"📍 مشاركة الموقع: {loc_name or 'مزرعتي'} ({float(lat):.3f}, {float(lon):.3f})"})
    new_history.append({"role": "assistant", "content": res["answer"]})
    return new_history


def gradio_reset_session():
    new_sid = f"gradio:{uuid.uuid4().hex[:10]}"
    init_msg = [
        {
            "role": "assistant",
            "content": "أهلاً وسهلاً بحضرتك في **المستشار الزراعي الحيوي الذكي (EBDA & Economy of Love)** 🌿\nاختر الخدمة المطلوبة من الأزرار بالأسفل، أو اكتب سؤالك، أو ارفع/صوّر ورقة نبات لتشخيصها عضوياً 100%:",
        }
    ]
    btn_updates = []
    for i in range(MAX_QUICK_BTN):
        if i < len(MAIN_MENU_SUGGESTIONS_AR):
            btn_updates.append(gr.update(value=MAIN_MENU_SUGGESTIONS_AR[i], visible=True))
        else:
            btn_updates.append(gr.update(visible=False))
    return init_msg, "", None, new_sid, *btn_updates


def gradio_registrations_table() -> list[list[str]]:
    return [
        [
            r.get("registration_id", ""),
            r.get("full_name", ""),
            r.get("phone", ""),
            r.get("governorate", ""),
            r.get("land_and_irrigation", ""),
            r.get("crops", ""),
            r.get("support_needed", ""),
        ]
        for r in REGISTRATIONS
    ]


def build_gradio_ui() -> gr.Blocks:
    custom_css = """
    .rtl-wrap { direction: rtl; text-align: right; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; }
    """
    with gr.Blocks(title="AgriPulse — المستشار الزراعي الحيوي (EBDA)", css=custom_css, theme=gr.themes.Soft(primary_hue="emerald")) as blocks:
        session_state = gr.State(value=lambda: f"gradio:{uuid.uuid4().hex[:10]}")
        gr.Markdown(
            "<div class='rtl-wrap'>"
            "<h2>🌿 AgriPulse — المستشار الزراعي العضوي والحيوي (EBDA & Economy of Love)</h2>"
            "<p>مساعد ذكي متكامل مع واتساب وفيسبوك ماسنجر وقاعدة بيانات <b>67 محصولاً</b> · تشخيص أمراض النبات بالصور (Organic 100%) · توصيات الرش بالطقس الحي Open-Meteo</p>"
            "</div>"
        )

        with gr.Row():
            channel_dd = gr.Radio(
                choices=[("الموقع / اختبار كامل", "widget"), ("محاكاة واتساب (WhatsApp)", "whatsapp"), ("محاكاة ماسنجر (Messenger)", "messenger")],
                value="widget",
                label="القناة والتنسيق",
            )
            reset_btn = gr.Button("🔄 محادثة جديدة", variant="secondary")

        chatbot = gr.Chatbot(
            type="messages",
            value=[
                {
                    "role": "assistant",
                    "content": "أهلاً وسهلاً بحضرتك في **المستشار الزراعي الحيوي الذكي (EBDA & Economy of Love)** 🌿\nاختر الخدمة من الأزرار بالأسفل أو اكتب سؤالك أو ارفع صورة النبات للتشخيص العضوي 100%:",
                }
            ],
            height=440,
            rtl=True,
            label="المحادثة التفاعلية",
        )

        with gr.Row():
            quick_btns = [
                gr.Button(
                    value=MAIN_MENU_SUGGESTIONS_AR[i] if i < len(MAIN_MENU_SUGGESTIONS_AR) else "",
                    visible=i < len(MAIN_MENU_SUGGESTIONS_AR),
                    size="sm",
                )
                for i in range(MAX_QUICK_BTN)
            ]

        with gr.Row():
            with gr.Column(scale=3):
                msg_box = gr.Textbox(
                    label="رسالتك أو وصف المشكلة الزراعية",
                    placeholder="اكتب سؤالك هنا (مثال: عايز أسجل، محصول الطماطم، أو أنسب زرعة لأرض رملية)...",
                    lines=2,
                    rtl=True,
                )
                send_btn = gr.Button("إرسال ✉️", variant="primary")
            with gr.Column(scale=2):
                img_input = gr.Image(
                    label="ارفع أو صوّر النبات/الآفة (تشخيص عضوي بالذكاء الاصطناعي)",
                    type="filepath",
                    sources=["upload", "webcam"],
                    height=180,
                )

        with gr.Accordion("📍 اختبار إرسال الموقع الجغرافي (Open-Meteo طقس المزرعة وتوقيت الرش الحيوي)", open=False):
            with gr.Row():
                lat_in = gr.Number(value=30.6667, label="خط العرض (Latitude)")
                lon_in = gr.Number(value=30.0667, label="خط الطول (Longitude)")
                loc_label_in = gr.Textbox(value="النوبارية - البحيرة", label="اسم المنطقة")
                loc_btn = gr.Button("فحص طقس المزرعة وموعد الرش 🌤️")

        with gr.Accordion("📋 سجل المزارعين المسجلين بالجلسة الحالية", open=False):
            reg_df = gr.Dataframe(
                headers=["رقم العضوية", "الاسم", "التليفون", "المحافظة", "المساحة والري", "المحاصيل", "الدعم المطلوب"],
                interactive=False,
            )
            refresh_reg_btn = gr.Button("تحديث جدول المسجلين")

        outputs_list = [chatbot, msg_box, img_input, session_state, *quick_btns]
        send_btn.click(gradio_handle_turn, inputs=[msg_box, img_input, channel_dd, session_state, chatbot], outputs=outputs_list)
        msg_box.submit(gradio_handle_turn, inputs=[msg_box, img_input, channel_dd, session_state, chatbot], outputs=outputs_list)
        reset_btn.click(gradio_reset_session, outputs=outputs_list)

        for btn in quick_btns:
            btn.click(gradio_handle_turn, inputs=[btn, img_input, channel_dd, session_state, chatbot], outputs=outputs_list)

        loc_btn.click(gradio_send_location, inputs=[lat_in, lon_in, loc_label_in, channel_dd, session_state, chatbot], outputs=[chatbot])
        refresh_reg_btn.click(gradio_registrations_table, outputs=[reg_df])

    return blocks


demo = build_gradio_ui()
app = gr.mount_gradio_app(app, demo, path="/")

if __name__ == "__main__":
    port = int(os.environ.get("PORT") or os.environ.get("GRADIO_SERVER_PORT") or "7860")
    uvicorn.run(app, host="0.0.0.0", port=port)
