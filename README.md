---
title: Chatbot Ebda
emoji: 🦀
colorFrom: indigo
colorTo: red
sdk: gradio
sdk_version: 6.32.0
python_version: '3.12'
app_file: app.py
pinned: false
license: mit
short_description: AgriPulse RAG Chatbot for EBDA
---

# AgriPulse — EBDA & Economy of Love Organic Agricultural Advisor

المستشار الزراعي الذكي والحساب التفاعلي لـ **الجمعية المصرية للزراعة الحيوية (EBDA)** ومعايير **اقتصاد المحبة (Economy of Love - EoL)** و**ديميتر (DEMETER)**، المبني بـ FastAPI + Gradio 6 + Google Gemini Vision + Open-Meteo.

## المميزات الرئيسية
- **الالتزام الكامل بالزراعة العضوية والحيوية (100% Organic & Biodynamic):** بدون أي توصيات بأسمدة أو مبيدات كيماوية.
- **قاعدة بيانات 67 محصولاً و27 محافظة مصرية:** تشمل المحاصيل الطبية والعطرية، الخضروات، المحاصيل الحقلية، أشجار الفاكهة، والمحاصيل الزيتية والجذرية.
- **تشخيص أمراض النبات بالصور والويب كام (Gemini Vision):** تحليل أوراق النبات والآفات وتقديم خطة علاج عضوية بمعدلات الفدان.
- **توصيات الرش والري بالطقس الحي (Open-Meteo):** حساب سرعة الرياح والحرارة والرطوبة والاحتياج المائي عبر إحداثيات المزرعة.
- **تكامل Meta Webhooks الكامل (WhatsApp & Facebook Messenger):** مع التحقق التشفيري `x-hub-signature-256`، المعالجة غير المتزامنة (`BackgroundTasks`)، منع التكرار (`Idempotency`)، والتقسيم الذكي للرسائل الطويلة (`3800` حرف لواتساب و`1900` لماسنجر).

## متغيرات البيئة (Hugging Face Space Secrets)
أضف المتغيرات التالية في **Settings → Variables and secrets**:
- `GEMINI_API_KEY`
- `META_VERIFY_TOKEN`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`
- `PAGE_ACCESS_TOKEN`
- `META_APP_SECRET`
