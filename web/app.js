// State
let selectedFilePath = null;
let allSegments = []; // array of {timestamp, text, fullLine}
let currentConfig = {};

// DOM Elements
const dropZone = document.getElementById("drop-zone");
const dropText = document.getElementById("drop-text");
const fileInfoBox = document.getElementById("file-info-box");
const infoName = document.getElementById("info-name");
const infoSize = document.getElementById("info-size");
const infoDuration = document.getElementById("info-duration");
const btnTranscribe = document.getElementById("btn-transcribe");

const progressCard = document.getElementById("progress-card");
const progressPct = document.getElementById("progress-pct");
const progressFill = document.getElementById("progress-fill");
const progressStatus = document.getElementById("progress-status");
const progressPhase = document.getElementById("progress-phase");

const transcriptList = document.getElementById("transcript-list");
const emptyState = document.getElementById("empty-state");
const badgeCount = document.getElementById("badge-count");
const footerStats = document.getElementById("footer-stats");
const searchInput = document.getElementById("search-input");

const btnCopy = document.getElementById("btn-copy");
const btnDownloadTxt = document.getElementById("btn-download-txt");
const btnDownloadMd = document.getElementById("btn-download-md");
const btnOpenFolder = document.getElementById("btn-open-folder");

const btnSettings = document.getElementById("btn-settings");
const settingsModal = document.getElementById("settings-modal");
const modalClose = document.getElementById("modal-close");
const btnCancelSettings = document.getElementById("btn-cancel-settings");
const btnSaveSettings = document.getElementById("btn-save-settings");

const cfgApiKey = document.getElementById("cfg-api-key");
const cfgModel = document.getElementById("cfg-model");
const cfgLanguage = document.getElementById("cfg-language");
const cfgChunk = document.getElementById("cfg-chunk");

// Helper to safely call Python API functions
async function callApi(fnName, ...args) {
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api[fnName] === "function") {
    return await window.pywebview.api[fnName](...args);
  }
  throw new Error(`Fungsi API '${fnName}' sedang diinisialisasi atau belum siap.`);
}

// Initialize config
async function initApp() {
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.get_config) {
      currentConfig = await window.pywebview.api.get_config();
      populateConfig(currentConfig);
    }
  } catch (e) {
    console.error("Inisialisasi config error:", e);
  }
}

window.addEventListener("pywebviewready", initApp);
setTimeout(initApp, 400);

function populateConfig(cfg) {
  if (!cfg) return;
  if (cfg.api_key) cfgApiKey.value = cfg.api_key;
  if (cfg.model) cfgModel.value = cfg.model;
  if (cfg.language) cfgLanguage.value = cfg.language;
  if (cfg.chunk_minutes) cfgChunk.value = cfg.chunk_minutes;
}

// 1. File Selection Handler
dropZone.addEventListener("click", async () => {
  try {
    const fileData = await callApi("select_file");
    if (fileData) {
      handleSelectedFile(fileData);
    }
  } catch (err) {
    alert("Gagal memilih file: " + err.message);
  }
});

// Drag & Drop visual feedback
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  try {
    const fileData = await callApi("select_file");
    if (fileData) handleSelectedFile(fileData);
  } catch (err) {
    alert("Gagal memilih file: " + err.message);
  }
});

function handleSelectedFile(data) {
  if (!data || !data.file_path) return;
  selectedFilePath = data.file_path;

  infoName.textContent = data.file_name;
  infoSize.textContent = `${data.file_size_mb} MB`;
  infoDuration.textContent = data.duration_formatted;

  fileInfoBox.style.display = "block";
  btnTranscribe.disabled = false;
  dropText.textContent = `File terpilih: ${data.file_name}`;
  footerStats.textContent = `File siap: ${data.file_name} (${data.duration_formatted})`;
}

// 2. Start Transcription
btnTranscribe.addEventListener("click", async () => {
  if (!selectedFilePath) return;

  // Clear previous results
  allSegments = [];
  transcriptList.innerHTML = "";
  badgeCount.textContent = "0 baris";
  
  // Update UI for processing
  btnTranscribe.disabled = true;
  btnTranscribe.innerHTML = `<span>⏳</span> Memproses...`;
  progressCard.style.display = "block";
  updateProgress(5, "Mempersiapkan audio dan koneksi ke Groq...");

  try {
    await callApi("start_transcription", selectedFilePath);
  } catch (err) {
    alert("Terjadi kesalahan: " + err.message);
    btnTranscribe.disabled = false;
    btnTranscribe.innerHTML = `<span>▶️</span> Mulai Transkripsi`;
  }
});

// 3. Functions called from Python Backend
window.updateProgress = function (pct, statusText) {
  progressFill.style.width = `${pct}%`;
  progressPct.textContent = `${pct}%`;
  progressStatus.textContent = statusText;
  if (pct < 15) {
    progressPhase.textContent = "Menyiapkan Audio...";
  } else if (pct < 95) {
    progressPhase.textContent = "Mentranskripsi...";
  } else {
    progressPhase.textContent = "Menyimpan Hasil...";
  }
};

window.appendSegment = function (timestamp, text, fullLine) {
  if (emptyState && emptyState.parentNode) {
    emptyState.parentNode.removeChild(emptyState);
  }

  allSegments.push({ timestamp, text, fullLine });

  const row = document.createElement("div");
  row.className = "transcript-row";

  const badge = document.createElement("span");
  badge.className = "transcript-badge";
  badge.textContent = timestamp;

  const textSpan = document.createElement("span");
  textSpan.className = "transcript-text";
  textSpan.textContent = text;

  row.appendChild(badge);
  row.appendChild(textSpan);
  transcriptList.appendChild(row);

  transcriptList.scrollTop = transcriptList.scrollHeight;
  badgeCount.textContent = `${allSegments.length} baris`;
};

window.transcriptionFinished = function (res) {
  btnTranscribe.disabled = false;
  btnTranscribe.innerHTML = `<span>▶️</span> Mulai Transkripsi Lagi`;
  updateProgress(100, "Transkripsi berhasil diselesaikan!");
  
  footerStats.textContent = `Selesai (${res.total_lines} baris, ${res.duration_formatted}) • File tersimpan di folder output`;
  alert(`Transkripsi berhasil diselesaikan!\nTotal: ${res.total_lines} baris percakapan.\nFile tersimpan di:\n${res.output_txt}`);
};

window.transcriptionError = function (errMsg) {
  btnTranscribe.disabled = false;
  btnTranscribe.innerHTML = `<span>▶️</span> Mulai Transkripsi`;
  progressStatus.textContent = "Gagal: " + errMsg;
  progressFill.style.background = "var(--accent-red)";
  alert("Error Transkripsi:\n" + errMsg);
};

// 4. Action Buttons (Copy & Downloads)
btnCopy.addEventListener("click", async () => {
  if (allSegments.length === 0) {
    alert("Belum ada teks transkrip untuk disalin.");
    return;
  }
  const fullText = allSegments.map(s => s.fullLine).join("\n");
  try {
    await callApi("copy_to_clipboard", fullText);
    alert("Semua transkrip berhasil disalin ke clipboard!");
  } catch (e) {
    navigator.clipboard.writeText(fullText);
    alert("Semua transkrip disalin!");
  }
});

btnDownloadTxt.addEventListener("click", async () => {
  if (allSegments.length === 0) {
    alert("Belum ada transkrip untuk disimpan.");
    return;
  }
  const fullText = allSegments.map(s => s.fullLine).join("\n");
  try {
    await callApi("save_dialog", fullText, "txt");
  } catch (e) {
    console.error(e);
  }
});

btnDownloadMd.addEventListener("click", async () => {
  if (allSegments.length === 0) {
    alert("Belum ada transkrip untuk disimpan.");
    return;
  }
  let mdContent = `# Transkrip Rapat\n\n`;
  for (const s of allSegments) {
    mdContent += `- **\`${s.timestamp}\`** ${s.text}\n`;
  }
  try {
    await callApi("save_dialog", mdContent, "md");
  } catch (e) {
    console.error(e);
  }
});

btnOpenFolder.addEventListener("click", async () => {
  try {
    await callApi("open_output_folder");
  } catch (e) {
    console.error(e);
  }
});

// 5. Search / Filter Bar
searchInput.addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase().trim();
  const rows = transcriptList.getElementsByClassName("transcript-row");
  for (let row of rows) {
    const text = row.textContent.toLowerCase();
    if (!query || text.includes(query)) {
      row.style.display = "flex";
    } else {
      row.style.display = "none";
    }
  }
});

// 6. Settings Modal
btnSettings.addEventListener("click", () => {
  settingsModal.style.display = "flex";
});

function closeSettings() {
  settingsModal.style.display = "none";
}

modalClose.addEventListener("click", closeSettings);
btnCancelSettings.addEventListener("click", closeSettings);

btnSaveSettings.addEventListener("click", async () => {
  const newConfig = {
    api_key: cfgApiKey.value.trim(),
    model: cfgModel.value,
    language: cfgLanguage.value.trim(),
    chunk_minutes: parseInt(cfgChunk.value, 10) || 10
  };

  if (!newConfig.api_key) {
    alert("API Key tidak boleh kosong.");
    return;
  }

  try {
    await callApi("save_config", newConfig);
    currentConfig = newConfig;
    alert("Pengaturan berhasil disimpan!");
    closeSettings();
  } catch (e) {
    alert("Gagal menyimpan pengaturan: " + e.message);
  }
});
