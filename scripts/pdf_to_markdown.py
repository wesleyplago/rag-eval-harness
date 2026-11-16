#!/usr/bin/env python3
"""Converts the Banco Central PIX initiation manual (PDF) to markdown.

The PDF is an official publication; pypdf gives us the text, this script rebuilds
headings and paragraphs. It is intentionally heuristic and its output is reviewed
in the repo — the committed markdown is the source of truth for ingest.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from pypdf import PdfReader


def is_toc(text: str) -> bool:
    return text.count("....") > 20


def clean_page(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            lines.append("")
            continue
        if line in {"Público", "Público."}:
            continue
        if re.fullmatch(r"\d{1,3}", line):
            continue
        if re.fullmatch(r"[ivxlc]{1,4}", line, re.I):
            continue
        lines.append(line)
    return lines


def is_heading(line: str) -> bool:
    if re.match(r"^(ANEXO|APÊNDICE)\b", line, re.I) and len(line) < 80:
        return True
    match = re.match(r"^(\d+(?:\.\d+)*)\.?\s+(.{3,110})$", line)
    if not match:
        return False
    title = match.group(2).strip()
    if title.endswith(".") or "...." in title:
        return False
    words = title.split()
    if len(words) < 2 or len(words) > 14:
        return False
    uppercase_ratio = sum(1 for w in words if w[:1].isupper()) / len(words)
    return uppercase_ratio >= 0.5 and not title.endswith(":")


def convert(pdf_path: Path, title: str) -> str:
    reader = PdfReader(str(pdf_path))
    blocks: list[str] = [f"# {title}", ""]
    paragraph: list[str] = []
    heading_level = 2

    def flush() -> None:
        nonlocal paragraph
        if not paragraph:
            return
        text = " ".join(part.strip() for part in paragraph)
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"(?<=\w)-\s+(?=\w)", "", text)
        if text:
            blocks.append(text)
            blocks.append("")
        paragraph = []

    for page in reader.pages:
        text = page.extract_text() or ""
        if is_toc(text):
            continue
        for line in clean_page(text):
            if line == "":
                flush()
                continue
            if is_heading(line):
                flush()
                match = re.match(r"^(\d+(?:\.\d+)*)\.?\s+(.*)$", line)
                if match:
                    number = match.group(1)
                    heading_level = min(5, 2 + number.count("."))
                    blocks.append(f"{'#' * heading_level} {number}. {match.group(2).strip()}")
                else:
                    blocks.append(f"## {line}")
                blocks.append("")
                continue
            if line.startswith(("•", "–", "-")):
                flush()
                blocks.append(f"- {line.lstrip('•–- ').strip()}")
                blocks.append("")
                continue
            paragraph.append(line)

    flush()
    return "\n".join(blocks).replace("\n\n\n", "\n\n").strip() + "\n"


if __name__ == "__main__":
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    name = sys.argv[3] if len(sys.argv) > 3 else "Manual de Padrões para Iniciação do Pix"
    destination.write_text(convert(source, name), encoding="utf-8")
    print(f"wrote {destination} ({destination.stat().st_size} bytes)")
