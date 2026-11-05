"""Expert Agricultural & Business Analytics Advisor Persona (Arabic, Direct, Grounded, 100% Organic)."""
from typing import Any

ADVISOR_SYSTEM_INSTRUCTION = """أنت مستشار خبير في الزراعة الحيوية والعضوية وتحليلات الأعمال الزراعية تابع لـ **الجمعية المصرية للزراعة الحيوية (EBDA)** (تأسست عام 1990 ومسجلة بوزارة التضامن الاجتماعي المصرية، وتدير علامة **ديميتر DEMETER** ومعيار شهادة **اقتصاد المحبة Economy of Love - EoL** بالتعاون مع المشروع الألماني-المصري **SI/EoL** الممول من **BMZ** وتنفيذ **bbw gGmbH** و**sequa gGmbH**).

قواعد صارمة للأسلوب والمخرجات:
1. اللغة والأسلوب: **اللهجة المصرية المبسطة والواضحة** المناسبة للمزارع المصري؛ أسلوب مباشر، عملي، منظم في نقاط محددة بمعدلات واضحة للفدان، وبدون أي حشو أو مقدمات إنشائية.
2. ممنوع المقدمات المتكررة أو الألقاب: لا تبدأ الرد أبداً بـ "أهلاً بيك" أو "مرحباً"، وممنوع استخدام أي ألقاب شعبية. ادخل في الإجابة والتحليل مباشرة من السطر الأول.
3. الالتزام الصارم بالسياق المسترجع والمحاور السبعة والأسئلة الشائعة:
   - اعتمد بدقة على السجلات المسترجعة من **Google Sheets** وقاعدة بيانات المحاصيل ومرجع EBDA في `ChromaDB`.
   - غطِّ بوضوح المحاور السبعة (الاحتياجات البيئية، البذور والشتلات وتحضير الأرض، طرق الري وتكلفتها والملوحة وتحاليل المياه، التسميد بالكمبوست والأسمدة السائلة وأماكن شراء المدخلات المعتمدة، المكافحة الحيوية والحشائش، الحصاد، ومعاملات ما بعد الحصاد والتصنيع والنقل والتخزين والتسويق وشهادات الكربون Carbon Credits).
   - إذا طلب المزارع ترشيح أنسب محصول لتربته ولم يحدد (نوع التربة/الملوحة، وقت الزراعة، المساحة ونظام الري)، اطرح عليه أسئلة استشارية ذكية ومختصرة لتحديد الأنسب له بدقة.
4. زراعة عضوية وحيوية (Organic & Biodynamic 100%) فقط:
   - يُحظر نهائياً التوصية بأي أسمدة كيماوية مخلقة (يوريا، نترات، NPK كيماوي، سوبر فوسفات كيماوي) أو مبيدات كيماوية مصنعة أو تبخير بالفوسفين.
    - اعتمد حصرياً على البدائل العضوية والحيوية المعتمدة (الكمبوست تام التحلل، الفيرمي كمبوست، شاي الكمبوست، صخر الفوسفات، الفلسبار، الكبريت الزراعي، مستحضرات ديميتر BD 500/501، زيت النيم، الصابون البوتاسي، باسيلس، ترايكوديرما، كروت الترايكوجراما) بمعدلات واضحة للفدان.
5. تخصيص صياغة وتنسيق الرد حسب القناة (واتساب · فيسبوك ماسنجر · موقع الشركة/الجمعية):
   - واتساب (whatsapp): نقاط مختصرة جداً للموبايل (4–6 نقاط، أقل من 750 حرفاً)، خط عريض بنجمة واحدة *نص* وعلامة • للنقاط بدون ** أو #.
   - فيسبوك ماسنجر (messenger): نص عربي صافي بدون أي رموز Markdown (** أو * أو #)، عناوين بعلامة ▪ ونقاط بعلامة •.
   - الموقع الرسمي للشركة/الجمعية (widget): إجابة منظمة بعناوين فرعية (**عنوان:**) ونقاط تفصيلية بمعدلات الفدان.
6. فحص وتشخيص صور النباتات والمحاصيل (Vision AI) بالعامية المصرية:
   - عند إرفاق صورة ورقة أو نبات أو محصول:
     1) حدد اسم المحصول أو النبات الظاهر في الصورة.
     2) شخص حالة النبات بدقة (مرض فطري، آفة حشرية، نقص عناصر، مشاكل ري، أو أن النبات سليم وممتاز).
     3) قدم خطة العلاج والمكافحة العضوية والحيوية 100% المعتمدة فوراً بمعدلات الفدان وطرق الاستخدام بدون أي كيماويات نهائياً.
     4) إذا كانت الصورة غير واضحة أو مهزوزة أو ليست لنبات/محصول زراعي أصلاً، اشرح للمزارع بلطف بالعامية المصرية كيفية تصوير الورقة المصابة بوضوح وإعادة رفعها.
"""

import re

CHOICE_SHORT_MAP_20: dict[str, str] = {
    "تسجيل في الجمعية (EBDA)": "تسجيل بالجمعية",
    "عن الجمعية واقتصاد المحبة": "عن الجمعية والمحبة",
    "موضوعات الزراعة العضوية": "موضوعات العضوية",
    "الأسئلة الشائعة (FAQs)": "الأسئلة الشائعة",
    "هل توجد مشكلة في محصول؟": "مشكلة في محصول؟",
    "ترشيح أنسب محصول لأرضي": "ترشيح محصول لأرضي",
    "دليل زراعة محصول كامل": "دليل زراعة محصول",
    "أخرى (سؤال آخر)": "أخرى (سؤال آخر)",
}


def shorten_choice_title(label: str, max_len: int = 20) -> str:
    clean = re.sub(r"\s+", " ", (label or "")).strip()
    if len(clean) <= max_len:
        return clean
    if clean in CHOICE_SHORT_MAP_20 and len(CHOICE_SHORT_MAP_20[clean]) <= max_len:
        return CHOICE_SHORT_MAP_20[clean]
    no_parens = re.sub(r"\s*\([^)]*\)", "", clean).strip()
    if 4 <= len(no_parens) <= max_len:
        return no_parens
    src = no_parens if len(no_parens) >= 4 else clean
    budget = max(4, max_len - 1)
    chunk = src[: budget + 1]
    space_idx = chunk.rfind(" ")
    if space_idx >= max_len // 2:
        return chunk[:space_idx].rstrip("،,:.-؟?") + "…"
    return src[:budget].strip() + "…"


def format_message_for_channel(
    raw_text: str,
    channel: str = "widget",
    has_interactive_choices: bool = False,
) -> str:
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
        limit = 1005 if has_interactive_choices else 3950
        if len(wa) > limit:
            head = wa[: limit - 65]
            cut_idx = head.rfind("\n")
            wa = (head[:cut_idx] if cut_idx > 200 else head).strip()
            if wa.count("*") % 2 == 1:
                wa += "*"
            if has_interactive_choices:
                wa += "\n\n_للمزيد من التفاصيل اختر من القائمة بالأسفل._"
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
        if len(fb) > 1920:
            head = fb[:1840]
            cut_idx = head.rfind("\n")
            fb = (head[:cut_idx] if cut_idx > 200 else head).strip() + "\n\nاختر من الأزرار بالأسفل للمتابعة."
        return fb

    return re.sub(r"\n{3,}", "\n\n", trimmed).strip()


def build_rag_augmented_prompt(
    user_query: str,
    retrieved_chunks: list[dict[str, Any]],
    farm_context: dict[str, Any],
    channel: str = "widget",
) -> str:
    context_lines = []
    for key, label in [
        ("farm_name", "المزرعة"),
        ("region", "المنطقة / المحافظة"),
        ("farm_size_ha", "المساحة (فدان)"),
        ("primary_crops", "المحاصيل"),
        ("soil_type", "نوع التربة"),
        ("soil_ph", "حموضة التربة pH"),
        ("irrigation_type", "نظام الري"),
        ("currency", "العملة"),
    ]:
        val = farm_context.get(key)
        if val not in (None, "", []):
            context_lines.append(f"- {label}: {val}")

    farm_block = "\n".join(context_lines) if context_lines else "- المرجع القياسي: لكل 1 فدان."

    if retrieved_chunks:
        chunk_blocks = []
        for idx, chunk in enumerate(retrieved_chunks, start=1):
            source = chunk.get("source", "unknown")
            section = chunk.get("section", "")
            score = chunk.get("similarity", 0.0)
            header = f"[{idx}] المصدر: {source}" + (f" ({section})" if section else "") + f" | التطابق: {score:.3f}"
            chunk_blocks.append(f"{header}\n{chunk.get('text', '').strip()}")
        rag_block = "\n\n".join(chunk_blocks)
    else:
        rag_block = "لا توجد سجلات مطابقة مباشرة في الشيت لهذا السؤال؛ قدم توصية عضوية 100% مبسطة ومباشرة للفدان أو اطلب توضيح المعطيات الناقصة باختصار."

    if channel == "whatsapp":
        channel_rule = "صِغ الرد لتطبيق واتساب على الموبايل: 4–6 نقاط قصيرة بعلامة • وعناوين بنجمة واحدة *عنوان* وأقل من 750 حرفاً بدون ** أو #."
    elif channel == "messenger":
        channel_rule = "صِغ الرد لتطبيق فيسبوك ماسنجر: نص عربي صافي بدون أي نجوم ** أو * أو #، مع نقاط قصيرة بعلامة • وعناوين بعلامة ▪."
    else:
        channel_rule = "صِغ الرد للموقع الرسمي للشركة/الجمعية: إجابة منظمة وواضحة بعناوين فرعية (**عنوان:**) ونقاط عملية بمعدلات الفدان."

    return (
        f"[القناة]: {channel.upper()}\n"
        f"[قاعدة تنسيق القناة]: {channel_rule}\n\n"
        f"[معطيات المزرعة]:\n{farm_block}\n\n"
        f"[السجلات الزراعية المسترجعة من Google Sheets / ChromaDB]:\n{rag_block}\n\n"
        f"[سؤال المستخدم]:\n{user_query.strip()}\n\n"
        f"أجب باللغة العربية مباشرةً في نقاط منظمة ومختصرة ومبنية على السياق المسترجع أعلاه، بدون أي مقدمات ترحيبية وبدون أي كيماويات."
    )
