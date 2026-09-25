/**
 * Daily English Vocab — Sentence mode (flash + lightweight quiz)
 * Depends on window.VOCAB_SENTENCES and helpers exposed by app.js via window.VocabApp
 */
(function () {
  'use strict';

  const SCENE_ZH = {
    school: '學校',
    office: '公司／職場',
    restaurant: '餐廳',
    station: '車站',
    shopping: '購物',
    home: '居家',
    hospital: '醫院／診所',
  };

  const SCENE_EMOJI = {
    school: '🏫',
    office: '💼',
    restaurant: '🍽️',
    station: '🚉',
    shopping: '🛒',
    home: '🏠',
    hospital: '🏥',
  };

  /** @type {Array<{id:number,scene:string,en:string,zh:string}>} */
  let sentences = [];
  let selectedScene = 'all';
  let recentIds = [];
  const RECENT_LIMIT = 40;
  let history = [];
  const HISTORY_LIMIT = 50;
  let current = null;

  let quizTotal = 50;
  let quizIndex = 0;
  let quizCorrect = 0;
  let quizWrong = 0;
  let currentQuestion = null;
  let quizActive = false;

  const $ = (sel) => document.querySelector(sel);

  function app() {
    return window.VocabApp || {};
  }

  function shuffle(arr) {
    if (typeof app().shuffle === 'function') return app().shuffle(arr);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // item: sentence object ({ id, en }) — plays audio/sentences/{id}.mp3
  function speak(item) {
    if (!item) return;
    const text = item.en;
    if (typeof app().speak === 'function') {
      // rate applies only to the speechSynthesis fallback (slightly slower for sentences)
      app().speak(text, { kind: 'sentence', id: item.id, rate: 0.72 });
      return;
    }
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.72;
    window.speechSynthesis.speak(u);
  }

  function showToast(msg, ms) {
    if (typeof app().showToast === 'function') app().showToast(msg, ms);
  }

  function getActive() {
    if (selectedScene === 'all') return sentences;
    return sentences.filter((s) => s.scene === selectedScene);
  }

  function sceneLabel(key) {
    if (key === 'all') return '全部';
    return SCENE_ZH[key] || key;
  }

  function pickRandom(excludeIds, poolOverride) {
    const source = poolOverride || getActive();
    const exclude = new Set(excludeIds || []);
    let pool = source.filter((s) => !exclude.has(s.id));
    if (!pool.length) pool = source.slice();
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function updatePrevBtn() {
    const btn = $('#btn-prev-sentence');
    if (btn) btn.disabled = history.length === 0;
  }

  function showSentence(item) {
    current = item;
    recentIds.push(item.id);
    if (recentIds.length > RECENT_LIMIT) recentIds.shift();

    const enEl = $('#sentence-en');
    const zhEl = $('#sentence-zh');
    const pill = $('#sentence-scene-pill');
    const emoji = $('#sentence-scene-emoji');
    const meta = $('#sentence-flash-meta');

    if (enEl) enEl.textContent = item.en;
    if (zhEl) zhEl.textContent = item.zh;
    if (pill) pill.textContent = SCENE_ZH[item.scene] || item.scene;
    if (emoji) emoji.textContent = SCENE_EMOJI[item.scene] || '💬';
    if (meta) meta.textContent = `共 ${getActive().length} 句 · #${item.id}`;
    updatePrevBtn();

    const auto = $('#sentence-auto-speak');
    if (auto && auto.checked) speak(item);
  }

  function showEmpty() {
    current = null;
    const enEl = $('#sentence-en');
    const zhEl = $('#sentence-zh');
    const pill = $('#sentence-scene-pill');
    const emoji = $('#sentence-scene-emoji');
    const meta = $('#sentence-flash-meta');
    if (enEl) enEl.textContent = '—';
    if (zhEl) zhEl.textContent = '此情境目前沒有句子';
    if (pill) pill.textContent = sceneLabel(selectedScene);
    if (emoji) emoji.textContent = '📭';
    if (meta) meta.textContent = '共 0 句';
    updatePrevBtn();
    showToast('此情境沒有句子，請選其他情境');
  }

  function nextSentence() {
    const active = getActive();
    if (!active.length) {
      showEmpty();
      return;
    }
    if (current) {
      history.push(current);
      if (history.length > HISTORY_LIMIT) history.shift();
    }
    const item = pickRandom(recentIds);
    if (!item) {
      showEmpty();
      return;
    }
    showSentence(item);
  }

  function prevSentence() {
    if (!history.length) return;
    const item = history.pop();
    showSentence(item);
  }

  // ——— Sentence quiz: see ZH, pick EN ———
  function updateQuizChrome() {
    const fill = $('#sentence-quiz-progress-fill');
    const text = $('#sentence-quiz-progress-text');
    const ok = $('#sentence-quiz-live-correct');
    const bad = $('#sentence-quiz-live-wrong');
    const total = quizTotal;
    const done = quizIndex;
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    if (fill) fill.style.width = pct + '%';
    if (text) {
      text.textContent = quizActive && quizIndex < total
        ? `第 ${quizIndex + 1} / ${total} 題`
        : `第 ${Math.min(done + (quizActive ? 1 : 0), total)} / ${total} 題`;
    }
    if (ok) ok.textContent = `✓ ${quizCorrect}`;
    if (bad) bad.textContent = `✗ ${quizWrong}`;
  }

  function buildQuestion() {
    const active = getActive();
    if (!active.length) return null;
    const answer = pickRandom([]);
    if (!answer) return null;
    const source = active.length >= 3 ? active : sentences;
    const distractors = [];
    const used = new Set([answer.id]);
    let guard = 0;
    while (distractors.length < 2 && guard < 200) {
      guard++;
      const s = pickRandom([...used], source);
      if (!s || used.has(s.id)) continue;
      if (s.en.toLowerCase() === answer.en.toLowerCase()) continue;
      used.add(s.id);
      distractors.push(s);
    }
    return { answer, options: shuffle([answer, ...distractors]), attempts: 0 };
  }

  function renderQuestion() {
    const quizCard = $('#sentence-quiz-card');
    const resultsCard = $('#sentence-results-card');
    const optionsEl = $('#sentence-quiz-options');
    const tryHint = $('#sentence-quiz-try-hint');
    const zhEl = $('#sentence-quiz-zh');
    const emojiEl = $('#sentence-quiz-emoji');

    if (quizIndex >= quizTotal) {
      showResults();
      return;
    }
    if (!getActive().length) {
      quizActive = false;
      if (quizCard) quizCard.hidden = false;
      if (resultsCard) resultsCard.hidden = true;
      if (optionsEl) {
        optionsEl.innerHTML = '';
        const empty = document.createElement('p');
        empty.className = 'empty-pool-msg';
        empty.textContent = '此情境目前沒有句子，請改選其他情境後再測驗。';
        optionsEl.appendChild(empty);
      }
      if (tryHint) tryHint.hidden = true;
      updateQuizChrome();
      return;
    }

    quizActive = true;
    currentQuestion = buildQuestion();
    if (!currentQuestion) {
      showToast('無法出題，請更換情境');
      return;
    }
    if (tryHint) tryHint.hidden = true;
    if (quizCard) quizCard.hidden = false;
    if (resultsCard) resultsCard.hidden = true;

    const { answer, options } = currentQuestion;
    if (zhEl) zhEl.textContent = answer.zh;
    if (emojiEl) emojiEl.textContent = SCENE_EMOJI[answer.scene] || '💬';

    if (optionsEl) {
      optionsEl.innerHTML = '';
      options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'option-btn option-sentence';
        btn.textContent = opt.en;
        btn.dataset.id = String(opt.id);
        btn.addEventListener('click', () => onPick(opt, btn));
        optionsEl.appendChild(btn);
      });
    }
    updateQuizChrome();
  }

  function onPick(opt, btn) {
    if (!quizActive || !currentQuestion) return;
    const { answer } = currentQuestion;
    const optionsEl = $('#sentence-quiz-options');
    const buttons = optionsEl
      ? [...optionsEl.querySelectorAll('.option-btn')]
      : [];
    const tryHint = $('#sentence-quiz-try-hint');

    if (opt.id === answer.id) {
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

    currentQuestion.attempts += 1;
    btn.classList.add('wrong');
    btn.disabled = true;

    if (currentQuestion.attempts >= 2) {
      buttons.forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.id) === answer.id) b.classList.add('correct');
      });
      quizWrong++;
      quizIndex++;
      quizActive = false;
      if (tryHint) tryHint.hidden = true;
      updateQuizChrome();
      showToast('正確答案已標示', 1400);
      setTimeout(() => {
        if (quizIndex >= quizTotal) showResults();
        else renderQuestion();
      }, 900);
    } else if (tryHint) {
      tryHint.hidden = false;
      updateQuizChrome();
    }
  }

  function showResults() {
    quizActive = false;
    const quizCard = $('#sentence-quiz-card');
    const resultsCard = $('#sentence-results-card');
    if (quizCard) quizCard.hidden = true;
    if (resultsCard) resultsCard.hidden = false;

    const total = quizTotal;
    const acc = quizCorrect === 0 && quizWrong === 0
      ? 0
      : Math.round((quizCorrect / total) * 100);
    const emoji = acc >= 90 ? '🏆' : acc >= 70 ? '🎉' : acc >= 50 ? '👍' : '💪';

    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
    set('#sentence-results-correct', String(quizCorrect));
    set('#sentence-results-wrong', String(quizWrong));
    set('#sentence-results-accuracy', `正確率 ${acc}%`);
    set('#sentence-results-emoji', emoji);
    set('#sentence-results-sub', `共完成 ${total} 題`);

    const fill = $('#sentence-quiz-progress-fill');
    if (fill) fill.style.width = '100%';
    set('#sentence-quiz-progress-text', `第 ${total} / ${total} 題 · 完成`);
    set('#sentence-quiz-live-correct', `✓ ${quizCorrect}`);
    set('#sentence-quiz-live-wrong', `✗ ${quizWrong}`);
  }

  function startQuiz() {
    quizIndex = 0;
    quizCorrect = 0;
    quizWrong = 0;
    currentQuestion = null;
    const resultsCard = $('#sentence-results-card');
    const quizCard = $('#sentence-quiz-card');
    if (resultsCard) resultsCard.hidden = true;
    if (quizCard) quizCard.hidden = false;
    renderQuestion();
  }

  function populateSceneSelect() {
    const sel = $('#scene-select');
    if (!sel) return;
    const present = new Set(sentences.map((s) => s.scene));
    const keys = Object.keys(SCENE_ZH).filter((k) => present.has(k));
    present.forEach((k) => {
      if (!SCENE_ZH[k] && !keys.includes(k)) keys.push(k);
    });
    while (sel.options.length > 1) sel.remove(1);
    keys.forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = SCENE_ZH[key] || key;
      sel.appendChild(opt);
    });
    sel.value = selectedScene;
  }

  function applySceneChange(newScene) {
    selectedScene = newScene || 'all';
    recentIds = [];
    history = [];
    current = null;
    updatePrevBtn();
    const flashView = $('#sentence-flash-view');
    if (flashView && flashView.classList.contains('active')) {
      nextSentence();
    }
    quizIndex = 0;
    quizCorrect = 0;
    quizWrong = 0;
    currentQuestion = null;
    quizActive = false;
    const resultsCard = $('#sentence-results-card');
    if (resultsCard) resultsCard.hidden = true;
    const quizView = $('#sentence-quiz-view');
    if (quizView && quizView.classList.contains('active')) {
      startQuiz();
    }
  }

  function setQuizSize(n) {
    if (![20, 50, 100].includes(n)) return;
    quizTotal = n;
    const quizView = $('#sentence-quiz-view');
    if (quizView && quizView.classList.contains('active')) {
      startQuiz();
    } else {
      quizIndex = 0;
      quizCorrect = 0;
      quizWrong = 0;
      currentQuestion = null;
      quizActive = false;
      const resultsCard = $('#sentence-results-card');
      if (resultsCard) resultsCard.hidden = true;
    }
  }

  function showMode(mode) {
    const flash = $('#sentence-flash-view');
    const quiz = $('#sentence-quiz-view');
    if (mode === 'flashcard') {
      if (flash) {
        flash.classList.add('active');
        flash.hidden = false;
      }
      if (quiz) {
        quiz.classList.remove('active');
        quiz.hidden = true;
      }
      if (!current) nextSentence();
    } else {
      if (quiz) {
        quiz.classList.add('active');
        quiz.hidden = false;
      }
      if (flash) {
        flash.classList.remove('active');
        flash.hidden = true;
      }
      if (!quizActive && quizIndex === 0 && !currentQuestion) {
        startQuiz();
      }
    }
  }

  function hideAll() {
    ['#sentence-flash-view', '#sentence-quiz-view'].forEach((sel) => {
      const el = $(sel);
      if (el) {
        el.classList.remove('active');
        el.hidden = true;
      }
    });
  }

  function bind() {
    const sceneSelect = $('#scene-select');
    if (sceneSelect) {
      sceneSelect.addEventListener('change', () => {
        applySceneChange(sceneSelect.value);
      });
    }
    const btnSpeak = $('#btn-speak-sentence');
    if (btnSpeak) {
      btnSpeak.addEventListener('click', () => {
        if (current) speak(current);
      });
    }
    const btnPrev = $('#btn-prev-sentence');
    const btnNext = $('#btn-next-sentence');
    if (btnPrev) btnPrev.addEventListener('click', prevSentence);
    if (btnNext) btnNext.addEventListener('click', nextSentence);

    const btnQuizSpeak = $('#btn-sentence-quiz-speak');
    if (btnQuizSpeak) {
      btnQuizSpeak.addEventListener('click', () => {
        if (currentQuestion && currentQuestion.answer) {
          speak(currentQuestion.answer);
        }
      });
    }
    const btnRestart = $('#btn-restart-sentence-quiz');
    if (btnRestart) btnRestart.addEventListener('click', startQuiz);

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, button, select')) return;
      const flash = $('#sentence-flash-view');
      if (!flash || !flash.classList.contains('active') || flash.hidden) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        nextSentence();
      } else if (e.key === 'b' || e.key === 'B' || e.key === 'ArrowLeft') {
        e.preventDefault();
        prevSentence();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (current) speak(current);
      }
    });
  }

  function loadData() {
    if (Array.isArray(window.VOCAB_SENTENCES) && window.VOCAB_SENTENCES.length) {
      sentences = window.VOCAB_SENTENCES;
      return true;
    }
    return false;
  }

  async function init() {
    if (!loadData()) {
      try {
        const res = await fetch('data/sentences.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        sentences = await res.json();
      } catch (err) {
        console.error(err);
        showToast('無法載入句子資料');
        return;
      }
    }
    if (!Array.isArray(sentences) || sentences.length < 10) {
      showToast('句子資料不足');
      return;
    }
    populateSceneSelect();
    bind();
  }

  window.SentenceMode = {
    SCENE_ZH,
    init,
    showMode,
    hideAll,
    setQuizSize,
    applySceneChange,
    nextSentence,
    getCount: () => sentences.length,
    getSceneCounts: () => {
      const c = {};
      sentences.forEach((s) => {
        c[s.scene] = (c[s.scene] || 0) + 1;
      });
      return c;
    },
  };

  // Init after DOM; app.js may still be loading VocabApp
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
