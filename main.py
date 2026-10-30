import os
import sys
import json
import threading
import subprocess

import imageio_ffmpeg
_ffmpeg_dir = os.path.dirname(imageio_ffmpeg.get_ffmpeg_exe())
os.environ["PATH"] = _ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

import webview
from transcriber import MeetingTranscriber, get_audio_info

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
WEB_DIR = os.path.join(BASE_DIR, "web")
INDEX_HTML = os.path.join(WEB_DIR, "index.html")

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print("Error loading config:", e)
    example_file = os.path.join(BASE_DIR, "config.example.json")
    if os.path.exists(example_file):
        try:
            with open(example_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if cfg.get("api_key") == "YOUR_GROQ_API_KEY_HERE":
                    cfg["api_key"] = ""
                return cfg
        except Exception:
            pass
    return {
        "api_key": "",
        "model": "whisper-large-v3",
        "language": "id",
        "chunk_minutes": 10
    }

def save_config_file(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("Error saving config:", e)

class DesktopAPI:
    def __init__(self):
        # All internal properties must start with _ so pywebview doesn't recursively inspect them
        self._window = None
        self._config = load_config()
        self._transcriber = MeetingTranscriber(
            api_key=self._config.get("api_key", ""),
            model=self._config.get("model", "whisper-large-v3"),
            language=self._config.get("language", "id")
        )
        self._is_processing = False

    def _set_window(self, window):
        self._window = window

    # Public API methods exposed to JavaScript
    def get_config(self):
        return self._config

    def save_config(self, new_config):
        self._config.update(new_config)
        save_config_file(self._config)
        self._transcriber.init_client(self._config.get("api_key", ""))
        self._transcriber.model = self._config.get("model", "whisper-large-v3")
        self._transcriber.language = self._config.get("language", "id")
        return True

    def select_file(self):
        """Native Windows File Dialog for selecting audio files"""
        if not self._window:
            return None

        file_types = (
            "Audio Files (*.mp3;*.m4a;*.wav;*.aac;*.mp4;*.m4v;*.flac;*.ogg;*.wma)",
            "All Files (*.*)"
        )
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=file_types
        )

        if result and len(result) > 0:
            file_path = result[0]
            try:
                info = get_audio_info(file_path)
                info["file_path"] = file_path
                return info
            except Exception as e:
                size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 2)
                return {
                    "file_path": file_path,
                    "file_name": os.path.basename(file_path),
                    "file_size_mb": size_mb,
                    "duration_formatted": "Audio siap diproses"
                }
        return None

    def start_transcription(self, file_path):
        if self._is_processing:
            return False

        if not os.path.exists(file_path):
            raise FileNotFoundError("File audio tidak ditemukan.")

        self._is_processing = True

        thread = threading.Thread(target=self._run_transcription_worker, args=(file_path,), daemon=True)
        thread.start()
        return True

    def _run_transcription_worker(self, file_path):
        try:
            chunk_min = int(self._config.get("chunk_minutes", 10))

            def on_progress(pct, msg):
                if self._window:
                    script = f"window.updateProgress({pct}, {json.dumps(msg)});"
                    self._window.evaluate_js(script)

            def on_segment(ts, text, full_line):
                if self._window:
                    script = f"window.appendSegment({json.dumps(ts)}, {json.dumps(text)}, {json.dumps(full_line)});"
                    self._window.evaluate_js(script)

            result = self._transcriber.transcribe_file(
                file_path=file_path,
                chunk_minutes=chunk_min,
                output_dir=OUTPUT_DIR,
                on_progress=on_progress,
                on_segment=on_segment
            )

            if self._window:
                script = f"window.transcriptionFinished({json.dumps(result)});"
                self._window.evaluate_js(script)

        except Exception as e:
            if self._window:
                script = f"window.transcriptionError({json.dumps(str(e))});"
                self._window.evaluate_js(script)
        finally:
            self._is_processing = False

    def generate_notulensi(self, transcript_text, title, base_name=""):
        """Generates structured notulensi in background thread"""
        def _worker():
            try:
                res = self._transcriber.generate_notulensi(
                    transcript_text=transcript_text,
                    title=title,
                    output_dir=OUTPUT_DIR,
                    base_name=base_name
                )
                if self._window:
                    self._window.evaluate_js(f"window.notulensiFinished({json.dumps(res)});")
            except Exception as e:
                if self._window:
                    self._window.evaluate_js(f"window.notulensiError({json.dumps(str(e))});")

        thread = threading.Thread(target=_worker, daemon=True)
        thread.start()
        return True

    def copy_to_clipboard(self, text):
        """Copies text to Windows Clipboard"""
        try:
            import tkinter as tk
            r = tk.Tk()
            r.withdraw()
            r.clipboard_clear()
            r.clipboard_append(text)
            r.update()
            r.destroy()
            return True
        except Exception:
            try:
                proc = subprocess.Popen(['powershell', '-command', 'Set-Clipboard', '-Value', '$input'], stdin=subprocess.PIPE)
                proc.communicate(input=text.encode('utf-8'))
                return True
            except Exception as e:
                print("Clipboard error:", e)
                return False

    def save_dialog(self, content, default_name="dokumen", extension="txt"):
        """Native Windows Save File Dialog"""
        if not self._window:
            return False

        file_types = (f"File (*.{extension})", "All Files (*.*)")
        result = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=f"{default_name}.{extension}",
            file_types=file_types
        )

        if result:
            save_path = result if isinstance(result, str) else result[0]
            with open(save_path, "w", encoding="utf-8") as f:
                f.write(content)
            return True
        return False

    def open_output_folder(self):
        """Opens output directory in Windows File Explorer"""
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.startfile(OUTPUT_DIR)
        return True


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    api = DesktopAPI()
    
    # Create pywebview desktop window
    window = webview.create_window(
        title="🎙️ Transkrip Rapat Offline & Notulensi AI (Groq)",
        url=INDEX_HTML,
        js_api=api,
        width=1120,
        height=780,
        min_size=(860, 620)
    )
    api._set_window(window)
    
    # Explicitly expose API functions to JavaScript
    window.expose(
        api.select_file,
        api.start_transcription,
        api.generate_notulensi,
        api.get_config,
        api.save_config,
        api.copy_to_clipboard,
        api.save_dialog,
        api.open_output_folder
    )
    
    webview.start(debug=False)


if __name__ == "__main__":
    main()
