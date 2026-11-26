import io
import zipfile

from bs4 import BeautifulSoup
from docx import Document as WordDocument
from llama_index.core import Document
from llama_index.core.ingestion import IngestionPipeline
from llama_index.core.node_parser import SentenceSplitter
from pypdf import PdfReader

from .models import Settings


def parse_document(data: bytes, media_type: str, filename: str) -> list[Document]:
    sections: list[tuple[str, int | None]] = []
    if media_type == "application/pdf":
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted or len(reader.pages) > 200:
            raise ValueError("PDF 加密或超过 200 页")
        sections = [(p.extract_text() or "", i + 1) for i, p in enumerate(reader.pages)]
    elif media_type.endswith("wordprocessingml.document"):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(i.file_size for i in archive.infolist()) > 50 * 1024 * 1024:
                raise ValueError("DOCX 解压后超过限制")
        document = WordDocument(io.BytesIO(data))
        text = "\n".join(p.text for p in document.paragraphs)
        text += "\n" + "\n".join(
            " | ".join(c.text for c in r.cells) for t in document.tables for r in t.rows
        )
        sections = [(text, None)]
    else:
        text = data.decode("utf-8-sig")
        if media_type == "text/html":
            soup = BeautifulSoup(text, "html.parser")
            for node in soup(["script", "style", "iframe", "noscript"]):
                node.decompose()
            text = soup.get_text("\n", strip=True)
        sections = [(text, None)]
    if sum(len(text) for text, _ in sections) > 2_000_000:
        raise ValueError("文档提取文本超过限制")
    documents = [
        Document(text=text, metadata={"source": filename, **({"page": page} if page else {})})
        for text, page in sections
        if text.strip()
    ]
    if not documents:
        raise ValueError("没有可提取文本；扫描件需要单独配置 OCR")
    return documents


def split_documents(documents: list[Document], settings: Settings):
    # Character budget is explicit and works across Chinese/English without downloading a tokenizer.
    splitter = SentenceSplitter(
        chunk_size=settings.chunk_size, chunk_overlap=settings.chunk_overlap, tokenizer=list
    )
    nodes = IngestionPipeline(transformations=[splitter]).run(documents=documents)
    if len(nodes) > settings.max_chunks:
        raise ValueError("文档分块数量超过限制")
    return nodes
