import os
import re
import io
import time
import math
import shutil
import tempfile
import datetime
import subprocess
from typing import Callable, Optional, List, Dict, Any

import imageio_ffmpeg
_ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

import pydub
from pydub import AudioSegment
AudioSegment.converter = _ffmpeg_exe
pydub.utils.which = lambda x: _ffmpeg_exe

from groq import Groq

# Common Whisper hallucinations during silence
HALLUCINATIONS = {
    "terima kasih", "terima kasih.", "terima kasih banyak", "terima kasih banyak.",
    "thank you.", "thank you", "subtitles by", "subs by", "you",
    "bye.", "bye", "selamat menonton.", "sampai jumpa", "sampai jumpa.",
    "terima kasih sudah menonton", "terima kasih telah menonton",
    "terima kasih sudah menonton.", "terima kasih telah menonton."
}

def format_timestamp(seconds: float) -> str:
    """Formats seconds into [HH:MM:SS]"""
    total_seconds = max(0, int(seconds))
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    return f"[{h:02d}:{m:02d}:{s:02d}]"

def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    if h > 0:
        return f"{h} jam {m} menit {s} detik"
    elif m > 0:
        return f"{m} menit {s} detik"
    else:
        return f"{s} detik"

def get_audio_info(file_path: str) -> Dict[str, Any]:
    """Gets audio duration and size using ffmpeg stderr output without needing ffprobe"""
    size_bytes = os.path.getsize(file_path)
    size_mb = size_bytes / (1024 * 1024)
    file_name = os.path.basename(file_path)

    cmd = [_ffmpeg_exe, "-i", file_path]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="replace")
    
    duration_sec = 0.0
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", res.stderr)
    if match:
        hours = int(match.group(1))
        mins = int(match.group(2))
        secs = float(match.group(3))
        duration_sec = hours * 3600 + mins * 60 + secs

    return {
        "file_name": file_name,
        "file_size_mb": round(size_mb, 2),
        "duration_seconds": duration_sec,
        "duration_formatted": format_duration(duration_sec) if duration_sec > 0 else "Durasi tidak terdeteksi"
    }

class MeetingTranscriber:
    def __init__(self, api_key: str, model: str = "whisper-large-v3", language: str = "id"):
        self.api_key = api_key
        self.model = model
        self.language = language
        self.client = None
        if api_key:
            self.init_client(api_key)

    def init_client(self, api_key: str):
        self.api_key = api_key
        self.client = Groq(api_key=self.api_key)

    def transcribe_file(
        self,
        file_path: str,
        chunk_minutes: int = 10,
        output_dir: str = "output",
        on_progress: Optional[Callable[[int, str], None]] = None,
        on_segment: Optional[Callable[[str, str, str], None]] = None
    ) -> Dict[str, Any]:
        """
        Transcribes any audio file (even 2+ hours long) by chunking safely and maintaining exact timestamps.
        """
        if not self.client:
            raise ValueError("Groq API Key belum disetel. Masukkan API Key di pengaturan.")

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File audio tidak ditemukan: {file_path}")

        if on_progress:
            on_progress(5, "Mengonversi dan menyiapkan audio rapat...")

        temp_dir = tempfile.mkdtemp(prefix="transcribe_")
        temp_wav_path = os.path.join(temp_dir, "meeting_16k.wav")

        try:
            cmd = [
                _ffmpeg_exe, "-y",
                "-i", file_path,
                "-ac", "1",
                "-ar", "16000",
                "-vn",
                temp_wav_path
            ]
            conv_proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="replace")
            if conv_proc.returncode != 0 or not os.path.exists(temp_wav_path):
                raise RuntimeError(f"Gagal mengonversi file audio: {conv_proc.stderr[:200]}")

            if on_progress:
                on_progress(10, "Membaca data audio yang telah dioptimalkan...")

            audio = AudioSegment.from_wav(temp_wav_path)
            total_duration_ms = len(audio)
            total_duration_sec = total_duration_ms / 1000.0

            chunk_ms = chunk_minutes * 60 * 1000
            num_chunks = max(1, math.ceil(total_duration_ms / chunk_ms))

            all_lines: List[str] = []
            all_segments_data: List[Dict[str, Any]] = []

            default_prompt = (
                "Transkrip percakapan rapat bahasa Indonesia lengkap tanpa diringkas, "
                "percakapan sehari-hari dan istilah kerja kantor."
            )

            if on_progress:
                on_progress(12, f"Total durasi: {format_duration(total_duration_sec)}. Terbagi dalam {num_chunks} bagian.")

            # Process each chunk
            for i in range(num_chunks):
                start_ms = i * chunk_ms
                end_ms = min((i + 1) * chunk_ms, total_duration_ms)
                chunk_audio = audio[start_ms:end_ms]

                chunk_offset_sec = start_ms / 1000.0
                chunk_start_str = format_timestamp(chunk_offset_sec)
                chunk_end_str = format_timestamp(end_ms / 1000.0)

                pct = 12 + int(((i + 0.3) / num_chunks) * 85)
                if on_progress:
                    on_progress(
                        pct,
                        f"Mentranskripsi Bagian {i + 1} dari {num_chunks} ({chunk_start_str} - {chunk_end_str})..."
                    )

                chunk_buffer = io.BytesIO()
                chunk_audio.export(chunk_buffer, format="mp3", bitrate="48k")
                chunk_buffer.seek(0)
                chunk_buffer.name = f"chunk_{i}.mp3"

                retry_count = 0
                response = None
                while retry_count < 3:
                    try:
                        response = self.client.audio.transcriptions.create(
                            model=self.model,
                            file=chunk_buffer,
                            language=self.language,
                            response_format="verbose_json",
                            prompt=default_prompt
                        )
                        break
                    except Exception as e:
                        retry_count += 1
                        time.sleep(2 * retry_count)
                        if retry_count >= 3:
                            raise RuntimeError(f"Gagal memproses bagian {i + 1}: {e}")

                segments = getattr(response, "segments", None)
                if segments is None and isinstance(response, dict):
                    segments = response.get("segments", [])

                if segments:
                    for seg in segments:
                        if isinstance(seg, dict):
                            seg_start = seg.get("start", 0.0)
                            seg_text = seg.get("text", "").strip()
                        else:
                            seg_start = getattr(seg, "start", 0.0)
                            seg_text = getattr(seg, "text", "").strip()

                        if not seg_text or seg_text.lower() in HALLUCINATIONS:
                            continue

                        abs_timestamp_sec = chunk_offset_sec + float(seg_start)
                        ts_badge = format_timestamp(abs_timestamp_sec)
                        formatted_line = f"{ts_badge} {seg_text}"

                        all_lines.append(formatted_line)
                        all_segments_data.append({
                            "timestamp": ts_badge,
                            "seconds": abs_timestamp_sec,
                            "text": seg_text,
                            "full_line": formatted_line
                        })

                        if on_segment:
                            on_segment(ts_badge, seg_text, formatted_line)
                else:
                    full_text = getattr(response, "text", str(response)).strip()
                    if full_text and full_text.lower() not in HALLUCINATIONS:
                        ts_badge = format_timestamp(chunk_offset_sec)
                        formatted_line = f"{ts_badge} {full_text}"
                        all_lines.append(formatted_line)
                        if on_segment:
                            on_segment(ts_badge, full_text, formatted_line)

            os.makedirs(output_dir, exist_ok=True)
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            timestamp_now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            
            output_txt_path = os.path.join(output_dir, f"transkrip_{base_name}_{timestamp_now}.txt")
            output_md_path = os.path.join(output_dir, f"transkrip_{base_name}_{timestamp_now}.md")

            full_transcript_text = "\n".join(all_lines)

            with open(output_txt_path, "w", encoding="utf-8") as f:
                f.write(full_transcript_text + "\n")

            with open(output_md_path, "w", encoding="utf-8") as f:
                f.write(f"# Transkrip Rapat: {base_name}\n")
                f.write(f"- **Waktu Proses**: {datetime.datetime.now().strftime('%d %B %Y, %H:%M:%S')}\n")
                f.write(f"- **Total Durasi**: {format_duration(total_duration_sec)}\n")
                f.write(f"- **File Sumber**: `{os.path.basename(file_path)}`\n\n")
                f.write("## Isi Transkrip Percakapan\n\n")
                for item in all_segments_data:
                    f.write(f"- **`{item['timestamp']}`** {item['text']}\n")

            if on_progress:
                on_progress(100, "Transkripsi selesai 100%!")

            return {
                "success": True,
                "total_lines": len(all_lines),
                "duration_formatted": format_duration(total_duration_sec),
                "all_lines": all_lines,
                "full_text": full_transcript_text,
                "output_txt": output_txt_path,
                "output_md": output_md_path,
                "base_name": base_name
            }
        finally:
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    def _call_llm(self, prompt: str, max_tokens: int = 2500) -> str:
        """Helper to call Groq LLM with fallback and retry logic"""
        models_to_try = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
        last_error = None

        for model in models_to_try:
            for retry in range(2):
                try:
                    resp = self.client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": "Anda adalah notulis rapat profesional yang menyusun notulensi rapat secara komprehensif, terstruktur, mendalam, dan penting dalam Bahasa Indonesia."},
                            {"role": "user", "content": prompt}
                        ],
                        temperature=0.3,
                        max_tokens=max_tokens
                    )
                    return resp.choices[0].message.content.strip()
                except Exception as e:
                    last_error = e
                    # If rate limit exceeded, wait a moment and try
                    time.sleep(3)

        raise RuntimeError(f"Gagal memanggil model Groq: {last_error}")

    def generate_notulensi(
        self,
        transcript_text: str,
        title: str = "",
        output_dir: str = "output",
        base_name: str = "",
        on_status: Optional[Callable[[str], None]] = None
    ) -> Dict[str, Any]:
        """
        Generates comprehensive meeting minutes using Hierarchical Summarization
        so it never hits Groq's 7,000-8,000 token per minute limit even for 2+ hour transcripts.
        """
        if not self.client:
            raise ValueError("Groq API Key belum disetel.")

        if not transcript_text or not transcript_text.strip():
            raise ValueError("Transkrip kosong, tidak bisa membuat notulensi.")

        final_title = title.strip() if title and title.strip() else "Notulensi Rapat"

        if on_status:
            on_status("Mempersiapkan dan mengoptimalkan teks transkrip...")

        # 1. Clean transcript: remove repetitive [HH:MM:SS] badges to reduce token count by 40-50%
        clean_lines = []
        for line in transcript_text.splitlines():
            line = line.strip()
            if not line:
                continue
            content = re.sub(r'^\[\d{2}:\d{2}:\d{2}\]\s*', '', line).strip()
            if len(content) > 2 and content.lower() not in ["ya", "oke", "ok", "iya", "siap", "terima kasih"]:
                clean_lines.append(content)

        # 2. Break into chunks of max 1,800 words (~2,400 tokens, safely below Groq 7,000 ITPM limit)
        max_words_per_chunk = 1800
        chunks = []
        current_chunk = []
        current_words = 0

        for line in clean_lines:
            line_words = len(line.split())
            if current_words + line_words > max_words_per_chunk and current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = [line]
                current_words = line_words
            else:
                current_chunk.append(line)
                current_words += line_words

        if current_chunk:
            chunks.append(" ".join(current_chunk))

        # Case 1: Fits in 1 chunk (<= 1,800 words)
        if len(chunks) == 1:
            if on_status:
                on_status("Menyusun notulensi rapat komprehensif...")

            prompt = f"""Tugas Anda adalah menyusun Notulensi Rapat yang SANGAT KOMPREHENSIF, MENDALAM, DAN DETAIL berdasarkan transkrip berikut.

PANDUAN:
- JANGAN disingkat atau dihilangkan poin pentingnya!
- Tuliskan setiap pokok persoalan, argumen, fakta/data, kendala, dan diskusi secara terperinci.

FORMAT WAJIB:
[Judul]
{final_title}

[Pokok pembahasan]
(Daftar agenda dan topik-topik utama yang didiskusikan secara terstruktur)

[Isi Notulen]
(Uraian pembahasan komprehensif, mendalam, dan mendetail tentang setiap poin diskusi penting, laporan peserta, data/angka, hingga kendala yang dibahas)

[Kesimpulan]
(Ringkasan keputusan akhir, kesepakatan bersama, serta daftar action items / tindak lanjut dan penanggung jawabnya jika ada)

Transkrip Rapat:
---
{chunks[0]}
---
"""
            notulensi_text = self._call_llm(prompt, max_tokens=2200)

        # Case 2: Long meeting (multiple chunks, 1-2+ hours)
        else:
            extracted_sections = []
            for idx, chunk in enumerate(chunks):
                if on_status:
                    on_status(f"Menganalisis isi rapat Bagian {idx + 1} dari {len(chunks)}...")

                chunk_prompt = f"""Tolong catat dan ekstrak seluruh poin pembahasan penting, detail topik, argumen, angka/fakta, kendala, dan laporan dari bagian percakapan rapat berikut (Bagian {idx + 1} dari {len(chunks)}) secara mendalam dan komprehensif:
---
{chunk}
---
"""
                section_notes = self._call_llm(chunk_prompt, max_tokens=1000)
                extracted_sections.append(f"Catatan Bagian {idx + 1}:\n{section_notes}")

                # Wait between chunks so Groq's 7,000 token-per-minute bucket resets
                if idx < len(chunks) - 1:
                    wait_seconds = 18
                    for w in range(wait_seconds, 0, -1):
                        if on_status:
                            on_status(f"Menyiapkan Bagian {idx + 2} (Jeda kuota Groq: {w}s)...")
                        time.sleep(1)

            combined_notes = "\n\n".join(extracted_sections)

            if on_status:
                on_status("Menggabungkan seluruh bagian menjadi notulensi final...")

            final_prompt = f"""Berikut adalah kumpulan catatan lengkap dari seluruh sesi rapat:
---
{combined_notes}
---

Tugas Anda adalah menggabungkan seluruh catatan di atas menjadi dokumen Notulensi Rapat yang SANGAT KOMPREHENSIF, UTUH, MENDALAM, DAN RAPI dengan format wajib berikut:

[Judul]
{final_title}

[Pokok pembahasan]
(Daftar agenda dan topik-topik utama yang didiskusikan secara terstruktur dari awal hingga akhir rapat)

[Isi Notulen]
(Uraian pembahasan komprehensif dan mendalam dari seluruh jalannya rapat. Jelaskan setiap topik penting, data, masukan peserta, kendala, dan diskusi secara detail tanpa diringkas terlalu pendek)

[Kesimpulan]
(Ringkasan kesepakatan akhir, keputusan strategis bersama, serta daftar action items / tindak lanjut dan penanggung jawabnya)
"""
            notulensi_text = self._call_llm(final_prompt, max_tokens=2500)

        # Save to output folder
        os.makedirs(output_dir, exist_ok=True)
        timestamp_now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', final_title)[:40]
        file_prefix = base_name if base_name else safe_title

        output_notulen_md = os.path.join(output_dir, f"notulensi_{file_prefix}_{timestamp_now}.md")
        output_notulen_txt = os.path.join(output_dir, f"notulensi_{file_prefix}_{timestamp_now}.txt")

        with open(output_notulen_md, "w", encoding="utf-8") as f:
            f.write(notulensi_text + "\n")

        with open(output_notulen_txt, "w", encoding="utf-8") as f:
            f.write(notulensi_text + "\n")

        return {
            "success": True,
            "title": final_title,
            "notulensi": notulensi_text,
            "output_md": output_notulen_md,
            "output_txt": output_notulen_txt
        }
