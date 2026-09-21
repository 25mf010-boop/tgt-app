import './style.css';

// =========================================================================
// 💡 Supabaseクラウドデータベース接続設定
// =========================================================================
// 本番運用時は、Supabaseで作成した「URL」と「anonキー」を以下に貼り付けてください。
// 空白のままにしておくと、自動的にスマートフォンの「ローカル保存（localStorage）」で動作します。
const SUPABASE_URL = "https://dkhkwubcftbdgfxxssjr.supabase.co";
const SUPABASE_KEY = "sb_publishable_z6-DSpZcaUZ6SZx71x_VEQ__H4lVge9";


let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY && window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("Supabaseクラウドデータベースに接続しました。");
} else {
  console.log("Supabaseのキーが設定されていないため、ローカル保存モードで動作しています。");
}

// --- アプリのグローバル状態管理 ---
let state = {
  currentUser: null,
  isAdmin: false,
  users: {},       // ローカル用: { userId: { password, signupDate } }
  records: {},     // ローカル用: { userId: [ { date, timestamp, tgt1, tgt2, tgt3, memo, mood } ] }
  drafts: {},      // ローカル/クラウド共通: 下書き（常に端末ローカルに保存）
};

// 研究用GoogleフォームURL管理
function loadSurveyUrls() {
  const savedUrls = JSON.parse(localStorage.getItem('tgt_survey_urls') || '{}');
  return {
    survey1: savedUrls.survey1 || localStorage.getItem('tgt_survey1_url') || 'https://forms.gle/6neenACKZ4Nxs26a6',
    survey2: savedUrls.survey2 || localStorage.getItem('tgt_survey2_url') || 'https://forms.gle/2197caaQaUsnhHAm7',
    survey3: savedUrls.survey3 || localStorage.getItem('tgt_survey3_url') || 'https://forms.gle/CLGAThX9uHh1HSbk9',
    survey4: savedUrls.survey4 || localStorage.getItem('tgt_survey4_url') || 'https://forms.gle/netmLfrQxQieFrN86'
  };
}
let surveyUrls = loadSurveyUrls();

// ユーザーごとのフェーズ状態ヘルパー
function getUserPhaseData(userId) {
  const allPhases = JSON.parse(localStorage.getItem('tgt_user_phases')) || {};
  return allPhases[userId] || {
    survey1_completed: false,
    survey1_date: null,
    survey2_completed: false,
    survey3_completed: false,
    survey4_completed: false
  };
}

function saveUserPhaseData(userId, data) {
  const allPhases = JSON.parse(localStorage.getItem('tgt_user_phases')) || {};
  allPhases[userId] = { ...allPhases[userId], ...data };
  localStorage.setItem('tgt_user_phases', JSON.stringify(allPhases));
}

// 被験者の現在の研究フェーズを取得する
async function getParticipantPhase(userId) {
  const progress = await getParticipantProgress(userId);
  const phaseData = getUserPhaseData(userId);

  // 1. 初回アンケート①未完了 ➔ "baseline" (初回アンケート期)
  if (!phaseData.survey1_completed) {
    return {
      phase: 'baseline',
      label: '初回アンケート①未回答',
      badgeClass: 'baseline'
    };
  }

  // 初回アンケート①完了日からの経過日数計算
  const survey1Date = phaseData.survey1_date || getTodayString();
  const todayStr = getTodayString();
  const diffDaysFromSurvey1 = getDaysBetween(survey1Date, todayStr);

  // 2. 初回アンケート①完了後、7日未満 ➔ "waiting" (7日間待機期)
  if (diffDaysFromSurvey1 < 7) {
    const daysLeft = 7 - diffDaysFromSurvey1;
    const startDateObj = new Date(survey1Date);
    startDateObj.setDate(startDateObj.getDate() + 7);
    const startDateFormatted = formatDate(startDateObj);

    return {
      phase: 'waiting',
      label: `待機中 (あと${daysLeft}日)`,
      badgeClass: 'waiting',
      daysLeft,
      startDateFormatted
    };
  }

  // 3. 7日間待機終了直後、かつ介入開始時アンケート②未回答 ➔ "pre_intervention" (1日目記入直前)
  if (!phaseData.survey2_completed) {
    return {
      phase: 'pre_intervention',
      label: '介入開始時アンケート②未回答',
      badgeClass: 'baseline'
    };
  }

  // 4. 全工程完了 (事後アンケート④完了)
  if (phaseData.survey4_completed || phaseData.survey3_completed) {
    return {
      phase: 'complete',
      label: '全工程完了🎉',
      badgeClass: 'complete'
    };
  }

  // 5. TGT実施中
  return {
    phase: 'tgt',
    label: `TGT実施中 (${progress.currentDayNum}日目)`,
    badgeClass: 'tgt',
    isMidtermDay: progress.currentDayNum === 7,
    isFinalDay: progress.completedDays >= 14
  };
}

// 14日間の日替わりおもしろ雑学トリビア（心理的効果を一切排除し、わくわく感と読みやすさを向上）
const DAILY_TIPS = [
  {
    intro: "今日もお疲れ様でした！1日目の記録完了ですね。今日のプチ雑学はこちらです！",
    trivia: "1円玉1枚を作るための材料費は3円かかる"
  },
  {
    intro: "今日もお疲れ様でした！今日も頑張りましたね。さて、今日の気になる雑学は……",
    trivia: "日本初のコンビニ『セブンイレブン』で一番最初に売れた商品は『サングラス』"
  },
  {
    intro: "3日目の記録、お疲れ様でした！今日の豆知識コーナーです。実は……",
    trivia: "キリンの睡眠時間は1日わずか20分（しかも立ったまま小刻みに眠る）"
  },
  {
    intro: "今日もお疲れ様でした！明日も良い日になりますように。今日のトリビアはこちら！",
    trivia: "トランプの『ダイヤのキング』だけ、横顔で描かれている（他のキングは正面）"
  },
  {
    intro: "今日もお疲れ様でした！今日も頑張りましたね。今日のちょっと面白い雑学です。",
    trivia: "かき氷のシロップは, 赤や青など色が違うだけで, 実はすべて同じ味（イチゴやメロンの香料で脳が錯覚している）"
  },
  {
    intro: "今日も頑張りましたね。お疲れ様でした！今日のへぇ〜となる雑学をお届けします。",
    trivia: "ウサギは自分の糞を食べる（1回目の糞には多くの栄養が含まれており、それを再度吸収するため）"
  },
  {
    intro: "1週間達成です、素晴らしい継続力ですね！今日の気になる雑学はこちら！",
    trivia: "シャチハタのハンコは、インクを吸わせた特殊なスポンジ状のゴムでできており、朱肉がいらない"
  },
  {
    intro: "今日もお疲れ様でした！あなたのペースで続けられていて素敵です。今日の雑学は……",
    trivia: "世界で一番演奏時間が長い曲は『639年』かけて演奏されるオルガン曲（ドイツで現在も演奏中）"
  },
  {
    intro: "今日も一日お疲れ様でした！ほっと一息つきながら、今日のトリビアをどうぞ。",
    trivia: "イチゴの赤い部分は『果実』ではなく『茎の先端が膨らんだもの』。本当の果実は表面のツブツブ部分"
  },
  {
    intro: "10日目達成、お疲れ様でした！あと少しですね。今日の豆知識をお届けします！",
    trivia: "タラバガニはカニの仲間ではなく、実はヤドカリの仲間（ハサミを含めて脚の数がカニより少ない）"
  },
  {
    intro: "今日もお疲れ様でした！今日も頑張りましたね。今日の気になる雑学はこちらです！",
    trivia: "ホッキョクグマの毛は白ではなく『透明』。肌の色は『黒』。光の反射で白く見えている"
  },
  {
    intro: "今日も頑張りましたね。お疲れ様でした！今夜のプチ豆知識はこちら！",
    trivia: "アサガオは夜ではなく『夜明けの数時間前』の暗い時間から咲く準備を始めている"
  },
  {
    intro: "今日もお疲れ様でした！ついに残すところあと1日。今日のダイナミックな雑学です！",
    trivia: "宇宙ステーションでは、24時間の間に太陽が『16回』昇って沈む"
  },
  {
    intro: "14日間の記録、本当にお疲れ様でした！ご協力に心より感謝します。最後の雑学はこちら！",
    trivia: "『ポン酢』のポンはオランダ語の『ポンス（柑橘類の果汁）』が由来"
  }
];

// --- ユーティリティ関数 ---

// localStorageからのデータ読み込み（ローカル保存モード用）
function loadFromLocalStorage() {
  state.users = JSON.parse(localStorage.getItem('tgt_users')) || {};
  state.records = JSON.parse(localStorage.getItem('tgt_records')) || {};
  state.drafts = JSON.parse(localStorage.getItem('tgt_drafts')) || {};

  const savedUser = JSON.parse(localStorage.getItem('tgt_current_user'));
  if (savedUser) {
    state.currentUser = savedUser.userId;
    state.isAdmin = savedUser.isAdmin;
  }
}

// localStorageへのデータ保存（ローカル保存モード用）
function saveToLocalStorage() {
  localStorage.setItem('tgt_users', JSON.stringify(state.users));
  localStorage.setItem('tgt_records', JSON.stringify(state.records));
  localStorage.setItem('tgt_drafts', JSON.stringify(state.drafts));
}

// トースト通知の表示
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2200);
}

// 画面切り替え (SPA)
function showView(viewId) {
  document.querySelectorAll('.view-container').forEach(view => {
    view.classList.remove('active');
  });
  const activeView = document.getElementById(viewId);
  if (activeView) {
    activeView.classList.add('active');
  }
  window.scrollTo(0, 0);
}

// 日付フォーマット (YYYY年MM月DD日 (曜日))
function formatDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth() + 1;
  const d = dateObj.getDate();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const day = dayNames[dateObj.getDay()];
  return `${y}年${m}月${d}日 (${day})`;
}

// 今日を表す日付文字列 (YYYY-MM-DD)
function getTodayString() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 2つの日付の日数差を計算 (d2 - d1)
function getDaysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// --- 主要ロジック関数 ---

// 被験者の進捗データを計算する（初回記録保存日を1日目スタートとする）
async function getParticipantProgress(userId) {
  let signupDateStr = getTodayString();
  let userRecords = [];

  if (supabase) {
    // クラウドからユーザー登録日を取得
    const { data: userData } = await supabase.from('users').select('signup_date').eq('id', userId).single();
    if (userData) {
      signupDateStr = userData.signup_date;
    }
    // クラウドからユーザーの全レコードを取得
    const { data: recs } = await supabase.from('records').select('*').eq('user_id', userId);
    if (recs) {
      userRecords = recs;
    }
  } else {
    // ローカルストレージから取得
    const user = state.users[userId];
    if (user) {
      signupDateStr = user.signupDate;
    }
    userRecords = state.records[userId] || [];
  }

  // 1日目の開始基準日: 過去記録がある場合は最も古い記録の日付、未記録の場合は今日
  let startDateStr = signupDateStr;
  if (userRecords.length > 0) {
    const sortedDates = userRecords.map(r => r.date).sort();
    startDateStr = sortedDates[0];
  } else {
    startDateStr = getTodayString();
  }

  const todayStr = getTodayString();
  const diffDays = getDaysBetween(startDateStr, todayStr);
  const currentDayNum = Math.max(1, diffDays + 1); // 初回記録保存日を1日目とする

  const recordDates = new Set(userRecords.map(r => r.date));
  const completedDays = recordDates.size;
  const remainingDays = Math.max(0, 14 - currentDayNum);
  const percentage = Math.min(100, Math.round((completedDays / 14) * 100));

  // 連続記録日数
  let streak = 0;
  let checkDate = new Date();

  while (true) {
    const checkDateStr = checkDate.getFullYear() + '-' +
      String(checkDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(checkDate.getDate()).padStart(2, '0');

    if (recordDates.has(checkDateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      if (streak === 0 && checkDateStr === todayStr) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }
  }

  return { currentDayNum, completedDays, remainingDays, streak, percentage, signupDateStr: startDateStr, userRecords };
}

// 記録入力画面の表示を更新する
async function updateRecordView() {
  const userId = state.currentUser;
  if (!userId) return;

  // 研究者テスト用フェーズ切り替えバーの表示制御 (管理者のみ表示)
  document.querySelectorAll('.test-phase-bar-card').forEach(card => {
    if (state.isAdmin) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });

  const phaseInfo = await getParticipantPhase(userId);

  const initialSurveyCard = document.getElementById('initial-survey-card');
  const waitingCard = document.getElementById('waiting-countdown-card');
  const interventionSurveyCard = document.getElementById('intervention-survey-card');
  const tgtMainWrapper = document.getElementById('tgt-main-wrapper');
  const midtermBanner = document.getElementById('midterm-survey-banner');
  const notificationCard = document.getElementById('notification-card');

  // GoogleフォームURLをボタンに反映
  const s1Btn = document.getElementById('survey1-link-btn');
  const s2Btn = document.getElementById('survey2-link-btn');
  const s3Btn = document.getElementById('survey3-link-btn');
  const s4Btn = document.getElementById('survey4-link-btn');
  if (s1Btn) s1Btn.href = surveyUrls.survey1;
  if (s2Btn) s2Btn.href = surveyUrls.survey2;
  if (s3Btn) s3Btn.href = surveyUrls.survey3;
  if (s4Btn) s4Btn.href = surveyUrls.survey4;

  // 初回アンケート完了後は通知設定を表示 (待機中・介入開始時・TGT期ともに利用可能)
  if (notificationCard) {
    if (phaseInfo.phase !== 'baseline') {
      notificationCard.classList.remove('hidden');
    } else {
      notificationCard.classList.add('hidden');
    }
  }

  // 1. 初回アンケート①未回答時
  if (phaseInfo.phase === 'baseline') {
    if (initialSurveyCard) initialSurveyCard.classList.remove('hidden');
    if (waitingCard) waitingCard.classList.add('hidden');
    if (interventionSurveyCard) interventionSurveyCard.classList.add('hidden');
    if (tgtMainWrapper) tgtMainWrapper.classList.add('hidden');
    return;
  }

  // 2. 7日間待機期間中
  if (phaseInfo.phase === 'waiting') {
    if (initialSurveyCard) initialSurveyCard.classList.add('hidden');
    if (waitingCard) waitingCard.classList.remove('hidden');
    if (interventionSurveyCard) interventionSurveyCard.classList.add('hidden');
    if (tgtMainWrapper) tgtMainWrapper.classList.add('hidden');

    document.getElementById('waiting-days-left').innerText = `あと ${phaseInfo.daysLeft} 日`;
    document.getElementById('waiting-start-date').innerText = `開始予定日: ${phaseInfo.startDateFormatted}`;
    return;
  }

  // 3. 介入開始時アンケート②未回答時 (1日目記入直前)
  if (phaseInfo.phase === 'pre_intervention') {
    if (initialSurveyCard) initialSurveyCard.classList.add('hidden');
    if (waitingCard) waitingCard.classList.add('hidden');
    if (interventionSurveyCard) interventionSurveyCard.classList.remove('hidden');
    if (tgtMainWrapper) tgtMainWrapper.classList.add('hidden');
    return;
  }

  // 4. TGT介入期 (または全完了時)
  if (initialSurveyCard) initialSurveyCard.classList.add('hidden');
  if (waitingCard) waitingCard.classList.add('hidden');
  if (interventionSurveyCard) interventionSurveyCard.classList.add('hidden');
  if (tgtMainWrapper) tgtMainWrapper.classList.remove('hidden');

  if (phaseInfo.isMidtermDay) {
    midtermBanner.classList.remove('hidden');
  } else {
    midtermBanner.classList.add('hidden');
  }

  document.getElementById('current-date').innerText = formatDate(new Date());

  // クラウドまたはローカルから進捗データをロード
  const progress = await getParticipantProgress(userId);

  document.getElementById('progress-day').innerText = `${progress.currentDayNum}日目`;
  document.getElementById('progress-count').innerText = `${progress.completedDays} / 14日`;
  document.getElementById('progress-remaining').innerText = `あと${progress.remainingDays}日`;
  document.getElementById('progress-percentage').innerText = `${progress.percentage}%`;

  // 14日間の進捗リストの生成
  const progressList = document.getElementById('progress-list');
  progressList.innerHTML = '';

  const signupDateStr = progress.signupDateStr;
  const userRecords = progress.userRecords;

  for (let i = 1; i <= 14; i++) {
    const itemDate = new Date(signupDateStr);
    itemDate.setDate(itemDate.getDate() + (i - 1));
    const itemDateStr = itemDate.getFullYear() + '-' +
      String(itemDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(itemDate.getDate()).padStart(2, '0');

    const targetRecord = userRecords.find(r => r.date === itemDateStr);
    const isCompleted = !!targetRecord;
    const todayStr = getTodayString();
    const isToday = itemDateStr === todayStr;
    const isFuture = itemDate.getTime() > new Date(todayStr).getTime();

    let statusClass = 'future';
    let statusText = 'これから';

    if (isCompleted) {
      statusClass = 'completed';
      statusText = '完了 💮';
    } else if (isToday) {
      statusClass = 'today';
      statusText = '今日';
    } else if (!isFuture) {
      statusClass = 'missed';
      statusText = '未記入';
    }

    const itemGroup = document.createElement('div');
    itemGroup.className = 'progress-item-group';

    const item = document.createElement('div');
    item.className = `progress-item ${statusClass}`;

    const dateFormatted = `${itemDate.getMonth() + 1}/${itemDate.getDate()}`;
    item.innerHTML = `
      <div class="day-num">Day ${i} (${dateFormatted})</div>
      <div class="day-status">${statusText}</div>
    `;
    itemGroup.appendChild(item);

    // 過去記録の振り返り詳細（完了した日をタップした際のアコーディオン）
    if (isCompleted && targetRecord) {
      const detail = document.createElement('div');
      detail.className = 'progress-item-detail';

      const moodTexts = ['', '😢 しんどい', '🙁 しんどい', '😐 ふつう', '🙂 まあまあいい', '😊 とてもいい'];
      const moodText = moodTexts[targetRecord.mood] || 'ふつう';

      let goodsHtml = '';
      if (targetRecord.tgt1) goodsHtml += `<li>1. ${targetRecord.tgt1}</li>`;
      if (targetRecord.tgt2) goodsHtml += `<li>2. ${targetRecord.tgt2}</li>`;
      if (targetRecord.tgt3) goodsHtml += `<li>3. ${targetRecord.tgt3}</li>`;

      let memoHtml = '';
      if (targetRecord.memo) {
        memoHtml = `<div class="detail-memo">💬 ${targetRecord.memo}</div>`;
      }

      detail.innerHTML = `
        <div class="detail-mood">気分: ${moodText}</div>
        <ul class="detail-goods">${goodsHtml}</ul>
        ${memoHtml}
      `;

      item.addEventListener('click', () => {
        itemGroup.classList.toggle('expanded');
      });

      itemGroup.appendChild(detail);
    }

    progressList.appendChild(itemGroup);
  }
}

// 完了画面の表示を更新する
async function updateCompleteView() {
  const userId = state.currentUser;
  if (!userId) return;

  // 研究者テスト用フェーズ切り替えバーの表示制御 (管理者のみ表示)
  document.querySelectorAll('.test-phase-bar-card').forEach(card => {
    if (state.isAdmin) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });

  const progress = await getParticipantProgress(userId);
  const phaseData = await getUserPhaseData(userId);
  const phaseInfo = await getParticipantPhase(userId);

  // 14日達成後の最終アンケートカード制御
  const finalSurveyCard = document.getElementById('final-survey-card');
  const thanksCard = document.getElementById('all-complete-thanks-card');

  if (phaseData.survey4_completed || phaseData.survey3_completed) {
    finalSurveyCard.classList.add('hidden');
    thanksCard.classList.remove('hidden');
  } else if (progress.completedDays >= 14 || phaseInfo.isFinalDay) {
    finalSurveyCard.classList.remove('hidden');
    thanksCard.classList.add('hidden');
  } else {
    finalSurveyCard.classList.add('hidden');
    thanksCard.classList.add('hidden');
  }

  // 日替わりおもしろ雑学コラムの抽出
  const tipIndex = Math.min(progress.currentDayNum - 1, 13);
  const tip = DAILY_TIPS[tipIndex];

  const cheerMessageEl = document.getElementById('cheer-message');
  cheerMessageEl.innerHTML = `
    <p class="trivia-intro">${tip.intro}</p>
    <div class="trivia-highlight">【 ${tip.trivia} 】</div>
  `;

  // 連続記録日数
  document.getElementById('streak-days').innerText = progress.streak;

  // カレンダーグリッドの生成 (スタンプカード風)
  const calendarGrid = document.getElementById('calendar-grid');
  calendarGrid.innerHTML = '';

  const signupDateStr = progress.signupDateStr;
  const userRecords = progress.userRecords;
  const recordDates = new Set(userRecords.map(r => r.date));

  for (let i = 1; i <= 14; i++) {
    const itemDate = new Date(signupDateStr);
    itemDate.setDate(itemDate.getDate() + (i - 1));
    const itemDateStr = itemDate.getFullYear() + '-' +
      String(itemDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(itemDate.getDate()).padStart(2, '0');

    const isCompleted = recordDates.has(itemDateStr);
    const dayBox = document.createElement('div');
    dayBox.className = `calendar-day ${isCompleted ? 'completed' : ''}`;
    dayBox.innerText = i;
    calendarGrid.appendChild(dayBox);
  }
}

// 管理者画面の表示を更新する
async function updateAdminView() {
  let userList = [];
  let allRecords = [];

  // GoogleフォームURLを管理者フォームに反映
  const u1 = document.getElementById('url-survey-1');
  const u2 = document.getElementById('url-survey-2');
  const u3 = document.getElementById('url-survey-3');
  const u4 = document.getElementById('url-survey-4');
  if (u1) u1.value = surveyUrls.survey1;
  if (u2) u2.value = surveyUrls.survey2;
  if (u3) u3.value = surveyUrls.survey3;
  if (u4) u4.value = surveyUrls.survey4;

  if (supabase) {
    // Supabaseから全ユーザーと全レコードをロード
    const { data: usersData } = await supabase.from('users').select('*');
    const { data: recsData } = await supabase.from('records').select('*');
    userList = usersData || [];
    allRecords = recsData || [];
  } else {
    // ローカルからロード
    userList = Object.keys(state.users).map(id => ({
      id,
      password: state.users[id].password,
      signup_date: state.users[id].signupDate
    }));
    Object.values(state.records).forEach(userRecs => {
      allRecords.push(...userRecs);
    });
  }

  document.getElementById('admin-stat-users').innerText = userList.length;
  document.getElementById('admin-stat-records').innerText = allRecords.length;

  const tbody = document.querySelector('#admin-users-table tbody');
  tbody.innerHTML = '';

  if (userList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">被験者データがありません。</td></tr>';
    return;
  }

  // 被験者ごとに進捗と連続日数を計算し一覧表示
  for (const user of userList) {
    const userId = user.id;
    const progress = await getParticipantProgress(userId);
    const phaseInfo = await getParticipantPhase(userId);
    const userRecs = progress.userRecords;

    let lastRecordTime = 'なし';
    if (userRecs.length > 0) {
      const timestamps = userRecs.map(r => Number(r.timestamp));
      const maxTimestamp = Math.max(...timestamps);
      lastRecordTime = new Date(maxTimestamp).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${userId}</strong></td>
      <td><code>${user.password || ''}</code></td>
      <td><span class="phase-badge ${phaseInfo.badgeClass}">${phaseInfo.label}</span></td>
      <td>${progress.completedDays} / 14日 (${progress.percentage}%)</td>
      <td>🔥 ${progress.streak}日</td>
      <td>${lastRecordTime}</td>
      <td>
        <div class="action-btn-group" style="flex-direction: column; gap: 4px; align-items: stretch;">
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-sm view-detail-btn" data-user="${userId}">詳細</button>
            <button class="btn-edit-sm edit-pw-btn" data-user="${userId}">編集</button>
            <button class="btn-danger-sm delete-user-btn" data-user="${userId}">削除</button>
          </div>
          <div style="display: flex; gap: 4px; align-items: center; margin-top: 2px;">
            <select class="phase-sim-select" data-user="${userId}" style="font-size: 0.7rem; padding: 2px;">
              <option value="">🧪 テスト用フェーズ変更</option>
              <option value="baseline">1. 初回アンケート①未回答</option>
              <option value="waiting">2. 待機中 (あと7日)</option>
              <option value="pre_intervention">3. 介入開始時アンケート②未回答 (1日目記入前)</option>
              <option value="tgt1">4. TGT1日目</option>
              <option value="tgt7">5. TGT7日目 (中間アンケート③表示)</option>
              <option value="tgt14">6. TGT14日目 (事後アンケート④表示)</option>
              <option value="complete">7. 全工程完了感謝表示</option>
            </select>
            <button class="btn btn-primary btn-sm login-as-user-btn" data-user="${userId}" style="font-size: 0.7rem; padding: 2px 6px;">ログイン</button>
          </div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  document.querySelectorAll('.view-detail-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const userId = e.target.getAttribute('data-user');
      showAdminUserDetail(userId);
    });
  });

  document.querySelectorAll('.edit-pw-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const userId = e.target.getAttribute('data-user');
      openEditPasswordModal(userId);
    });
  });

  document.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = e.target.getAttribute('data-user');
      await deleteParticipantUser(userId);
    });
  });

  document.querySelectorAll('.phase-sim-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const userId = e.target.getAttribute('data-user');
      const phaseVal = e.target.value;
      if (!phaseVal) return;
      await simulateUserPhase(userId, phaseVal);
    });
  });

  document.querySelectorAll('.login-as-user-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = e.target.getAttribute('data-user');
      state.currentUser = userId;
      state.isAdmin = false;
      localStorage.setItem('tgt_current_user', JSON.stringify({ userId, isAdmin: false }));
      showToast(`被験者「${userId}」として画面を開きました。`);
      showView('record-view');
      await updateRecordView();
    });
  });
}

// テスト用フェーズ変更関数
async function simulateUserPhase(userId, targetPhase) {
  const today = new Date();
  const format = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const todayStr = format(today);

  let phaseData = {
    survey1_completed: true,
    survey1_date: todayStr,
    survey2_completed: true,
    survey3_completed: false,
    survey4_completed: false
  };

  if (targetPhase === 'baseline') {
    phaseData.survey1_completed = false;
    phaseData.survey1_date = null;
    phaseData.survey2_completed = false;
    phaseData.survey4_completed = false;
  } else if (targetPhase === 'waiting') {
    phaseData.survey1_completed = true;
    phaseData.survey1_date = todayStr;
    phaseData.survey2_completed = false;
    phaseData.survey4_completed = false;
  } else if (targetPhase === 'pre_intervention') {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    phaseData.survey1_completed = true;
    phaseData.survey1_date = format(d);
    phaseData.survey2_completed = false;
    phaseData.survey4_completed = false;
  } else if (targetPhase === 'tgt1') {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    phaseData.survey1_completed = true;
    phaseData.survey1_date = format(d);
    phaseData.survey2_completed = true;
    phaseData.survey4_completed = false;
  } else if (targetPhase === 'tgt7') {
    const d = new Date(today);
    d.setDate(d.getDate() - 13);
    phaseData.survey1_completed = true;
    phaseData.survey1_date = format(d);
    phaseData.survey2_completed = true;
    phaseData.survey4_completed = false;
  } else if (targetPhase === 'tgt14') {
    const d = new Date(today);
    d.setDate(d.getDate() - 20);
    phaseData.survey1_completed = true;
    phaseData.survey1_date = format(d);
    phaseData.survey2_completed = true;
    phaseData.survey4_completed = false;
  } else if (targetPhase === 'complete') {
    const d = new Date(today);
    d.setDate(d.getDate() - 21);
    phaseData.survey1_completed = true;
    phaseData.survey1_date = format(d);
    phaseData.survey2_completed = true;
    phaseData.survey3_completed = true;
    phaseData.survey4_completed = true;
  }

  saveUserPhaseData(userId, phaseData);
  showToast(`被験者「${userId}」のステータスを更新しました。`);
  await updateAdminView();
}

// 被験者のパスワード編集モーダルを開く
function openEditPasswordModal(userId) {
  document.getElementById('edit-target-user-id').value = userId;
  document.getElementById('edit-user-id-display').innerText = userId;
  document.getElementById('new-pw-input').value = '';
  document.getElementById('admin-edit-pw-card').classList.remove('hidden');
  document.getElementById('admin-edit-pw-card').scrollIntoView({ behavior: 'smooth' });
}

// 被験者の個別削除関数
async function deleteParticipantUser(userId) {
  if (!confirm(`被験者「${userId}」のアカウントおよび全ての記録データを削除します。本当によろしいですか？`)) {
    return;
  }

  if (supabase) {
    try {
      await supabase.from('users').delete().eq('id', userId);
      await supabase.from('records').delete().eq('user_id', userId);
      await supabase.from('user_phases').delete().eq('user_id', userId);
    } catch (err) {
      console.error('Supabase削除エラー:', err);
      showToast('データベースからの削除に失敗しました。');
      return;
    }
  }

  delete state.users[userId];
  delete state.records[userId];
  delete state.drafts[userId];
  localStorage.removeItem(`tgt_phase_${userId}`);
  saveToLocalStorage();

  showToast(`被験者「${userId}」を削除しました。`);
  await updateAdminView();
}

// 被験者パスワード更新関数
async function updateUserPassword(userId, newPassword) {
  if (!userId || !newPassword) return;

  if (supabase) {
    try {
      const { error } = await supabase
        .from('users')
        .update({ password: newPassword })
        .eq('id', userId);

      if (error) {
        showToast('パスワード更新に失敗しました。');
        console.error(error);
        return;
      }
    } catch (err) {
      console.error(err);
      showToast('データベースエラーが発生しました。');
      return;
    }
  }

  if (state.users[userId]) {
    state.users[userId].password = newPassword;
    saveToLocalStorage();
  }

  showToast(`被験者「${userId}」のパスワードを更新しました。`);
  document.getElementById('admin-edit-pw-card').classList.add('hidden');
  await updateAdminView();
}

// 被験者別の詳細記録タイムラインを表示する
async function showAdminUserDetail(userId) {
  let userRecords = [];
  if (supabase) {
    const { data: recs } = await supabase.from('records').select('*').eq('user_id', userId);
    userRecords = recs || [];
  } else {
    userRecords = state.records[userId] || [];
  }

  document.getElementById('detail-user-id').innerText = userId;
  const container = document.getElementById('detail-timeline-content');
  container.innerHTML = '';

  if (userRecords.length === 0) {
    container.innerHTML = '<p class="text-center" style="color:var(--color-text-hint); padding: 20px;">記録履歴がありません。</p>';
  } else {
    const sortedRecords = [...userRecords].sort((a, b) => b.timestamp - a.timestamp);

    sortedRecords.forEach(rec => {
      const recDate = new Date(Number(rec.timestamp)).toLocaleDateString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
      });
      const recTime = new Date(Number(rec.timestamp)).toLocaleTimeString('ja-JP', {
        hour: '2-digit', minute: '2-digit'
      });

      const moodEmojis = ['', '😢 しんどい', '🙁 しんどい', '😐 ふつう', '🙂 まあまあいい', '😊 とてもいい'];
      const moodText = moodEmojis[rec.mood] || 'ふつう';

      const item = document.createElement('div');
      item.className = 'timeline-item';

      let goodsHtml = '';
      if (rec.tgt1) goodsHtml += `<div class="timeline-good">${rec.tgt1}</div>`;
      if (rec.tgt2) goodsHtml += `<div class="timeline-good">${rec.tgt2}</div>`;
      if (rec.tgt3) goodsHtml += `<div class="timeline-good">${rec.tgt3}</div>`;

      let memoHtml = '';
      if (rec.memo) {
        memoHtml = `<div class="timeline-memo"><strong>ひとこと:</strong> ${rec.memo}</div>`;
      }

      item.innerHTML = `
        <div class="timeline-date">
          📅 ${recDate} ${recTime} 
          <span class="timeline-mood">｜ 気分: ${moodText}</span>
        </div>
        <div class="timeline-goods">
          ${goodsHtml}
        </div>
        ${memoHtml}
      `;
      container.appendChild(item);
    });
  }

  document.getElementById('admin-user-detail-card').classList.remove('hidden');
  document.getElementById('admin-user-detail-card').scrollIntoView({ behavior: 'smooth' });
}

// --- 下書き機能 ---

let draftTimeout = null;

// 下書きの自動保存（常に被験者の手元のブラウザのlocalStorageにローカル保存）
function triggerDraftSave() {
  const userId = state.currentUser;
  if (!userId || state.isAdmin) return;

  const draftStatus = document.getElementById('draft-status');
  const draftText = document.getElementById('draft-text');
  draftStatus.classList.add('show');
  draftText.innerText = '下書きを保存しています...';

  if (draftTimeout) clearTimeout(draftTimeout);

  draftTimeout = setTimeout(() => {
    const tgt1 = document.getElementById('tgt-1').value;
    const tgt2 = document.getElementById('tgt-2').value;
    const tgt3 = document.getElementById('tgt-3').value;
    const memo = document.getElementById('tgt-memo').value;

    const selectedMoodRadio = document.querySelector('input[name="mood"]:checked');
    const mood = selectedMoodRadio ? parseInt(selectedMoodRadio.value) : 3;

    state.drafts[userId] = { tgt1, tgt2, tgt3, memo, mood };
    saveToLocalStorage();

    draftText.innerText = '下書きが自動保存されました';

    setTimeout(() => {
      draftStatus.classList.remove('show');
    }, 2000);
  }, 1000);
}

// 下書きの復元
function restoreDraft(userId) {
  const draft = state.drafts[userId];
  if (draft) {
    document.getElementById('tgt-1').value = draft.tgt1 || '';
    document.getElementById('tgt-2').value = draft.tgt2 || '';
    document.getElementById('tgt-3').value = draft.tgt3 || '';
    document.getElementById('tgt-memo').value = draft.memo || '';

    const radio = document.getElementById(`mood-${draft.mood}`);
    if (radio) radio.checked = true;
  } else {
    document.getElementById('tgt-1').value = '';
    document.getElementById('tgt-2').value = '';
    document.getElementById('tgt-3').value = '';
    document.getElementById('tgt-memo').value = '';
    document.getElementById('mood-3').checked = true;
  }
}

// 下書きの削除
function clearDraft(userId) {
  delete state.drafts[userId];
  saveToLocalStorage();
}

// --- CSVダウンロード機能 ---

async function downloadDataAsCSV() {
  let userList = [];
  let allRecords = [];

  if (supabase) {
    const { data: usersData } = await supabase.from('users').select('*');
    const { data: recsData } = await supabase.from('records').select('*');
    userList = usersData || [];
    allRecords = recsData || [];
  } else {
    userList = Object.keys(state.users).map(id => ({
      id,
      signup_date: state.users[id].signupDate
    }));
    Object.keys(state.records).forEach(id => {
      allRecords.push(...state.records[id]);
    });
  }

  if (userList.length === 0) {
    showToast('データがありません。');
    return;
  }

  let csvContent = "被験者ID,登録日,記録日,記録日時,よかったこと1,よかったこと2,よかったこと3,ひとことメモ,気分(1-5)\r\n";

  userList.forEach(user => {
    const userId = user.id;
    const signupDate = user.signup_date;
    const userRecs = allRecords.filter(r => r.user_id === userId || (r.user_id === undefined && state.records[userId]?.some(lr => lr.date === r.date)));

    // ローカル保存モードの場合のフォールバック
    const actualRecs = supabase ? userRecs : state.records[userId] || [];

    if (actualRecs.length === 0) {
      csvContent += `"${userId}","${signupDate}","","","","","","",""\r\n`;
    } else {
      actualRecs.forEach(rec => {
        const dateStr = rec.date;
        const timeStr = new Date(Number(rec.timestamp)).toISOString();

        const cleanTgt1 = (rec.tgt1 || '').replace(/"/g, '""');
        const cleanTgt2 = (rec.tgt2 || '').replace(/"/g, '""');
        const cleanTgt3 = (rec.tgt3 || '').replace(/"/g, '""');
        const cleanMemo = (rec.memo || '').replace(/"/g, '""');

        csvContent += `"${userId}","${signupDate}","${dateStr}","${timeStr}","${cleanTgt1}","${cleanTgt2}","${cleanTgt3}","${cleanMemo}",${rec.mood}\r\n`;
      });
    }
  });

  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `tgt_research_data_${getTodayString()}.csv`);
  document.body.appendChild(link);

  link.click();
  document.body.removeChild(link);
  showToast('CSVデータをダウンロードしました。');
}

// --- 通知機能の実装 ---

function updateNotificationStatus(permission) {
  const statusEl = document.getElementById('notification-status');
  const btn = document.getElementById('enable-notification-btn');
  if (!statusEl || !btn) return;

  const currentPermission = permission || (('Notification' in window) ? Notification.permission : 'unsupported');

  if (currentPermission === 'granted') {
    statusEl.innerHTML = '🟢 通知は有効です。毎日20:00に届きます。';
    btn.innerText = '通知設定済み (有効)';
    btn.disabled = true;
  } else if (currentPermission === 'denied') {
    statusEl.innerHTML = '🔴 通知が拒否されています。ブラウザ設定で許可してください。';
    btn.innerText = '通知がブロックされています';
    btn.disabled = true;
  } else {
    statusEl.innerHTML = '⚠️ 通知未設定。上のボタンから許可してください。';
    btn.innerText = '通知を許可する';
    btn.disabled = false;
  }
}

// --- 初期セットアップ & イベントハンドラ登録 ---

document.addEventListener('DOMContentLoaded', async () => {
  // デモ用の初期化（A001：1日目のデモ被験者, A002：2日目のデモ被験者）
  const demoUsers = JSON.parse(localStorage.getItem('tgt_users')) || {};
  const now = new Date();
  const format = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const todayStr = format(now);
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = format(yesterday);

  // 常にデモデータとして登録日を今日・昨日に固定（古いキャッシュによる日数ズレを防ぐため）
  demoUsers['A001'] = { password: 'pass123', signupDate: todayStr };
  demoUsers['A002'] = { password: 'pass123', signupDate: yesterdayStr };
  localStorage.setItem('tgt_users', JSON.stringify(demoUsers));

  const demoRecords = JSON.parse(localStorage.getItem('tgt_records')) || {};
  demoRecords['A001'] = []; // A001は新規アカウントのため記録なし
  demoRecords['A002'] = [
    {
      date: yesterdayStr,
      timestamp: Date.now() - 24 * 60 * 60 * 1000,
      tgt1: '昨日は美味しいお茶が飲めた',
      tgt2: '仕事が順調に終わった',
      tgt3: '',
      memo: 'いいスタート！',
      mood: 4
    }
  ];
  localStorage.setItem('tgt_records', JSON.stringify(demoRecords));

  loadFromLocalStorage();

  const urlParams = new URLSearchParams(window.location.search);
  const actionParam = urlParams.get('action');

  updateNotificationStatus();

  const savedTime = localStorage.getItem('tgt_notify_time');
  if (savedTime) {
    document.getElementById('notification-time').value = savedTime;
  }

  if (state.currentUser) {
    if (state.isAdmin) {
      showView('admin-view');
      await updateAdminView();
    } else {
      showView('record-view');
      await updateRecordView();
    }
  } else if (actionParam === 'record') {
    showToast('記録を入力するには、まずログインしてください。');
    showView('login-view');
  }

  // --- イベントリスナー ---

  // ログインフォーム送信 (非同期処理に書き換え)
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userIdInput = document.getElementById('login-id').value.trim();
    const passwordInput = document.getElementById('login-pw').value;

    if (!userIdInput || !passwordInput) return;

    if (userIdInput === 'admin') {
      if (passwordInput === 'admin123') {
        state.currentUser = 'admin';
        state.isAdmin = true;
        localStorage.setItem('tgt_current_user', JSON.stringify({ userId: 'admin', isAdmin: true }));
        showToast('管理者としてログインしました。');
        showView('admin-view');
        await updateAdminView();
      } else {
        showToast('管理者のパスワードが間違っています。');
      }
      return;
    }

    if (supabase) {
      // Supabaseを使用したログインフロー
      try {
        const { data: user, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', userIdInput)
          .single();

        if (error && error.code === 'PGRST116') {
          showToast('被験者IDまたはパスワードが正しくありません。');
          return;
        } else if (user) {
          if (user.password !== passwordInput) {
            showToast('被験者IDまたはパスワードが正しくありません。');
            return;
          }
          showToast('ログインしました。');
        } else {
          showToast('ログイン処理中にエラーが発生しました。');
          return;
        }
      } catch (err) {
        showToast('データベース接続エラーが発生しました。');
        console.error(err);
        return;
      }
    } else {
      // 従来のローカルログインフロー
      const existingUser = state.users[userIdInput];
      if (!existingUser) {
        showToast('被験者IDまたはパスワードが正しくありません。');
        return;
      }
      if (existingUser.password !== passwordInput) {
        showToast('被験者IDまたはパスワードが正しくありません。');
        return;
      }
      showToast('ログインしました。');
    }

    state.currentUser = userIdInput;
    state.isAdmin = false;
    localStorage.setItem('tgt_current_user', JSON.stringify({ userId: userIdInput, isAdmin: false }));

    showView('record-view');
    await updateRecordView();
  });

  // ログアウトボタン
  document.getElementById('logout-btn').addEventListener('click', () => {
    state.currentUser = null;
    state.isAdmin = false;
    localStorage.removeItem('tgt_current_user');
    showToast('ログアウトしました。');
    showView('login-view');
    document.getElementById('login-id').value = '';
    document.getElementById('login-pw').value = '';
  });

  // アコーディオン開閉
  document.getElementById('progress-toggle').addEventListener('click', () => {
    document.getElementById('progress-list').classList.toggle('collapsed');
  });

  document.getElementById('notification-toggle').addEventListener('click', () => {
    document.getElementById('notification-settings').classList.toggle('collapsed');
  });

  // 下書き自動保存
  const inputElements = ['tgt-1', 'tgt-2', 'tgt-3', 'tgt-memo'];
  inputElements.forEach(id => {
    document.getElementById(id).addEventListener('input', triggerDraftSave);
  });

  document.querySelectorAll('input[name="mood"]').forEach(radio => {
    radio.addEventListener('change', triggerDraftSave);
  });

  // 記録の保存・上書き更新 (非同期処理に書き換え)
  document.getElementById('record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = state.currentUser;
    if (!userId) return;

    const tgt1 = document.getElementById('tgt-1').value.trim();
    const tgt2 = document.getElementById('tgt-2').value.trim();
    const tgt3 = document.getElementById('tgt-3').value.trim();
    const memo = document.getElementById('tgt-memo').value.trim();
    const mood = parseInt(document.querySelector('input[name="mood"]:checked').value);

    if (!tgt1) {
      showToast('よかったこと1は入力必須です。');
      return;
    }

    const todayStr = getTodayString();
    const timestampVal = Date.now();

    if (supabase) {
      // Supabaseへの保存 (upsert)
      try {
        const { error } = await supabase
          .from('records')
          .upsert([{
            user_id: userId,
            date: todayStr,
            timestamp: timestampVal,
            tgt1,
            tgt2,
            tgt3,
            memo,
            mood
          }], { onConflict: 'user_id,date' });

        if (error) {
          showToast('データベースへの保存に失敗しました。');
          console.error(error);
          return;
        }
        showToast('今日の記録をクラウドに保存しました。');
      } catch (err) {
        showToast('データベース接続エラーが発生しました。');
        console.error(err);
        return;
      }
    } else {
      // 従来のローカル保存
      if (!state.records[userId]) {
        state.records[userId] = [];
      }

      const existingIndex = state.records[userId].findIndex(r => r.date === todayStr);
      const newRecord = {
        date: todayStr,
        timestamp: timestampVal,
        tgt1,
        tgt2,
        tgt3,
        memo,
        mood
      };

      if (existingIndex >= 0) {
        state.records[userId][existingIndex] = newRecord;
        showToast('今日の記録を更新しました。');
      } else {
        state.records[userId].push(newRecord);
        showToast('今日の記録を保存しました。');
      }
      saveToLocalStorage();
    }

    clearDraft(userId);

    showView('complete-view');
    await updateCompleteView();
  });

  // 完了画面から「今日の記録画面へ」戻るボタン
  document.getElementById('complete-back-btn').addEventListener('click', async () => {
    showView('record-view');
    await updateRecordView();
  });

  // 完了画面からログアウトしてログイン画面に戻るボタン
  document.getElementById('complete-done-btn').addEventListener('click', () => {
    state.currentUser = null;
    state.isAdmin = false;
    localStorage.removeItem('tgt_current_user');
    showView('login-view');
    document.getElementById('login-id').value = '';
    document.getElementById('login-pw').value = '';
  });

  // 通知許可
  document.getElementById('enable-notification-btn').addEventListener('click', () => {
    requestNotificationPermission();
  });

  // 通知テスト
  document.getElementById('test-notification-btn').addEventListener('click', () => {
    showToast('5秒後にテスト通知を送信します。');
    setTimeout(() => {
      sendLocalNotification(
        '【テスト】今日の記録',
        'リマインダー通知のテストです。今日の良かったことを振り返りましょう！🍁'
      );
    }, 5000);
  });

  // 通知時間保存
  document.getElementById('save-time-btn').addEventListener('click', () => {
    const timeVal = document.getElementById('notification-time').value;
    localStorage.setItem('tgt_notification_time', timeVal);
    showToast(`通知時間を ${timeVal} に設定しました。`);
  });

  // 管理者ダッシュボードログアウト
  document.getElementById('admin-logout-btn').addEventListener('click', () => {
    state.currentUser = null;
    state.isAdmin = false;
    localStorage.removeItem('tgt_current_user');
    showToast('管理者からログアウトしました。');
    showView('login-view');
  });

  // CSVダウンロード
  document.getElementById('csv-download-btn').addEventListener('click', async () => {
    await downloadDataAsCSV();
  });

  // 詳細を閉じる
  document.getElementById('close-detail-btn').addEventListener('click', () => {
    document.getElementById('admin-user-detail-card').classList.add('hidden');
  });

  // 被験者アカウント作成フォーム送信
  document.getElementById('admin-create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newUserId = document.getElementById('new-user-id').value.trim();
    const newPassword = document.getElementById('new-user-pw').value.trim();

    if (!newUserId || !newPassword) return;

    if (newUserId.toLowerCase() === 'admin') {
      showToast('「admin」は使用できないIDです。');
      return;
    }

    const todayStr = getTodayString();

    if (supabase) {
      try {
        const { data: existingUser, error: checkError } = await supabase
          .from('users')
          .select('id')
          .eq('id', newUserId)
          .maybeSingle();

        if (checkError) {
          showToast('データベース確認エラーが発生しました。');
          console.error(checkError);
          return;
        }

        if (existingUser) {
          showToast(`被験者ID「${newUserId}」はすでに登録されています。`);
          return;
        }

        const { error: insertError } = await supabase
          .from('users')
          .insert([{ id: newUserId, password: newPassword, signup_date: todayStr }]);

        if (insertError) {
          showToast('被験者アカウントの登録に失敗しました。');
          console.error(insertError);
          return;
        }

        showToast(`被験者ID「${newUserId}」を作成しました。`);
      } catch (err) {
        showToast('データベース接続エラーが発生しました。');
        console.error(err);
        return;
      }
    } else {
      if (state.users[newUserId]) {
        showToast(`被験者ID「${newUserId}」はすでに登録されています。`);
        return;
      }

      state.users[newUserId] = {
        password: newPassword,
        signupDate: todayStr
      };
      if (!state.records[newUserId]) {
        state.records[newUserId] = [];
      }
      saveToLocalStorage();
      showToast(`被験者ID「${newUserId}」を作成しました。`);
    }

    document.getElementById('new-user-id').value = '';
    document.getElementById('new-user-pw').value = '';

    await updateAdminView();
  });

  // 全データ初期化 (Supabaseが有効な場合はクラウドのデータも論理・物理リセット)
  document.getElementById('reset-data-btn').addEventListener('click', async () => {
    if (confirm('【警告】すべての被験者データ、記録、下書きが完全に消去されます。本当によろしいですか？')) {
      if (supabase) {
        try {
          // cascade設定により、usersテーブルをクリアすればrecordsも自動削除されます
          const { error: userError } = await supabase.from('users').delete().neq('id', 'admin');
          if (userError) {
            showToast('データベースのリセットに失敗しました。');
            console.error(userError);
            return;
          }
        } catch (err) {
          showToast('データベース接続エラーが発生しました。');
          console.error(err);
          return;
        }
      }

      localStorage.removeItem('tgt_users');
      localStorage.removeItem('tgt_records');
      localStorage.removeItem('tgt_drafts');
      localStorage.removeItem('tgt_current_user');

      state.users = {};
      state.records = {};
      state.drafts = {};
      state.currentUser = null;
      state.isAdmin = false;

      showToast('すべてのデータを初期化しました。');
      showView('login-view');
    }
  });

  // 初回アンケート①完了ボタン
  const survey1Btn = document.getElementById('survey1-complete-btn');
  if (survey1Btn) {
    survey1Btn.addEventListener('click', async () => {
      const userId = state.currentUser;
      if (!userId) return;

      const phaseData = await getUserPhaseData(userId);
      phaseData.survey1_completed = true;
      phaseData.survey1_date = getTodayString();
      await saveUserPhaseData(userId, phaseData);

      showToast('初回アンケート①の回答を記録しました！');
      await updateRecordView();
    });
  }

  // 介入開始時アンケート②完了ボタン
  const survey2Btn = document.getElementById('survey2-complete-btn');
  if (survey2Btn) {
    survey2Btn.addEventListener('click', async () => {
      const userId = state.currentUser;
      if (!userId) return;

      const phaseData = await getUserPhaseData(userId);
      phaseData.survey2_completed = true;
      await saveUserPhaseData(userId, phaseData);

      showToast('介入開始時アンケート②の回答を完了しました！');
      await updateRecordView();
    });
  }

  // 事後アンケート④完了ボタン
  const survey4Btn = document.getElementById('survey4-complete-btn') || document.getElementById('survey3-complete-btn');
  if (survey4Btn) {
    survey4Btn.addEventListener('click', async () => {
      const userId = state.currentUser;
      if (!userId) return;

      const phaseData = await getUserPhaseData(userId);
      phaseData.survey4_completed = true;
      phaseData.survey3_completed = true;
      await saveUserPhaseData(userId, phaseData);

      showToast('事後アンケート④の回答を完了しました！お疲れ様でした。');
      await updateCompleteView();
    });
  }

  // 待機画面からのログアウト
  const logoutWaitingBtn = document.getElementById('logout-btn-waiting');
  if (logoutWaitingBtn) {
    logoutWaitingBtn.addEventListener('click', () => {
      state.currentUser = null;
      state.isAdmin = false;
      localStorage.removeItem('tgt_current_user');
      showToast('ログアウトしました。');
      showView('login-view');
    });
  }

  // 管理者画面の Google フォーム URL 保存
  const adminUrlsForm = document.getElementById('admin-urls-form');
  if (adminUrlsForm) {
    const url1Input = document.getElementById('url-survey-1');
    const url2Input = document.getElementById('url-survey-2');
    const url3Input = document.getElementById('url-survey-3');
    const url4Input = document.getElementById('url-survey-4');
    if (url1Input) url1Input.value = surveyUrls.survey1;
    if (url2Input) url2Input.value = surveyUrls.survey2;
    if (url3Input) url3Input.value = surveyUrls.survey3;
    if (url4Input) url4Input.value = surveyUrls.survey4;

    adminUrlsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      surveyUrls.survey1 = (document.getElementById('url-survey-1')?.value || '').trim();
      surveyUrls.survey2 = (document.getElementById('url-survey-2')?.value || '').trim();
      surveyUrls.survey3 = (document.getElementById('url-survey-3')?.value || '').trim();
      surveyUrls.survey4 = (document.getElementById('url-survey-4')?.value || '').trim();
      localStorage.setItem('tgt_survey_urls', JSON.stringify(surveyUrls));
      localStorage.setItem('tgt_survey1_url', surveyUrls.survey1);
      localStorage.setItem('tgt_survey2_url', surveyUrls.survey2);
      localStorage.setItem('tgt_survey3_url', surveyUrls.survey3);
      localStorage.setItem('tgt_survey4_url', surveyUrls.survey4);
      showToast('アンケートURLを保存しました。');
    });
  }

  // パスワード変更フォーム送信
  const editPwForm = document.getElementById('admin-edit-pw-form');
  if (editPwForm) {
    editPwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUserId = document.getElementById('edit-target-user-id').value;
      const newPassword = document.getElementById('new-pw-input').value.trim();
      await updateUserPassword(targetUserId, newPassword);
    });
  }

  const closeEditPwBtn = document.getElementById('close-edit-pw-btn');
  if (closeEditPwBtn) {
    closeEditPwBtn.addEventListener('click', () => {
      document.getElementById('admin-edit-pw-card').classList.add('hidden');
    });
  }

  // 通知設定イベント
  const notifToggle = document.getElementById('notification-toggle');
  if (notifToggle) {
    notifToggle.addEventListener('click', () => {
      const content = document.getElementById('notification-settings');
      if (content) content.classList.toggle('collapsed');
    });
  }

  const enableNotifBtn = document.getElementById('enable-notification-btn');
  if (enableNotifBtn) {
    enableNotifBtn.addEventListener('click', async () => {
      await requestNotificationPermission();
    });
  }

  const testNotifBtn = document.getElementById('test-notification-btn');
  if (testNotifBtn) {
    testNotifBtn.addEventListener('click', () => {
      sendTestNotification();
    });
  }

  const saveTimeBtn = document.getElementById('save-time-btn');
  if (saveTimeBtn) {
    saveTimeBtn.addEventListener('click', () => {
      const timeVal = document.getElementById('notification-time').value || '20:00';
      localStorage.setItem('tgt_notify_time', timeVal);
      showToast(`通知時間を ${timeVal} に設定しました。`);
    });
  }

  updateNotificationStatusUI();

  // 被験者画面用 テストフェーズ切り替えハンドラ
  const handleUserSidePhaseChange = async (e) => {
    const phaseVal = e.target.value;
    if (!phaseVal) return;
    const userId = state.currentUser || 'A001';
    await simulateUserPhase(userId, phaseVal);

    if (phaseVal === 'complete') {
      showView('complete-view');
      await updateCompleteView();
    } else {
      showView('record-view');
      await updateRecordView();
    }
    e.target.value = '';
  };

  const userSideSelect = document.getElementById('user-side-phase-select');
  if (userSideSelect) {
    userSideSelect.addEventListener('change', handleUserSidePhaseChange);
  }

  const userSideSelectComplete = document.getElementById('user-side-phase-select-complete');
  if (userSideSelectComplete) {
    userSideSelectComplete.addEventListener('change', handleUserSidePhaseChange);
  }

  // 1分毎の未記録通知チェックタイマー
  setInterval(checkDaily20OclockNotification, 60000);
  checkDaily20OclockNotification();

});

// Web Notification パーミッション要求
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('お使いのブラウザは通知に対応していません。');
    updateNotificationStatusUI();
    return false;
  }
  const permission = await Notification.requestPermission();
  updateNotificationStatusUI();
  if (permission === 'granted') {
    showToast('リマインド通知を許可しました！');
    return true;
  } else {
    showToast('通知が拒否されました。ブラウザの設定で許可してください。');
    return false;
  }
}

// 通知設定の表示UI更新ヘルパー
function updateNotificationStatusUI() {
  const statusEl = document.getElementById('notification-status');

  let msg = '※ 通知を有効にするには、ブラウザの通知許可が必要です。';
  if (!('Notification' in window)) {
    msg = '⚠️ お使いのブラウザは通知機能に対応していません。';
  } else if (Notification.permission === 'granted') {
    msg = '✅ 通知が許可されています。';
  } else if (Notification.permission === 'denied') {
    msg = '⚠️ 通知が拒否されています。ブラウザ設定を確認してください。';
  }

  if (statusEl) statusEl.innerText = msg;

  const savedTime = localStorage.getItem('tgt_notify_time') || '20:00';
  const timeInputMain = document.getElementById('notification-time');
  if (timeInputMain) timeInputMain.value = savedTime;
}

// テスト通知送信
function sendTestNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    showToast('先に「通知を許可する」を押してください。');
    return;
  }
  new Notification('「今日はどんな1日でしたか？」', {
    body: '1日を振り返って、良かった3つの出来事を記録してみましょう。'
  });
  showToast('テスト通知を送信しました！');
}

// 20時リマインド通知の自動送信チェック
async function checkDaily20OclockNotification() {
  const userId = state.currentUser;
  if (!userId || state.isAdmin) return;

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();
  const savedTime = localStorage.getItem('tgt_notify_time') || '20:00';
  const [targetHour, targetMin] = savedTime.split(':').map(Number);
  
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();

  // 設定時間（デフォルト20:00）以降かチェック
  if (currentHour > targetHour || (currentHour === targetHour && currentMin >= targetMin)) {
    const todayStr = getTodayString();
    const alreadyNotified = localStorage.getItem(`tgt_notified_${userId}_${todayStr}`);

    if (!alreadyNotified) {
      const phaseInfo = await getParticipantPhase(userId);
      // TGT介入期間中のみ通知
      if (phaseInfo.phase === 'tgt') {
        const progress = await getParticipantProgress(userId);
        const hasTodayRecord = progress.userRecords.some(r => r.date === todayStr);

        // 本日の入力がまだないときだけ通知送信
        if (!hasTodayRecord) {
          new Notification('「今日はどんな1日でしたか？」', {
            body: '1日を振り返って、良かった3つの出来事を記録してみましょう。',
            tag: 'tgt-daily-reminder'
          });
          localStorage.setItem(`tgt_notified_${userId}_${todayStr}`, 'true');
        }
      }
    }
  }
}
