"""ChromaDB + Official google-genai RAG Pipeline for Excel (.xlsx), PDF, CSV, JSON, and Live APIs."""
from datetime import datetime, timezone
import csv
import hashlib
import json
from pathlib import Path
from typing import Any

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from google import genai
from openpyxl import load_workbook
from pypdf import PdfReader

from .config import settings


class GeminiGenAIEmbeddingFunction(EmbeddingFunction[Documents]):
    """Official google-genai SDK embedding adapter for ChromaDB vector collections."""

    def __init__(self, client: genai.Client, model_name: str = "gemini-embedding-2-preview") -> None:
        self._client = client
        self._model_name = model_name

    def __call__(self, input: Documents) -> Embeddings:
        embeddings: Embeddings = []
        batch_size = 20
        for i in range(0, len(input), batch_size):
            batch = list(input[i : i + batch_size])
            response = self._client.models.embed_content(
                model=self._model_name,
                contents=batch,
            )
            for emb in response.embeddings or []:
                embeddings.append(list(emb.values))
        return embeddings


class AgronomyRAGPipeline:
    """Manages Google Sheets rows, local CSV/XLSX/PDF ingestion, ChromaDB embeddings, and semantic retrieval."""

    def __init__(self, genai_client: genai.Client, in_memory: bool = False) -> None:
        self.genai_client = genai_client
        if in_memory:
            self.chroma_client = chromadb.EphemeralClient()
        else:
            Path(settings.chroma_persist_dir).mkdir(parents=True, exist_ok=True)
            self.chroma_client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
        self.embedding_fn = GeminiGenAIEmbeddingFunction(
            client=genai_client,
            model_name=settings.embedding_model,
        )
        self.collection = self.chroma_client.get_or_create_collection(
            name=settings.chroma_collection,
            embedding_function=self.embedding_fn,
            metadata={"hnsw:space": "cosine"},
        )

    @staticmethod
    def _chunk_id(source: str, section: str, text: str) -> str:
        digest = hashlib.sha256(f"{source}::{section}::{text}".encode("utf-8")).hexdigest()[:20]
        return f"chk_{digest}"

    def ingest_directory(self, data_dir: str | None = None) -> dict[str, Any]:
        """Scan local ./data folder for Excel (.xlsx), PDF, CSV, and JSON files and upsert into ChromaDB."""
        folder = Path(data_dir or settings.data_dir)
        folder.mkdir(parents=True, exist_ok=True)
        ingested_files = 0
        total_chunks = 0

        for path in sorted(folder.iterdir()):
            if not path.is_file() or path.name.startswith(".") or path.name.startswith("~$"):
                continue
            ext = path.suffix.lower()
            if ext in {".xlsx", ".pdf", ".csv", ".json", ".txt", ".md"}:
                count = self.ingest_file(path)
                ingested_files += 1
                total_chunks += count

        return {
            "files_processed": ingested_files,
            "chunks_upserted": total_chunks,
            "collection_count": self.collection.count(),
        }

    def ingest_file(self, path: Path) -> int:
        ext = path.suffix.lower()
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        chunks: list[tuple[str, dict[str, Any]]] = []

        if ext == ".xlsx":
            wb = load_workbook(filename=str(path), read_only=True, data_only=True)
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                rows = [
                    [("" if cell is None else str(cell).strip()) for cell in row]
                    for row in ws.iter_rows(values_only=True)
                ]
                non_empty = [r for r in rows if any(c != "" for c in r)]
                if len(non_empty) < 2:
                    continue
                # Pick first row with >=2 populated cells as header row
                header_idx = 0
                for idx, candidate in enumerate(non_empty[:4]):
                    if sum(1 for c in candidate if c) >= 2:
                        header_idx = idx
                        break
                headers = [
                    h if h else f"عمود_{i + 1}" for i, h in enumerate(non_empty[header_idx])
                ]
                for row_num, values in enumerate(non_empty[header_idx + 1 :], start=1):
                    pairs = [
                        f"{headers[i]}: {val}"
                        for i, val in enumerate(values)
                        if i < len(headers) and val != ""
                    ]
                    if not pairs:
                        continue
                    primary = values[0] if values and values[0] else f"صف {row_num}"
                    passage = f"شيت إكسيل ({sheet_name}) — {primary}: " + " | ".join(pairs)
                    chunks.append(
                        (
                            passage,
                            {
                                "source": path.name,
                                "format": "XLSX",
                                "section": f"{sheet_name} · صف {row_num} ({primary})",
                                "source_type": "local_file",
                                "ingested_at": now_iso,
                            },
                        )
                    )
            wb.close()

        elif ext == ".pdf":
            reader = PdfReader(str(path))
            for page_idx, page in enumerate(reader.pages, start=1):
                raw = (page.extract_text() or "").strip()
                if not raw:
                    continue
                for sub_idx, chunk_text in enumerate(self._sliding_chunks(raw, max_chars=900, overlap=140), start=1):
                    chunks.append(
                        (
                            chunk_text,
                            {
                                "source": path.name,
                                "format": "PDF",
                                "section": f"Page {page_idx}.{sub_idx}",
                                "source_type": "local_file",
                                "ingested_at": now_iso,
                            },
                        )
                    )
        elif ext == ".csv":
            with path.open("r", encoding="utf-8-sig") as fh:
                reader = csv.DictReader(fh)
                for row_idx, row in enumerate(reader, start=1):
                    primary = next(iter(row.values()), f"Row {row_idx}")
                    kv_pairs = [f"{k}: {v}" for k, v in row.items() if v is not None and str(v).strip() != ""]
                    passage = f"سجل جدول ({primary}) — " + " | ".join(kv_pairs)
                    chunks.append(
                        (
                            passage,
                            {
                                "source": path.name,
                                "format": "CSV",
                                "section": f"Row {row_idx} ({primary})",
                                "source_type": "local_file",
                                "ingested_at": now_iso,
                            },
                        )
                    )
        elif ext == ".json":
            data = json.loads(path.read_text(encoding="utf-8"))
            for section, passage in self._flatten_json_records(data):
                chunks.append(
                    (
                        passage,
                        {
                            "source": path.name,
                            "format": "JSON",
                            "section": section,
                            "source_type": "local_file",
                            "ingested_at": now_iso,
                        },
                    )
                )
        else:
            raw = path.read_text(encoding="utf-8").strip()
            for sub_idx, chunk_text in enumerate(self._sliding_chunks(raw, max_chars=900, overlap=140), start=1):
                chunks.append(
                    (
                        chunk_text,
                        {
                            "source": path.name,
                            "format": ext.lstrip(".").upper() or "TXT",
                            "section": f"Segment {sub_idx}",
                            "source_type": "local_file",
                            "ingested_at": now_iso,
                        },
                    )
                )

        if not chunks:
            return 0

        ids = [self._chunk_id(meta["source"], meta["section"], text) for text, meta in chunks]
        documents = [text for text, _ in chunks]
        metadatas = [meta for _, meta in chunks]
        self.collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
        return len(chunks)

    def upsert_dynamic_records(
        self,
        source_name: str,
        format_label: str,
        records: list[dict[str, str]],
        source_type: str = "live_api",
    ) -> int:
        if not records:
            return 0
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        ids, docs, metas = [], [], []
        for rec in records:
            section = rec.get("section", "Live Record")
            text = rec["text"].strip()
            rec_id = hashlib.sha256(f"{source_name}::{section}".encode("utf-8")).hexdigest()[:20]
            ids.append(f"dyn_{rec_id}")
            docs.append(text)
            metas.append(
                {
                    "source": source_name,
                    "format": format_label,
                    "section": section,
                    "source_type": source_type,
                    "ingested_at": now_iso,
                }
            )
        self.collection.upsert(ids=ids, documents=docs, metadatas=metas)
        return len(ids)

    def retrieve(self, query: str, top_k: int = 6, min_similarity: float = 0.25) -> list[dict[str, Any]]:
        if self.collection.count() == 0:
            return []
        n_results = min(top_k, self.collection.count())
        res = self.collection.query(
            query_texts=[query],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        ids = (res.get("ids") or [[]])[0]

        ranked: list[dict[str, Any]] = []
        for chunk_id, doc, meta, dist in zip(ids, docs, metas, dists):
            similarity = max(0.0, 1.0 - float(dist))
            if similarity < min_similarity:
                continue
            ranked.append(
                {
                    "id": chunk_id,
                    "text": doc,
                    "source": (meta or {}).get("source", "unknown"),
                    "format": (meta or {}).get("format", "TXT"),
                    "section": (meta or {}).get("section", ""),
                    "source_type": (meta or {}).get("source_type", "local_file"),
                    "ingested_at": (meta or {}).get("ingested_at", ""),
                    "similarity": round(similarity, 4),
                }
            )
        return ranked

    @staticmethod
    def _sliding_chunks(text: str, max_chars: int = 900, overlap: int = 140) -> list[str]:
        clean = "\n".join(line.strip() for line in text.splitlines() if line.strip())
        if len(clean) <= max_chars:
            return [clean]
        chunks = []
        start = 0
        while start < len(clean):
            end = min(len(clean), start + max_chars)
            chunks.append(clean[start:end])
            if end >= len(clean):
                break
            start = max(start + 1, end - overlap)
        return chunks

    @staticmethod
    def _flatten_json_records(data: Any, prefix: str = "Root") -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        if isinstance(data, dict):
            for key, val in data.items():
                if isinstance(val, list):
                    for idx, item in enumerate(val, start=1):
                        if isinstance(item, dict):
                            label = (
                                item.get("pest_or_disease")
                                or item.get("topic")
                                or item.get("investment")
                                or f"{key} #{idx}"
                            )
                            body = "; ".join(
                                f"{k}: {json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v}"
                                for k, v in item.items()
                            )
                            out.append((str(label), f"{key} — {label}: {body}"))
                        else:
                            out.append((f"{key}[{idx}]", f"{key}: {item}"))
                elif isinstance(val, dict):
                    out.extend(AgronomyRAGPipeline._flatten_json_records(val, prefix=f"{prefix}.{key}"))
        return out
