/**
 * Daily English Vocab — Flashcard + Quiz
 * Traditional Chinese UI · English vocabulary
 */
(function () {
  'use strict';

  const QUIZ_TOTAL = 100;
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
  };


  // ——— Analytics (events → FastAPI POST /events) ———
  const ANALYTICS_BASE = (window.ANALYTICS_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const SESSION_KEY = 'de_vocab_session_id';

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = uuid();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (_) {
      return uuid();
    }
  }

  function track(type, extra) {
    const payload = Object.assign(
      {
        type: type,
        session_id: getSessionId(),
        ts: new Date().toISOString(),
      },
      extra || {}
    );
    const body = JSON.stringify(payload);
    const url = ANALYTICS_BASE + '/events';
    try {
      if (type === 'session_end' && navigator.sendBeacon) {
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
      }).catch(function () { /* ignore */ });
    } catch (_) {
      /* never block UI */
    }
  }

  function trackSessionStart() {
    track('session_start');
  }

  function trackModeEnter(mode) {
    if (mode !== 'flashcard' && mode !== 'quiz') return;
    track('mode_enter', { mode: mode });
  }

  function trackSessionEnd() {
    track('session_end');
  }

  /** @type {Array<{id:number,word:string,zh:string,emoji:string,category:string,image?:string}>} */
  let words = [];
  let recentFlashIds = [];
  const RECENT_LIMIT = 40;

  // Quiz state
  let quizIndex = 0; // completed questions (0..100)
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
  const btnNextFlash = $('#btn-next-flash');
  const quizImage = $('#quiz-image');
  const quizEmoji = $('#quiz-emoji');
  const quizOptions = $('#quiz-options');
  const quizTryHint = $('#quiz-try-hint');
  const quizCard = $('#quiz-card');
  const resultsCard = $('#results-card');
  const quizProgressFill = $('#quiz-progress-fill');
  const quizProgressText = $('#quiz-progress-text');
  const quizLiveCorrect = $('#quiz-live-correct');
  const quizLiveWrong = $('#quiz-live-wrong');
  const toastEl = $('#toast');

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

  function pickRandomWord(excludeIds) {
    const exclude = new Set(excludeIds || []);
    let pool = words.filter((w) => !exclude.has(w.id));
    if (pool.length === 0) pool = words;
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

    // Colored card vibe behind emoji via category hue
    const wrap = imgEl.parentElement;
    if (wrap) {
      const hues = {
        home: 210, food: 25, shopping: 280, clothing: 330,
        transport: 200, weather: 160, health: 0, work: 220,
        travel: 35, daily: 170, people: 270, basics: 140,
        money: 45, tech: 195, education: 20, services: 350, leisure: 155,
      };
      const h = hues[word.category] ?? 220;
      wrap.style.background = `linear-gradient(145deg, hsl(${h} 35% 28%), hsl(${h} 40% 16%))`;
    }

    if (!word.image) return;

    const onOk = () => {
      imgEl.classList.add('loaded');
      imgEl.removeEventListener('load', onOk);
      imgEl.removeEventListener('error', onErr);
    };
    const onErr = () => {
      imgEl.classList.remove('loaded');
      imgEl.removeAttribute('src');
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

  function speak(text) {
    if (!window.speechSynthesis) {
      showToast('此瀏覽器不支援語音朗讀');
      return;
    }
    window.speechSynthesis.cancel();
    // Some browsers need a short tick after cancel before speaking again
    const run = () => {
      if (!preferredVoice) refreshPreferredVoice();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (preferredVoice && preferredVoice.lang) || 'en-US';
      // Slower + slightly lower pitch sounds clearer for learners
      u.rate = 0.78;
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
  function showFlashcard(word) {
    currentFlash = word;
    recentFlashIds.push(word.id);
    if (recentFlashIds.length > RECENT_LIMIT) recentFlashIds.shift();

    flashWord.textContent = word.word;
    flashZh.textContent = word.zh;
    flashCategory.textContent = CATEGORY_ZH[word.category] || word.category;
    setImage(flashImage, flashEmoji, word);
    flashMeta.textContent = `共 ${words.length} 個單字 · #${word.id}`;

    if (autoSpeak.checked) speak(word.word);
  }

  function nextFlashcard() {
    const word = pickRandomWord(recentFlashIds);
    showFlashcard(word);
  }

  // ——— Quiz ———
  function updateQuizChrome() {
    const done = quizIndex;
    const pct = Math.min(100, (done / QUIZ_TOTAL) * 100);
    quizProgressFill.style.width = pct + '%';
    quizProgressText.textContent = `第 ${Math.min(done + (quizActive ? 1 : 0), QUIZ_TOTAL)} / ${QUIZ_TOTAL} 題`;
    // When showing a question, display "current question number" as done+1
    if (quizActive && quizIndex < QUIZ_TOTAL) {
      quizProgressText.textContent = `第 ${quizIndex + 1} / ${QUIZ_TOTAL} 題`;
    }
    quizLiveCorrect.textContent = `✓ ${quizCorrect}`;
    quizLiveWrong.textContent = `✗ ${quizWrong}`;
  }

  function buildQuestion() {
    const answer = pickRandomWord([]);
    // 2 wrong options from other words
    const distractors = [];
    const used = new Set([answer.id]);
    let guard = 0;
    while (distractors.length < 2 && guard < 200) {
      guard++;
      const w = pickRandomWord([...used]);
      if (used.has(w.id)) continue;
      // Prefer different word spelling
      if (w.word.toLowerCase() === answer.word.toLowerCase()) continue;
      used.add(w.id);
      distractors.push(w);
    }
    const options = shuffle([answer, ...distractors]);
    return { answer, options, attempts: 0 };
  }

  function renderQuestion() {
    if (quizIndex >= QUIZ_TOTAL) {
      showResults();
      return;
    }
    quizActive = true;
    currentQuestion = buildQuestion();
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
        if (quizIndex >= QUIZ_TOTAL) showResults();
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
        if (quizIndex >= QUIZ_TOTAL) showResults();
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
    const acc = quizCorrect === 0 && quizWrong === 0
      ? 0
      : Math.round((quizCorrect / QUIZ_TOTAL) * 100);
    $('#results-accuracy').textContent = `正確率 ${acc}%`;
    const emoji = acc >= 90 ? '🏆' : acc >= 70 ? '🎉' : acc >= 50 ? '👍' : '💪';
    $('#results-emoji').textContent = emoji;
    quizProgressFill.style.width = '100%';
    quizProgressText.textContent = `第 ${QUIZ_TOTAL} / ${QUIZ_TOTAL} 題 · 完成`;
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
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (mode === 'flashcard') {
      flashView.classList.add('active');
      flashView.hidden = false;
      quizView.classList.remove('active');
      quizView.hidden = true;
    } else {
      quizView.classList.add('active');
      quizView.hidden = false;
      flashView.classList.remove('active');
      flashView.hidden = true;
      if (quizIndex === 0 && !currentQuestion && resultsCard.hidden) {
        startQuiz();
      }
    }
    trackModeEnter(mode);
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

    flashMeta.textContent = `共 ${words.length} 個單字`;
    nextFlashcard();

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
    btnSpeak.addEventListener('click', () => {
      if (currentFlash) speak(currentFlash.word);
    });
    btnNextFlash.addEventListener('click', nextFlashcard);
    $('#btn-restart-quiz').addEventListener('click', startQuiz);

    // Keyboard: N = next flash, Space = speak (when flash mode)
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, button')) return;
      if (!flashView.classList.contains('active')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        nextFlashcard();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (currentFlash) speak(currentFlash.word);
      }
    });

    trackSessionStart();
    trackModeEnter('flashcard');
    window.addEventListener('pagehide', trackSessionEnd);
    window.addEventListener('beforeunload', trackSessionEnd);
  }

  init();
})();
