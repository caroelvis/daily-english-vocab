/**
 * Daily English Vocab — Words + Sentences (Flashcard + Quiz)
 * Traditional Chinese UI · English vocabulary & spoken sentences
 */
(function () {
  'use strict';

  /** Default quiz length; overridden by UI (20 / 50 / 100). */
  let quizTotal = 50;
  /** Selected category key, or 'all' for every word. */
  let selectedCategory = 'all';
  /** Primary content: 'words' | 'sentences'. */
  let contentType = 'words';
  /** Learning mode within content: 'flashcard' | 'quiz'. */
  let learningMode = 'flashcard';

  const CATEGORY_ZH = {
    home: '居家',
    food: '飲食',
    shopping: '購物',
    clothing: '服飾',
    transport: '交通',
    weather: '天氣自然',
    health: '健康',
    work: '工作',
    travel: '旅行',
    daily: '日常時間',
    people: '人物社交',
    basics: '基礎',
    money: '金錢',
    tech: '科技通訊',
    education: '教育',
    services: '公共服務',
    leisure: '休閒運動',
    animals: '動物',
  };

  /** @type {Array<{id:number,word:string,zh:string,emoji:string,category:string,image?:string}>} */
  let words = [];
  let recentFlashIds = [];
  const RECENT_LIMIT = 40;
  /** @type {Array<object>} history of prior flashcards (most recent at end) */
  let flashHistory = [];
  const HISTORY_LIMIT = 50;


  // ——— Usage analytics (fire-and-forget; site works if API down) ———
  const ANALYTICS_DEFAULT = 'http://127.0.0.1:8000';
  const SESSION_KEY = 'vocab_session_id';
  const MODE_KEY = 'vocab_current_mode';

  function analyticsApiBase() {
    try {
      if (typeof window.VOCAB_ANALYTICS_API === 'string' && window.VOCAB_ANALYTICS_API) {
        return window.VOCAB_ANALYTICS_API.replace(/\/$/, '');
      }
      if (typeof window.ANALYTICS_BASE === 'string' && window.ANALYTICS_BASE) {
        return window.ANALYTICS_BASE.replace(/\/$/, '');
      }
      const stored = localStorage.getItem('vocab_analytics_api');
      if (stored) return stored.replace(/\/$/, '');
    } catch (_) { /* ignore */ }
    return ANALYTICS_DEFAULT;
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : ('s_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10));
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (_) {
      return 'anon_' + Date.now().toString(36);
    }
  }

  function trackEvent(event, mode) {
    const payload = {
      session_id: getSessionId(),
      event: event,
      ts: Date.now(),
    };
    if (mode) payload.mode = mode;
    const url = analyticsApiBase() + '/events';
    const body = JSON.stringify(payload);
    try {
      if (event === 'session_end' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
        return;
      }
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        mode: 'cors',
      }).catch(function () { /* API optional */ });
    } catch (_) { /* ignore */ }
  }

  function trackModeEnter(mode) {
    try { sessionStorage.setItem(MODE_KEY, mode); } catch (_) {}
    trackEvent('mode_enter', mode);
  }

  let sessionEnded = false;
  function startAnalytics() {
    trackEvent('session_start');
    // Default view is flashcard
    trackModeEnter('flashcard');

    window.addEventListener('pagehide', function () {
      if (sessionEnded) return;
      sessionEnded = true;
      trackEvent('session_end');
    });
  }


  // Quiz state
  let quizIndex = 0; // completed questions (0..quizTotal)
  let quizCorrect = 0;
  let quizWrong = 0;
  let currentQuestion = null; // { answer, options, attempts }
  let quizActive = false;

  // DOM
  const $ = (sel) => document.querySelector(sel);
  const flashView = $('#flashcard-view');
  const quizView = $('#quiz-view');
  const flashImage = $('#flash-image');
  const flashEmoji = $('#flash-emoji');
  const flashWord = $('#flash-word');
  const flashZh = $('#flash-zh');
  const flashCategory = $('#flash-category');
  const flashMeta = $('#flash-meta');
  const autoSpeak = $('#auto-speak');
  const btnSpeak = $('#btn-speak');
  const btnPrevFlash = $('#btn-prev-flash');
  const btnNextFlash = $('#btn-next-flash');
  const quizImage = $('#quiz-image');
  const quizEmoji = $('#quiz-emoji');
  const quizOptions = $('#quiz-options');
  const quizTryHint = $('#quiz-try-hint');
  const quizCard = $('#quiz-card');
  const btnQuizSpeak = $('#btn-quiz-speak');
  const resultsCard = $('#results-card');
  const quizProgressFill = $('#quiz-progress-fill');
  const quizProgressText = $('#quiz-progress-text');
  const quizLiveCorrect = $('#quiz-live-correct');
  const quizLiveWrong = $('#quiz-live-wrong');
  const toastEl = $('#toast');
  const categorySelect = $('#category-select');
  const quizSizeField = $('#quiz-size-field');
  const resultsSub = $('#results-sub');

  let currentFlash = null;

  // ——— Utils ———
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getActiveWords() {
    if (selectedCategory === 'all') return words;
    return words.filter((w) => w.category === selectedCategory);
  }

  function categoryLabel(key) {
    if (key === 'all') return '全部';
    return CATEGORY_ZH[key] || key;
  }

  /**
   * Pick a random word from the filtered pool (or an explicit pool).
   * @param {number[]} [excludeIds]
   * @param {Array} [poolOverride] optional pool (e.g. all words for distractors)
   */
  function pickRandomWord(excludeIds, poolOverride) {
    const source = poolOverride || getActiveWords();
    const exclude = new Set(excludeIds || []);
    let pool = source.filter((w) => !exclude.has(w.id));
    if (pool.length === 0) pool = source.slice();
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function showToast(msg, ms = 1800) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toastEl.hidden = true;
    }, ms);
  }

  function setImage(imgEl, emojiEl, word) {
    imgEl.classList.remove('loaded');
    imgEl.removeAttribute('src');
    imgEl.alt = word.word;
    emojiEl.textContent = word.emoji || '📦';
    emojiEl.style.display = '';
    emojiEl.setAttribute('aria-hidden', 'true');

    // Soft category color behind large emoji fallback
    const wrap = imgEl.parentElement;
    if (wrap) {
      const hues = {
        home: 210, food: 25, shopping: 280, clothing: 330,
        transport: 200, weather: 160, health: 0, work: 220,
        travel: 35, daily: 170, people: 270, basics: 140,
        money: 45, tech: 195, education: 20, services: 350, leisure: 155,
        animals: 85,
      };
      const h = hues[word.category] ?? 220;
      wrap.style.background =
        `linear-gradient(145deg, hsl(${h} 42% 32% / 0.95), hsl(${h} 38% 18% / 0.98))`;
      wrap.classList.remove('image-error');
      wrap.classList.add('image-pending');
    }

    if (!word.image) {
      if (wrap) {
        wrap.classList.remove('image-pending');
        wrap.classList.add('image-error');
      }
      return;
    }

    const onOk = () => {
      imgEl.classList.add('loaded');
      if (wrap) wrap.classList.remove('image-pending', 'image-error');
      imgEl.removeEventListener('load', onOk);
      imgEl.removeEventListener('error', onErr);
    };
    const onErr = () => {
      imgEl.classList.remove('loaded');
      imgEl.removeAttribute('src');
      if (wrap) {
        wrap.classList.remove('image-pending');
        wrap.classList.add('image-error');
      }
      imgEl.removeEventListener('load', onOk);
      imgEl.removeEventListener('error', onErr);
    };
    imgEl.addEventListener('load', onOk);
    imgEl.addEventListener('error', onErr);
    imgEl.src = word.image;
  }

  // ——— Speech ———
  let preferredVoice = null;

  function scoreVoice(v) {
    const name = (v.name || '').toLowerCase();
    const lang = (v.lang || '').toLowerCase();
    let score = 0;
    if (!/^en/.test(lang)) return -1;
    // Prefer US English
    if (lang === 'en-us' || lang.startsWith('en-us')) score += 50;
    else if (lang.startsWith('en-gb')) score += 30;
    else if (lang.startsWith('en')) score += 20;
    // Prefer natural / premium sounding voices by name heuristics
    const preferred = [
      'google us english', 'google uk english female', 'google uk english male',
      'samantha', 'karen', 'daniel', 'moira', 'tessa', 'alex',
      'microsoft aria', 'microsoft jenny', 'microsoft guy', 'microsoft michelle',
      'natural', 'neural', 'premium', 'enhanced',
    ];
    for (let i = 0; i < preferred.length; i++) {
      if (name.includes(preferred[i])) score += 40 - i;
    }
    // Penalize robotic / compact / novelty voices
    if (/compact|eloquence|whisper|zarvox|trinoids|bad news|good news|bells|boing|bubbles|cellos|junior|kathy|princess|ralph|bruce|albert|bahh|deranged/.test(name)) {
      score -= 80;
    }
    if (v.localService) score += 5;
    return score;
  }

  function pickBestVoice() {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const v of voices) {
      const s = scoreVoice(v);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function refreshPreferredVoice() {
    preferredVoice = pickBestVoice();
    const info = document.getElementById('voice-info');
    if (info) {
      info.textContent = preferredVoice
        ? ('語音：' + preferredVoice.name.replace(/\s*\(.*?\)\s*/g, ' ').trim())
        : '語音：系統預設';
    }
  }

  function speak(text, opts) {
    if (!window.speechSynthesis) {
      showToast('此瀏覽器不支援語音朗讀');
      return;
    }
    const rate = (opts && typeof opts.rate === 'number') ? opts.rate : 0.78;
    window.speechSynthesis.cancel();
    // Some browsers need a short tick after cancel before speaking again
    const run = () => {
      if (!preferredVoice) refreshPreferredVoice();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (preferredVoice && preferredVoice.lang) || 'en-US';
      // Slower + slightly lower pitch sounds clearer for learners
      u.rate = rate;
      u.pitch = 1.0;
      u.volume = 1;
      if (preferredVoice) u.voice = preferredVoice;
      window.speechSynthesis.speak(u);
    };
    setTimeout(run, 40);
  }

  // Chrome loads voices async
  if (window.speechSynthesis) {
    refreshPreferredVoice();
    window.speechSynthesis.onvoiceschanged = refreshPreferredVoice;
  }

  // ——— Flashcard ———
  function updatePrevButton() {
    if (!btnPrevFlash) return;
    btnPrevFlash.disabled = flashHistory.length === 0;
  }

  function showFlashcard(word) {
    currentFlash = word;
    recentFlashIds.push(word.id);
    if (recentFlashIds.length > RECENT_LIMIT) recentFlashIds.shift();

    flashWord.textContent = word.word;
    flashZh.textContent = word.zh;
    flashCategory.textContent = CATEGORY_ZH[word.category] || word.category;
    setImage(flashImage, flashEmoji, word);
    const poolLen = getActiveWords().length;
    flashMeta.textContent = `共 ${poolLen} 個單字 · #${word.id}`;
    updatePrevButton();

    if (autoSpeak.checked) speak(word.word);
  }

  function showEmptyFlashPool() {
    currentFlash = null;
    flashWord.textContent = '—';
    flashZh.textContent = '此分類目前沒有單字';
    flashCategory.textContent = categoryLabel(selectedCategory);
    flashMeta.textContent = '共 0 個單字';
    flashImage.classList.remove('loaded');
    flashImage.removeAttribute('src');
    flashEmoji.textContent = '📭';
    const wrap = flashImage.parentElement;
    if (wrap) {
      wrap.classList.remove('image-pending');
      wrap.classList.add('image-error');
      wrap.style.background =
        'linear-gradient(145deg, hsl(220 30% 28% / 0.95), hsl(220 28% 16% / 0.98))';
    }
    updatePrevButton();
    showToast('此分類沒有單字，請選其他分類');
  }

  function nextFlashcard() {
    const active = getActiveWords();
    if (!active.length) {
      showEmptyFlashPool();
      return;
    }
    if (currentFlash) {
      flashHistory.push(currentFlash);
      if (flashHistory.length > HISTORY_LIMIT) flashHistory.shift();
    }
    const word = pickRandomWord(recentFlashIds);
    if (!word) {
      showEmptyFlashPool();
      return;
    }
    showFlashcard(word);
  }

  function prevFlashcard() {
    if (!flashHistory.length) return;
    const word = flashHistory.pop();
    showFlashcard(word);
  }

  // ——— Quiz ———
  function updateQuizChrome() {
    const done = quizIndex;
    const total = quizTotal;
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    quizProgressFill.style.width = pct + '%';
    quizProgressText.textContent = `第 ${Math.min(done + (quizActive ? 1 : 0), total)} / ${total} 題`;
    if (quizActive && quizIndex < total) {
      quizProgressText.textContent = `第 ${quizIndex + 1} / ${total} 題`;
    }
    quizLiveCorrect.textContent = `✓ ${quizCorrect}`;
    quizLiveWrong.textContent = `✗ ${quizWrong}`;
  }

  function buildQuestion() {
    const active = getActiveWords();
    if (!active.length) return null;
    const answer = pickRandomWord([]);
    if (!answer) return null;
    // Distractors from same filtered pool when possible; else fall back to all words
    const distractorSource = active.length >= 3 ? active : words;
    const distractors = [];
    const used = new Set([answer.id]);
    let guard = 0;
    while (distractors.length < 2 && guard < 200) {
      guard++;
      const w = pickRandomWord([...used], distractorSource);
      if (!w || used.has(w.id)) continue;
      if (w.word.toLowerCase() === answer.word.toLowerCase()) continue;
      used.add(w.id);
      distractors.push(w);
    }
    const options = shuffle([answer, ...distractors]);
    return { answer, options, attempts: 0 };
  }

  function renderQuestion() {
    if (quizIndex >= quizTotal) {
      showResults();
      return;
    }
    if (!getActiveWords().length) {
      quizActive = false;
      quizCard.hidden = false;
      resultsCard.hidden = true;
      quizOptions.innerHTML = '';
      quizTryHint.hidden = true;
      quizEmoji.textContent = '📭';
      quizImage.classList.remove('loaded');
      quizImage.removeAttribute('src');
      const wrap = quizImage.parentElement;
      if (wrap) {
        wrap.classList.remove('image-pending');
        wrap.classList.add('image-error');
      }
      const empty = document.createElement('p');
      empty.className = 'empty-pool-msg';
      empty.textContent = '此分類目前沒有單字，請改選其他分類後再測驗。';
      quizOptions.appendChild(empty);
      updateQuizChrome();
      return;
    }
    quizActive = true;
    currentQuestion = buildQuestion();
    if (!currentQuestion) {
      showToast('無法出題，請更換分類');
      return;
    }
    quizTryHint.hidden = true;
    quizCard.hidden = false;
    resultsCard.hidden = true;

    const { answer, options } = currentQuestion;
    setImage(quizImage, quizEmoji, answer);

    quizOptions.innerHTML = '';
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn';
      btn.textContent = opt.word;
      btn.dataset.id = String(opt.id);
      btn.addEventListener('click', () => onPickOption(opt, btn));
      quizOptions.appendChild(btn);
    });
    updateQuizChrome();
  }

  function onPickOption(opt, btn) {
    if (!quizActive || !currentQuestion) return;
    const { answer } = currentQuestion;
    const buttons = [...quizOptions.querySelectorAll('.option-btn')];

    if (opt.id === answer.id) {
      // Correct
      buttons.forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.id) === answer.id) b.classList.add('correct');
      });
      quizCorrect++;
      quizIndex++;
      quizActive = false;
      updateQuizChrome();
      setTimeout(() => {
        if (quizIndex >= quizTotal) showResults();
        else renderQuestion();
      }, 550);
      return;
    }

    // Wrong
    currentQuestion.attempts += 1;
    btn.classList.add('wrong');
    btn.disabled = true;

    if (currentQuestion.attempts >= 2) {
      // Skip after 2 wrongs
      buttons.forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.id) === answer.id) b.classList.add('correct');
      });
      quizWrong++;
      quizIndex++;
      quizActive = false;
      quizTryHint.hidden = true;
      updateQuizChrome();
      showToast(`正確答案：${answer.word}`, 1400);
      setTimeout(() => {
        if (quizIndex >= quizTotal) showResults();
        else renderQuestion();
      }, 900);
    } else {
      quizTryHint.hidden = false;
      updateQuizChrome();
    }
  }

  function showResults() {
    quizActive = false;
    quizCard.hidden = true;
    resultsCard.hidden = false;
    $('#results-correct').textContent = String(quizCorrect);
    $('#results-wrong').textContent = String(quizWrong);
    const total = quizTotal;
    const acc = quizCorrect === 0 && quizWrong === 0
      ? 0
      : Math.round((quizCorrect / total) * 100);
    $('#results-accuracy').textContent = `正確率 ${acc}%`;
    const emoji = acc >= 90 ? '🏆' : acc >= 70 ? '🎉' : acc >= 50 ? '👍' : '💪';
    $('#results-emoji').textContent = emoji;
    if (resultsSub) resultsSub.textContent = `共完成 ${total} 題`;
    quizProgressFill.style.width = '100%';
    quizProgressText.textContent = `第 ${total} / ${total} 題 · 完成`;
    quizLiveCorrect.textContent = `✓ ${quizCorrect}`;
    quizLiveWrong.textContent = `✗ ${quizWrong}`;
  }

  function startQuiz() {
    quizIndex = 0;
    quizCorrect = 0;
    quizWrong = 0;
    currentQuestion = null;
    resultsCard.hidden = true;
    quizCard.hidden = false;
    renderQuestion();
  }

  // ——— Navigation ———
  function setMode(mode) {
    learningMode = mode;
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (quizSizeField) quizSizeField.hidden = mode !== 'quiz';
    applyContentAndMode();
    // Analytics API only accepts mode flashcard|quiz — never send for sentence content
    if (contentType === 'words') {
      trackModeEnter(mode);
    }
  }

  function hideWordViews() {
    if (flashView) {
      flashView.classList.remove('active');
      flashView.hidden = true;
    }
    if (quizView) {
      quizView.classList.remove('active');
      quizView.hidden = true;
    }
  }

  function applyContentAndMode() {
    const categoryField = document.getElementById('category-field');
    const sceneField = document.getElementById('scene-field');
    const SM = window.SentenceMode;

    if (contentType === 'words') {
      if (categoryField) categoryField.hidden = false;
      if (sceneField) sceneField.hidden = true;
      if (SM && typeof SM.hideAll === 'function') SM.hideAll();
      if (learningMode === 'flashcard') {
        flashView.classList.add('active');
        flashView.hidden = false;
        quizView.classList.remove('active');
        quizView.hidden = true;
      } else {
        quizView.classList.add('active');
        quizView.hidden = false;
        flashView.classList.remove('active');
        flashView.hidden = true;
        if (!quizActive && quizIndex === 0 && !currentQuestion) {
          startQuiz();
        }
      }
    } else {
      if (categoryField) categoryField.hidden = true;
      if (sceneField) sceneField.hidden = false;
      hideWordViews();
      if (SM && typeof SM.showMode === 'function') {
        SM.showMode(learningMode);
      }
    }
  }

  function setContentType(next) {
    if (next !== 'words' && next !== 'sentences') return;
    contentType = next;
    document.querySelectorAll('.content-btn').forEach((b) => {
      const on = b.dataset.content === next;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    applyContentAndMode();
    // Do NOT send mode_enter for sentences (API Literal flashcard|quiz only).
    // When returning to words, re-track current learning mode.
    if (contentType === 'words') {
      trackModeEnter(learningMode);
    }
  }

  function populateCategorySelect() {
    if (!categorySelect) return;
    const present = new Set(words.map((w) => w.category));
    // Keep order of CATEGORY_ZH keys; append any unknown categories
    const keys = Object.keys(CATEGORY_ZH).filter((k) => present.has(k));
    present.forEach((k) => {
      if (!CATEGORY_ZH[k] && !keys.includes(k)) keys.push(k);
    });
    // Clear except first "all" option
    while (categorySelect.options.length > 1) categorySelect.remove(1);
    keys.forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = CATEGORY_ZH[key] || key;
      categorySelect.appendChild(opt);
    });
    categorySelect.value = selectedCategory;
  }

  function applyCategoryChange(newCat) {
    selectedCategory = newCat || 'all';
    // Reset flash recent/history for the new pool
    recentFlashIds = [];
    flashHistory = [];
    currentFlash = null;
    updatePrevButton();
    if (flashView.classList.contains('active')) {
      nextFlashcard();
    }
    // Always reset quiz counters; restart if quiz view is showing
    quizIndex = 0;
    quizCorrect = 0;
    quizWrong = 0;
    currentQuestion = null;
    quizActive = false;
    if (resultsCard) resultsCard.hidden = true;
    if (quizView.classList.contains('active')) {
      startQuiz();
    }
  }

  function applyQuizSize(size) {
    const n = Number(size);
    if (![20, 50, 100].includes(n)) return;
    quizTotal = n;
    document.querySelectorAll('.size-chip').forEach((btn) => {
      const on = Number(btn.dataset.size) === n;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (window.SentenceMode && typeof window.SentenceMode.setQuizSize === 'function') {
      window.SentenceMode.setQuizSize(n);
    }
    if (contentType === 'words' && quizView.classList.contains('active')) {
      startQuiz();
    } else if (contentType === 'words') {
      quizIndex = 0;
      quizCorrect = 0;
      quizWrong = 0;
      currentQuestion = null;
      quizActive = false;
      if (resultsCard) resultsCard.hidden = true;
    }
  }

  // ——— Init ———
  async function init() {
    try {
      if (Array.isArray(window.VOCAB_WORDS) && window.VOCAB_WORDS.length >= 10) {
        words = window.VOCAB_WORDS;
      } else {
        const res = await fetch('data/words.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        words = await res.json();
      }
      if (!Array.isArray(words) || words.length < 10) {
        throw new Error('單字資料不足');
      }
    } catch (err) {
      console.error(err);
      flashWord.textContent = '載入失敗';
      flashZh.textContent = '找不到單字資料。請確認 data/words.js 或 data/words.json 存在';
      flashMeta.textContent = String(err.message || err);
      showToast('無法載入單字資料');
      return;
    }

    populateCategorySelect();
    flashMeta.textContent = `共 ${getActiveWords().length} 個單字`;
    // Sync size-chip UI with default quizTotal
    applyQuizSize(quizTotal);
    startAnalytics();
    nextFlashcard();

    document.querySelectorAll('.content-btn').forEach((btn) => {
      btn.addEventListener('click', () => setContentType(btn.dataset.content));
    });
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        applyCategoryChange(categorySelect.value);
      });
    }
    document.querySelectorAll('.size-chip').forEach((btn) => {
      btn.addEventListener('click', () => applyQuizSize(btn.dataset.size));
    });
    btnSpeak.addEventListener('click', () => {
      if (currentFlash) speak(currentFlash.word);
    });
    if (btnQuizSpeak) {
      btnQuizSpeak.addEventListener('click', () => {
        if (currentQuestion && currentQuestion.answer) {
          speak(currentQuestion.answer.word);
        }
      });
    }
    if (btnPrevFlash) btnPrevFlash.addEventListener('click', prevFlashcard);
    btnNextFlash.addEventListener('click', nextFlashcard);
    $('#btn-restart-quiz').addEventListener('click', startQuiz);

    // Keyboard: N = next, B / ← = previous, Space = speak (word flash mode only)
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, button, select')) return;
      if (contentType !== 'words' || !flashView.classList.contains('active')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        nextFlashcard();
      } else if (e.key === 'b' || e.key === 'B' || e.key === 'ArrowLeft') {
        e.preventDefault();
        prevFlashcard();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (currentFlash) speak(currentFlash.word);
      }
    });
  }

  window.VocabApp = {
    speak: speak,
    shuffle: shuffle,
    showToast: showToast,
    getContentType: function () { return contentType; },
    getLearningMode: function () { return learningMode; },
  };

  init();
})();
