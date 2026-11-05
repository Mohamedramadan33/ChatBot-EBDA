"""Streamlit Local Testing Interface for AgriPulse Arabic RAG (gemini-2.5-flash + Google Sheets + ChromaDB)."""
from __future__ import annotations

import asyncio
import streamlit as st
from google import genai
from google.genai import types

from python_backend.config import settings
from python_backend.google_sheets_connector import sync_google_sheet_live
from python_backend.persona import ADVISOR_SYSTEM_INSTRUCTION, build_rag_augmented_prompt
from python_backend.rag_pipeline import AgronomyRAGPipeline

st.set_page_config(
    page_title="المستشار الزراعي الذكي — اختبار Google Sheets + ChromaDB RAG",
    layout="wide",
)

st.markdown(
    """
    <style>
    .stApp { direction: rtl; text-align: right; }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource
def get_rag_engine() -> tuple[genai.Client, AgronomyRAGPipeline]:
    client = genai.Client(api_key=settings.gemini_api_key)
    pipeline = AgronomyRAGPipeline(genai_client=client)
    pipeline.ingest_directory()
    return client, pipeline


genai_client, rag_pipeline = get_rag_engine()

st.title("المستشار الزراعي وتحليلات الأعمال (Gemini 2.5 Flash + ChromaDB RAG)")

with st.sidebar:
    st.subheader("1. مزامنة Google Sheets الحية")
    sheet_url = st.text_input(
        "رابط أو معرّف Google Sheet",
        placeholder="https://docs.google.com/spreadsheets/d/...",
    )
    oauth_token = st.text_input("OAuth Bearer Token (اختياري للشيت الخاص)", type="password")
    if st.button("مزامنة البيانات وتحديث ChromaDB", use_container_width=True):
        if not sheet_url.strip():
            st.warning("أدخل رابط أو معرّف Google Sheet أولاً.")
        else:
            with st.spinner("جاري سحب الصفوف وتوليد تضمينات google-genai..."):
                res = asyncio.run(
                    sync_google_sheet_live(
                        rag=rag_pipeline,
                        spreadsheet_url_or_id=sheet_url.strip(),
                        bearer_token=oauth_token.strip() or None,
                    )
                )
                st.success(f"تمت فهرسة {res.get('rows_ingested', 0)} سجل من ({res.get('title', 'Google Sheet')}).")

    st.divider()
    st.metric("إجمالي السجلات المفهرسة في ChromaDB", rag_pipeline.collection.count())
    st.caption(f"نموذج التوليد: `{settings.generation_model}`")
    st.caption(f"نموذج التضمين: `{settings.embedding_model}`")

if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if msg.get("citations"):
            with st.expander(f"السجلات المسترجعة من ChromaDB ({len(msg['citations'])})"):
                for c in msg["citations"]:
                    st.markdown(f"- **{c['source']}** ({c['section']}) — تطابق `{c['similarity']}`\n  {c['text']}")

if prompt := st.chat_input("تفضل بكتابة سؤالك الزراعي أو التحليلي..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        retrieved = rag_pipeline.retrieve(prompt, top_k=5, min_similarity=0.15)
        augmented = build_rag_augmented_prompt(
            user_query=prompt,
            retrieved_chunks=retrieved,
            farm_context={},
            channel="streamlit_test",
        )
        response = genai_client.models.generate_content(
            model=settings.generation_model,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=augmented)])],
            config=types.GenerateContentConfig(
                system_instruction=ADVISOR_SYSTEM_INSTRUCTION,
            ),
        )
        answer = (response.text or "").strip()
        st.markdown(answer)
        if retrieved:
            with st.expander(f"السجلات المسترجعة من ChromaDB ({len(retrieved)})"):
                for c in retrieved:
                    st.markdown(f"- **{c['source']}** ({c['section']}) — تطابق `{c['similarity']}`\n  {c['text']}")

    st.session_state.messages.append({"role": "assistant", "content": answer, "citations": retrieved})
