/**
 * منطق ساده، تمیز و قدرتمند داشبورد کنترل پروژه اپلیکیشن و وب‌سایت
 * بدون نام اشخاص، بدون پیچیدگی و با ذخیره و اشتراک از طریق یک لینک واحد
 */

const STORAGE_KEY = 'PROJECT_TRACKER_SIMPLE_STATE_V1';

// ساختار وضعیت پروژه
let state = {
  categories: JSON.parse(JSON.stringify(INITIAL_CATEGORIES)),
  filters: {
    search: '',
    status: 'all', // 'all', 'completed', 'pending'
    category: 'all' // 'all' or categoryId
  },
  collapsedCategories: {},
  soundEnabled: true
};

// نمونه‌های نمودار Chart.js
let chartOverall = null;
let chartPhases = null;
let serverSaveTimeout = null;

// سیستم پخش صدای تیک با Web Audio API
function playCheckSound() {
  if (!state.soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.22);
  } catch (e) {
    // صدا مسدود یا پشتیبانی نشده است
  }
}

// دریافت لیست مرتب تمام شناسه تسک‌ها (جهت کدگذاری در هش URL)
function getAllTaskIds() {
  const ids = [];
  for (const cat of INITIAL_CATEGORIES) {
    for (const task of cat.tasks) {
      ids.push(task.id);
    }
  }
  return ids;
}

// تبدیل ۳۱۸ وضعیت به رشته فشرده Base64URL در هش آدرس اینترنتی (حدود ۵۰ کاراکتر)
function encodeStateToBitset() {
  const allIds = getAllTaskIds();
  const byteCount = Math.ceil(allIds.length / 8);
  const bytes = new Uint8Array(byteCount);

  const taskMap = {};
  for (const cat of state.categories) {
    for (const t of cat.tasks) {
      taskMap[t.id] = !!t.completed;
    }
  }

  for (let i = 0; i < allIds.length; i++) {
    if (taskMap[allIds[i]]) {
      const byteIndex = Math.floor(i / 8);
      const bitOffset = i % 8;
      bytes[byteIndex] |= (1 << bitOffset);
    }
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// رمزگشایی رشته فشرده هش و بازیابی وضعیت ۳۱۸ تسک
function decodeBitsetToState(hashString) {
  try {
    let clean = hashString;
    if (clean.startsWith('#')) clean = clean.substring(1);
    if (clean.startsWith('p=')) clean = clean.substring(2);

    let base64 = clean.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const allIds = getAllTaskIds();
    const idMap = {};
    for (let i = 0; i < allIds.length; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitOffset = i % 8;
      if (byteIndex < bytes.length) {
        idMap[allIds[i]] = !!(bytes[byteIndex] & (1 << bitOffset));
      } else {
        idMap[allIds[i]] = false;
      }
    }

    for (const cat of state.categories) {
      for (const t of cat.tasks) {
        if (typeof idMap[t.id] === 'boolean') {
          t.completed = idMap[t.id];
        }
      }
    }
    return true;
  } catch (err) {
    console.error('خطا در خواندن هش آدرس:', err);
    return false;
  }
}

// به‌روزرسانی هش آدرس در مرورگر بدون ریفرش صفحه
function updateUrlHash() {
  const hash = encodeStateToBitset();
  const newUrl = window.location.pathname + window.location.search + '#p=' + hash;
  window.history.replaceState(null, '', newUrl);
}

// ذخیره‌سازی داده‌ها: هم در LocalStorage، هم در URL هش، هم در سرور محلی (در صورت وجود)
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('LocalStorage write failed', e);
  }

  updateUrlHash();

  // در صورت اجرای سرور Node.js محلی روی پورت ۳۰۰۰
  if (window.location.protocol.startsWith('http') && window.location.port === '3000') {
    clearTimeout(serverSaveTimeout);
    serverSaveTimeout = setTimeout(() => {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      }).catch(() => {});
    }, 400);
  }
}

// بارگذاری اولیه وضعیت
function loadState() {
  let loadedFromHash = false;

  // ۱. اگر لینک حاوی هش وضعیت باشد (همکار لینک را باز کرده باشد)
  if (window.location.hash && window.location.hash.includes('p=')) {
    loadedFromHash = decodeBitsetToState(window.location.hash);
  }

  // ۲. اگر از هش خوانده نشد، از حافظه محلی مرورگر خوانده شود
  if (!loadedFromHash) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.categories && Array.isArray(parsed.categories) && parsed.categories.length > 0) {
          state.categories = parsed.categories;
          if (parsed.collapsedCategories) state.collapsedCategories = parsed.collapsedCategories;
        } else {
          state.categories = JSON.parse(JSON.stringify(INITIAL_CATEGORIES));
        }
      }
    } catch (e) {
      console.error('LocalStorage read error', e);
      state.categories = JSON.parse(JSON.stringify(INITIAL_CATEGORIES));
    }
  }

  if (!state.categories || !Array.isArray(state.categories) || state.categories.length === 0) {
    state.categories = JSON.parse(JSON.stringify(INITIAL_CATEGORIES));
  }

  // به‌روزرسانی هش URL تا همیشه آماده کپی و اشتراک باشد
  updateUrlHash();
}

// کپی کردن لینک پیشرفت جهت اشتراک با همکاران
function copyProjectShareLink() {
  updateUrlHash();
  const url = window.location.href;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('📋 لینک کپی شد! می‌توانید این لینک را برای همکارانتان بفرستید.');
    }).catch(() => {
      fallbackCopy(url);
    });
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showToast('📋 لینک کپی شد! می‌توانید این لینک را برای همکارانتان بفرستید.');
  } catch (err) {
    prompt('لینک زیر را کپی کرده و برای همکارانتان بفرستید:', text);
  }
  document.body.removeChild(textArea);
}

// تاگل کردن یک تسک (تیک زدن یا برداشتن تیک)
function toggleTask(taskId) {
  let foundTask = null;
  for (const cat of state.categories) {
    for (const t of cat.tasks) {
      if (t.id === taskId) {
        t.completed = !t.completed;
        foundTask = t;
        break;
      }
    }
    if (foundTask) break;
  }

  if (foundTask) {
    if (foundTask.completed) {
      playCheckSound();
    }
    saveState();
    updateUI();
  }
}

// تیک زدن یا پاک کردن همه تسک‌های یک سرفصل
function toggleCategoryAll(catId, targetStatus) {
  const cat = state.categories.find(c => c.id === catId);
  if (!cat) return;

  for (const task of cat.tasks) {
    task.completed = targetStatus;
  }

  if (targetStatus) playCheckSound();
  saveState();
  updateUI();
  showToast(targetStatus ? `تمام تسک‌های «${cat.title}» انجام شد.` : `تیک‌های «${cat.title}» برداشته شد.`);
}

// محاسبه آمار و ارقام پروژه
function calculateStats() {
  let totalTasks = 0;
  let completedTasks = 0;
  let completedPhases = 0;

  const categoryStats = state.categories.map(cat => {
    const total = cat.tasks.length;
    const completed = cat.tasks.filter(t => t.completed).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (percent === 100 && total > 0) completedPhases++;
    totalTasks += total;
    completedTasks += completed;
    return {
      id: cat.id,
      title: cat.title,
      total,
      completed,
      pending: total - completed,
      percent
    };
  });

  const overallPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    totalTasks,
    completedTasks,
    pendingTasks: totalTasks - completedTasks,
    completedPhases,
    totalPhases: state.categories.length,
    overallPercent,
    categoryStats
  };
}

// به‌روزرسانی کامل رابط کاربری
function updateUI() {
  const stats = calculateStats();

  // کارت‌های بالا
  const statOverallPercent = document.getElementById('statOverallPercent');
  const statProgressBar = document.getElementById('statProgressBar');
  const statTotalTasks = document.getElementById('statTotalTasks');
  const statCompletedTasks = document.getElementById('statCompletedTasks');
  const statPendingTasks = document.getElementById('statPendingTasks');
  const statCompletedPhases = document.getElementById('statCompletedPhases');
  const chartOverallCenterText = document.getElementById('chartOverallCenterText');

  if (statOverallPercent) statOverallPercent.innerText = toPersianDigits(stats.overallPercent) + '٪';
  if (statProgressBar) statProgressBar.style.width = stats.overallPercent + '%';
  if (statTotalTasks) statTotalTasks.innerText = toPersianDigits(stats.totalTasks);
  if (statCompletedTasks) statCompletedTasks.innerText = toPersianDigits(stats.completedTasks);
  if (statPendingTasks) statPendingTasks.innerText = toPersianDigits(stats.pendingTasks);
  if (statCompletedPhases) statCompletedPhases.innerText = `${toPersianDigits(stats.completedPhases)} از ${toPersianDigits(stats.totalPhases)}`;
  if (chartOverallCenterText) chartOverallCenterText.innerText = toPersianDigits(stats.overallPercent) + '٪';

  // به‌روزرسانی نمودارها
  updateCharts(stats);

  // رندر چک‌لیست‌ها
  renderChecklists();
}

// رسم و به‌روزرسانی نمودارهای Chart.js
function updateCharts(stats) {
  // نمودار ۱: دونات وضعیت کل
  const overallCtx = document.getElementById('chartOverallCanvas');
  if (overallCtx) {
    const data = [stats.completedTasks, stats.pendingTasks];
    if (!chartOverall) {
      chartOverall = new Chart(overallCtx, {
        type: 'doughnut',
        data: {
          labels: ['انجام‌شده', 'باقی‌مانده'],
          datasets: [{
            data: data,
            backgroundColor: ['#10b981', '#334155'],
            borderWidth: 0,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: '#cbd5e1',
                font: { family: 'Vazirmatn', size: 12 },
                padding: 14
              }
            },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.label}: ${toPersianDigits(ctx.raw)} تسک (${toPersianDigits(Math.round((ctx.raw / stats.totalTasks) * 100)) || '۰'}٪)`
              }
            }
          }
        }
      });
    } else {
      chartOverall.data.datasets[0].data = data;
      chartOverall.update();
    }
  }

  // نمودار ۲: میله‌ای پیشرفت ۲۰ فاز
  const phasesCtx = document.getElementById('chartPhasesCanvas');
  if (phasesCtx) {
    const labels = stats.categoryStats.map(c => {
      // کوتاه کردن عنوان برای زیبایی در نمودار
      return c.title.replace(/^[۰-۹0-9IVXLCDM]+\.\s*/, '');
    });
    const values = stats.categoryStats.map(c => c.percent);

    if (!chartPhases) {
      chartPhases = new Chart(phasesCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'درصد پیشرفت فاز',
            data: values,
            backgroundColor: values.map(v => v === 100 ? '#10b981' : v > 0 ? '#3b82f6' : '#475569'),
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          scales: {
            x: {
              min: 0,
              max: 100,
              ticks: {
                color: '#94a3b8',
                font: { family: 'Vazirmatn', size: 10 },
                callback: v => toPersianDigits(v) + '٪'
              },
              grid: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            y: {
              ticks: {
                color: '#cbd5e1',
                font: { family: 'Vazirmatn', size: 11 },
                autoSkip: false
              },
              grid: { display: false }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ` پیشرفت: ${toPersianDigits(ctx.raw)}٪`
              }
            }
          }
        }
      });
    } else {
      chartPhases.data.labels = labels;
      chartPhases.data.datasets[0].data = values;
      chartPhases.data.datasets[0].backgroundColor = values.map(v => v === 100 ? '#10b981' : v > 0 ? '#3b82f6' : '#475569');
      chartPhases.update();
    }
  }
}

// رندر چک‌لیست‌های ۲۰ گانه
function renderChecklists() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;

  const searchQuery = (state.filters.search || '').trim().toLowerCase();
  const statusFilter = state.filters.status || 'all';
  const categoryFilter = state.filters.category || 'all';

  let html = '';

  for (const cat of state.categories) {
    if (categoryFilter !== 'all' && cat.id !== categoryFilter) {
      continue;
    }

    // فیلتر کردن تسک‌های داخل این سرفصل
    const filteredTasks = cat.tasks.filter(task => {
      if (searchQuery && !task.title.toLowerCase().includes(searchQuery)) {
        return false;
      }
      if (statusFilter === 'completed' && !task.completed) {
        return false;
      }
      if (statusFilter === 'pending' && task.completed) {
        return false;
      }
      return true;
    });

    // اگر جستجو یا فیلتر فعاله و هیچ تسکی مچ نشد، سرفصل مخفی شود
    if (filteredTasks.length === 0 && (searchQuery || statusFilter !== 'all')) {
      continue;
    }

    const totalInCat = cat.tasks.length;
    const completedInCat = cat.tasks.filter(t => t.completed).length;
    const catPercent = totalInCat > 0 ? Math.round((completedInCat / totalInCat) * 100) : 0;
    const isCollapsed = !!state.collapsedCategories[cat.id];

    html += `
      <div class="glass-panel rounded-2xl border ${catPercent === 100 ? 'border-emerald-500/40 bg-emerald-950/10' : 'border-slate-800'} shadow-lg overflow-hidden transition-all duration-300">
        
        <!-- سربرگ سرفصل -->
        <div class="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 cursor-pointer select-none border-b border-slate-800/80" onclick="toggleCollapseCategory('${cat.id}')">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr ${cat.color || 'from-blue-600 to-indigo-600'} flex items-center justify-center text-white shadow-md text-base">
              <i class="fa-solid ${cat.icon || 'fa-folder-open'}"></i>
            </div>
            <div>
              <h3 class="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                ${cat.title}
                ${catPercent === 100 ? '<span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40"><i class="fa-solid fa-check"></i> تکمیل شد</span>' : ''}
              </h3>
              <div class="text-xs text-slate-400 mt-1 flex items-center gap-3">
                <span>${toPersianDigits(completedInCat)} از ${toPersianDigits(totalInCat)} تسک انجام شده</span>
                <span class="font-bold ${catPercent === 100 ? 'text-emerald-400' : 'text-blue-400'}">${toPersianDigits(catPercent)}٪</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2" onclick="event.stopPropagation()">
            <!-- دکمه تیک زدن همه -->
            <button onclick="toggleCategoryAll('${cat.id}', true)" class="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition" title="انجام همه تسک‌های این بخش">
              تیک همه
            </button>
            <button onclick="toggleCategoryAll('${cat.id}', false)" class="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition" title="حذف تیک‌های این بخش">
              پاک کردن
            </button>
            <!-- آیکون آکاردئون -->
            <div class="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center text-xs">
              <i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'} transition-transform"></i>
            </div>
          </div>
        </div>

        <!-- نوار پیشرفت باریک سرفصل -->
        <div class="w-full bg-slate-800/80 h-1.5 overflow-hidden">
          <div class="bg-gradient-to-r from-blue-500 to-emerald-400 h-full transition-all duration-300" style="width: ${catPercent}%;"></div>
        </div>

        <!-- محتوای تسک‌ها -->
        <div class="${isCollapsed ? 'hidden' : 'p-3 sm:p-5 space-y-2 bg-slate-950/40'}">
          ${filteredTasks.length === 0 ? `
            <div class="text-center py-6 text-xs text-slate-500">
              هیچ تسکی با این مشخصات یافت نشد.
            </div>
          ` : filteredTasks.map(task => `
            <div class="flex items-center gap-3 p-2.5 sm:p-3 rounded-xl transition ${task.completed ? 'bg-slate-900/30 opacity-75' : 'hover:bg-slate-900/60'} border border-slate-800/40">
              <input 
                type="checkbox" 
                id="task_${task.id}"
                class="task-checkbox" 
                ${task.completed ? 'checked' : ''}
                onchange="toggleTask('${task.id}')"
              >
              <label for="task_${task.id}" class="flex-1 cursor-pointer select-none">
                <span class="text-xs sm:text-sm font-medium transition ${task.completed ? 'line-through text-slate-500' : 'text-slate-200'}">
                  ${task.title}
                </span>
              </label>
            </div>
          `).join('')}
        </div>

      </div>
    `;
  }

  container.innerHTML = html;
}

// باز یا بسته کردن یک سرفصل
function toggleCollapseCategory(catId) {
  state.collapsedCategories[catId] = !state.collapsedCategories[catId];
  saveState();
  renderChecklists();
}

function expandAllCategories() {
  state.collapsedCategories = {};
  saveState();
  renderChecklists();
}

function collapseAllCategories() {
  for (const cat of state.categories) {
    state.collapsedCategories[cat.id] = true;
  }
  saveState();
  renderChecklists();
}

function resetFilters() {
  state.filters.search = '';
  state.filters.status = 'all';
  state.filters.category = 'all';

  const sInput = document.getElementById('searchInput');
  const fStatus = document.getElementById('filterStatus');
  const fCategory = document.getElementById('filterCategory');

  if (sInput) sInput.value = '';
  if (fStatus) fStatus.value = 'all';
  if (fCategory) fCategory.value = 'all';

  renderChecklists();
}

// پر کردن منوی سرفصل‌ها در فیلتر
function populateCategoryFilter() {
  const select = document.getElementById('filterCategory');
  if (!select) return;

  select.innerHTML = '<option value="all">تمام سرفصل‌ها (۲۰ فاز)</option>' +
    state.categories.map(cat => `<option value="${cat.id}">${cat.title}</option>`).join('');
}

// نمایش پیام Toast
let toastTimeout = null;
function showToast(message) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;

  toast.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400 text-sm"></i> <span>${message}</span>`;
  toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
  toast.classList.add('opacity-100', 'translate-y-0');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
    toast.classList.remove('opacity-100', 'translate-y-0');
  }, 3500);
}

// خروجی اکسل CSV کاملاً استاندارد و بدون نام شخص
function exportToCsv() {
  let csv = '\uFEFF'; // BOM برای نمایش صحیح حروف فارسی در اکسل
  csv += 'ردیف,سرفصل,عنوان تسک,وضعیت\n';

  let row = 1;
  for (const cat of state.categories) {
    for (const t of cat.tasks) {
      const statusText = t.completed ? 'انجام شده' : 'در انتظار اقدام';
      const cleanTitle = `"${(t.title || '').replace(/"/g, '""')}"`;
      const cleanCat = `"${(cat.title || '').replace(/"/g, '""')}"`;
      csv += `${row},${cleanCat},${cleanTitle},${statusText}\n`;
      row++;
    }
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `project-progress-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  showToast('فایل اکسل (CSV) با موفقیت دانلود شد.');
}

// ذخیره فایل پشتیبان JSON
function exportProjectData() {
  const jsonStr = JSON.stringify(state, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `project-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  showToast('فایل ذخیره پروژه دانلود شد.');
}

// بارگذاری فایل پشتیبان JSON
function importProjectData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported.categories && Array.isArray(imported.categories)) {
        state.categories = imported.categories;
        saveState();
        updateUI();
        showToast('اطلاعات فایل با موفقیت بارگذاری شد.');
      } else {
        alert('ساختار فایل انتخاب شده معتبر نیست.');
      }
    } catch (err) {
      alert('خطا در خواندن فایل JSON');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// بازنشانی تمام داده‌ها با تأیید
function confirmResetAll() {
  if (confirm('آیا مطمئن هستید؟ تمام تیک‌های تسک‌ها برداشته خواهند شد.')) {
    for (const cat of state.categories) {
      for (const t of cat.tasks) {
        t.completed = false;
      }
    }
    saveState();
    updateUI();
    showToast('تمام تیک‌ها بازنشانی شدند.');
  }
}

// تبدیل اعداد انگلیسی به فارسی برای زیبایی فونت
function toPersianDigits(num) {
  if (num === null || num === undefined) return '';
  const id = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return num.toString().replace(/[0-9]/g, function(w) {
    return id[+w];
  });
}

// راه‌اندازی اولیه رویدادها
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  populateCategoryFilter();
  updateUI();

  // فیلتر جستجو
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      state.filters.search = e.target.value;
      renderChecklists();
    });
  }

  // فیلتر وضعیت
  const filterStatus = document.getElementById('filterStatus');
  if (filterStatus) {
    filterStatus.addEventListener('change', e => {
      state.filters.status = e.target.value;
      renderChecklists();
    });
  }

  // فیلتر سرفصل
  const filterCategory = document.getElementById('filterCategory');
  if (filterCategory) {
    filterCategory.addEventListener('change', e => {
      state.filters.category = e.target.value;
      renderChecklists();
    });
  }

  // میانبرهای صفحه کلید (کلید / یا Ctrl+K برای جستجو)
  document.addEventListener('keydown', e => {
    if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput?.focus();
    }
  });

  // اگر کاربر روی دکمه Back/Forward مرورگر کلیک کند، هش جدید خوانده شود
  window.addEventListener('hashchange', () => {
    if (window.location.hash && window.location.hash.includes('p=')) {
      decodeBitsetToState(window.location.hash);
      updateUI();
    }
  });
});
