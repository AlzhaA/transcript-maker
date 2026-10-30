// State
let selectedFilePath = null;
let allSegments = []; // array of {timestamp, text, fullLine}
let currentConfig = {};
let currentNotulensiText = "";
let currentBaseName = "";
let activeTab = "transcript"; // "transcript" or "notulensi"

// DOM Elements
const dropZone = document.getElementById("drop-zone");
const dropText = document.getElementById("drop-text");
const fileInfoBox = document.getElementById("file-info-box");
const infoName = document.getElementById("info-name");
const infoSize = document.getElementById("info-size");
const infoDuration = document.getElementById("info-duration");
const meetingTitleInput = document.getElementById("meeting-title");
const btnTranscribe = document.getElementById("btn-transcribe");

const progressCard = document.getElementById("progress-card");
const progressPct = document.getElementById("progress-pct");
const progressFill = document.getElementById("progress-fill");
const progressStatus = document.getElementById("progress-status");
const progressPhase = document.getElementById("progress-phase");

// Tabs & Views
const tabBtnTranscript = document.getElementById("tab-btn-transcript");
const tabBtnNotulensi = document.getElementById("tab-btn-notulensi");
const viewTranscript = document.getElementById("view-transcript");
const viewNotulensi = document.getElementById("view-notulensi");
const btnGenerateNotulensi = document.getElementById("btn-generate-notulensi");
const searchBoxContainer = document.getElementById("search-box-container");

const transcriptList = document.getElementById("transcript-list");
const emptyState = document.getElementById("empty-state");
const badgeCount = document.getElementById("badge-count");

const notulensiEmptyState = document.getElementById("notulensi-empty-state");
const notulensiContentBox = document.getElementById("notulensi-content-box");
const notulensiTextDisplay = document.getElementById("notulensi-text-display");

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

// Safe API helper
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

// 1. Tab Switching
tabBtnTranscript.addEventListener("click", () => switchTab("transcript"));
tabBtnNotulensi.addEventListener("click", () => switchTab("notulensi"));

function switchTab(tab) {
  activeTab = tab;
  if (tab === "transcript") {
    tabBtnTranscript.classList.add("active");
    tabBtnNotulensi.classList.remove("active");
    viewTranscript.classList.add("active");
    viewNotulensi.classList.remove("active");
    searchBoxContainer.style.display = "block";
    btnCopy.innerHTML = `<span>📋</span> Salin Transkrip`;
  } else {
    tabBtnNotulensi.classList.add("active");
    tabBtnTranscript.classList.remove("active");
    viewNotulensi.classList.add("active");
    viewTranscript.classList.remove("active");
    searchBoxContainer.style.display = "none";
    btnCopy.innerHTML = `<span>📋</span> Salin Notulensi`;
  }
}

// 2. File Selection Handler
dropZone.addEventListener("click", async () => {
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

  // Auto-suggest meeting title if empty
  if (!meetingTitleInput.value.trim()) {
    const baseClean = data.file_name.replace(/\.[^/.]+$/, "").replace(/[_\-]+/g, " ");
    meetingTitleInput.value = baseClean;
  }

  fileInfoBox.style.display = "block";
  btnTranscribe.disabled = false;
  dropText.textContent = `File: ${data.file_name}`;
  footerStats.textContent = `File siap: ${data.file_name} (${data.duration_formatted})`;
}

// 3. Start Transcription
btnTranscribe.addEventListener("click", async () => {
  if (!selectedFilePath) return;

  // Clear previous results
  allSegments = [];
  transcriptList.innerHTML = "";
  badgeCount.textContent = "0 baris";
  currentNotulensiText = "";
  btnGenerateNotulensi.disabled = true;
  notulensiContentBox.style.display = "none";
  notulensiEmptyState.style.display = "flex";

  switchTab("transcript");

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

// 4. Progress & Segment Callbacks from Python
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

  currentBaseName = res.base_name || "";
  btnGenerateNotulensi.disabled = false;

  footerStats.textContent = `Transkrip selesai (${res.total_lines} baris, ${res.duration_formatted}) • Siap membuat notulensi jika diinginkan`;

  // Do NOT automatically generate notulensi - preserve Groq tokens and let user review first!
  alert(
    `Transkripsi Berhasil!\nTotal: ${res.total_lines} baris percakapan.\nFile tersimpan di:\n${res.output_txt}\n\nKlik tombol ungu '✨ Buat Notulensi AI' di kanan atas kapan pun Anda ingin menyusun notulensi rapat.`
  );
};

window.transcriptionError = function (errMsg) {
  btnTranscribe.disabled = false;
  btnTranscribe.innerHTML = `<span>▶️</span> Mulai Transkripsi`;
  progressStatus.textContent = "Gagal: " + errMsg;
  progressFill.style.background = "var(--accent-red)";
  alert("Error Transkripsi:\n" + errMsg);
};

// 5. Notulensi Generation
btnGenerateNotulensi.addEventListener("click", () => {
  const title = meetingTitleInput.value.trim() || "Notulensi Rapat";
  generateNotulensiAction(title);
});

window.updateNotulensiStatus = function (statusText) {
  const statusEl = document.getElementById("notulensi-status-desc");
  if (statusEl) {
    statusEl.textContent = statusText;
  }
};

async function generateNotulensiAction(title) {
  if (allSegments.length === 0) {
    alert("Transkrip belum ada. Jalankan transkripsi terlebih dahulu.");
    return;
  }

  const fullText = allSegments.map((s) => s.fullLine).join("\n");
  btnGenerateNotulensi.disabled = true;
  btnGenerateNotulensi.innerHTML = `<span>⏳</span> Membuat Notulensi...`;

  switchTab("notulensi");
  notulensiEmptyState.innerHTML = `
    <div class="empty-state-icon" style="font-size: 38px;">⏳</div>
    <p style="font-size: 15px; font-weight: 600; color: var(--accent-cyan);">Sedang Menyusun Notulensi Komprehensif...</p>
    <p id="notulensi-status-desc" style="font-size: 12.5px; color: #cbd5e1; max-width: 420px; text-align: center; line-height: 1.5; margin-top: 6px;">
      Mempersiapkan teks transkrip...
    </p>
  `;

  try {
    await callApi("generate_notulensi", fullText, title, currentBaseName);
  } catch (err) {
    alert("Gagal membuat notulensi: " + err.message);
    btnGenerateNotulensi.disabled = false;
    btnGenerateNotulensi.innerHTML = `<span>✨</span> Buat Notulensi AI`;
  }
}

window.notulensiFinished = function (res) {
  btnGenerateNotulensi.disabled = false;
  btnGenerateNotulensi.innerHTML = `<span>✨</span> Buat Ulang Notulensi`;

  currentNotulensiText = res.notulensi;

  notulensiEmptyState.style.display = "none";
  notulensiContentBox.style.display = "block";
  notulensiTextDisplay.textContent = currentNotulensiText;

  switchTab("notulensi");
  footerStats.textContent = `Notulensi selesai disusun • Tersimpan di: ${res.output_md}`;
};

window.notulensiError = function (errMsg) {
  btnGenerateNotulensi.disabled = false;
  btnGenerateNotulensi.innerHTML = `<span>✨</span> Buat Notulensi AI`;
  alert("Terjadi kesalahan saat menyusun notulensi:\n" + errMsg);
};

// 6. Action Buttons (Copy & Download)
btnCopy.addEventListener("click", async () => {
  let textToCopy = "";
  if (activeTab === "notulensi") {
    if (!currentNotulensiText) {
      alert("Belum ada notulensi untuk disalin.");
      return;
    }
    textToCopy = currentNotulensiText;
  } else {
    if (allSegments.length === 0) {
      alert("Belum ada transkrip untuk disalin.");
      return;
    }
    textToCopy = allSegments.map((s) => s.fullLine).join("\n");
  }

  try {
    await callApi("copy_to_clipboard", textToCopy);
    alert("Berhasil disalin ke clipboard!");
  } catch (e) {
    navigator.clipboard.writeText(textToCopy);
    alert("Berhasil disalin!");
  }
});

btnDownloadTxt.addEventListener("click", async () => {
  let content = "";
  let defaultName = meetingTitleInput.value.trim() || "dokumen";
  defaultName = defaultName.replace(/[^a-zA-Z0-9_\-]/g, "_");

  if (activeTab === "notulensi") {
    if (!currentNotulensiText) {
      alert("Belum ada notulensi untuk disimpan.");
      return;
    }
    content = currentNotulensiText;
    defaultName = `notulensi_${defaultName}`;
  } else {
    if (allSegments.length === 0) {
      alert("Belum ada transkrip untuk disimpan.");
      return;
    }
    content = allSegments.map((s) => s.fullLine).join("\n");
    defaultName = `transkrip_${defaultName}`;
  }

  try {
    await callApi("save_dialog", content, defaultName, "txt");
  } catch (e) {
    console.error(e);
  }
});

btnDownloadMd.addEventListener("click", async () => {
  let content = "";
  let defaultName = meetingTitleInput.value.trim() || "dokumen";
  defaultName = defaultName.replace(/[^a-zA-Z0-9_\-]/g, "_");

  if (activeTab === "notulensi") {
    if (!currentNotulensiText) {
      alert("Belum ada notulensi untuk disimpan.");
      return;
    }
    content = currentNotulensiText;
    defaultName = `notulensi_${defaultName}`;
  } else {
    if (allSegments.length === 0) {
      alert("Belum ada transkrip untuk disimpan.");
      return;
    }
    content = `# Transkrip Rapat: ${meetingTitleInput.value.trim() || "Rapat"}\n\n`;
    for (const s of allSegments) {
      content += `- **\`${s.timestamp}\`** ${s.text}\n`;
    }
    defaultName = `transkrip_${defaultName}`;
  }

  try {
    await callApi("save_dialog", content, defaultName, "md");
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

// 7. Search / Filter Bar (Transcript)
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

// 8. Settings Modal
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
    chunk_minutes: parseInt(cfgChunk.value, 10) || 10,
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
