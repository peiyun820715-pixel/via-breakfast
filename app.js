(() => {
  'use strict';

  const STORAGE_KEY = 'via-breakfast-advisor-v1';
  const categoryLabels = { protein: '蛋白質', fruit: '水果', vegetable: '蔬菜', main: '主食／全穀', processed: '加工食品', other: '其他' };
  const fallbackNutrition = {
    protein: { calories: 120, protein: 12, carbs: 4, fat: 6, fiber: 0 },
    fruit: { calories: 80, protein: 1, carbs: 20, fat: 0, fiber: 3 },
    vegetable: { calories: 35, protein: 2, carbs: 6, fat: 0, fiber: 3 },
    main: { calories: 180, protein: 5, carbs: 34, fat: 3, fiber: 4 },
    processed: { calories: 170, protein: 4, carbs: 22, fat: 8, fiber: 2 },
    other: { calories: 90, protein: 2, carbs: 8, fat: 5, fiber: 2 }
  };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cleanList = (value) => value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));

  const defaultState = () => ({
    profile: { healthGoal: '', allergies: [], restrictions: [], dislikedFoods: [] },
    inventory: [], recommendations: [], history: [], foodPreferences: {}
  });

  let state = load();
  let activePhoto = '';

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return stored ? { ...defaultState(), ...stored, profile: { ...defaultState().profile, ...stored.profile } } : defaultState();
    } catch { return defaultState(); }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function toast(message) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function formatNumber(value) { return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 1 }); }
  function isExpired(item) { return item.expiry && item.expiry < today(); }
  function isExpiring(item) {
    if (!item.expiry || isExpired(item)) return false;
    const days = (new Date(`${item.expiry}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000;
    return days <= 3;
  }
  function nutritionOf(item) {
    const raw = item.nutrition || {};
    const values = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
    const missing = values.some((key) => raw[key] === '' || raw[key] === null || raw[key] === undefined || Number.isNaN(Number(raw[key])));
    return { ...fallbackNutrition[item.category] || fallbackNutrition.other, ...Object.fromEntries(values.map((key) => [key, raw[key] === '' || raw[key] === null || raw[key] === undefined ? (fallbackNutrition[item.category] || fallbackNutrition.other)[key] : number(raw[key])])), estimated: missing };
  }
  function totalNutrition(foods) {
    return foods.reduce((total, entry) => {
      const nutrients = entry.nutrition;
      ['calories', 'protein', 'carbs', 'fat', 'fiber'].forEach((key) => { total[key] += nutrients[key] * entry.quantity; });
      total.estimated ||= nutrients.estimated;
      return total;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, estimated: false });
  }
  function rulesFor(foods, total) {
    const categories = foods.reduce((items, food) => { items[food.category] = (items[food.category] || 0) + 1; return items; }, {});
    return [
      { label: `蛋白質 ${formatNumber(total.protein)}g／至少 20g`, pass: total.protein >= 20 },
      { label: `水果 ${categories.fruit || 0} 種／至少 1 份`, pass: Boolean(categories.fruit) },
      { label: `蔬菜 ${categories.vegetable || 0} 種／至少 1 份`, pass: Boolean(categories.vegetable) },
      { label: `主食／全穀 ${categories.main || 0} 種／至少 1 份`, pass: Boolean(categories.main) },
      { label: `加工食品 ${categories.processed || 0} 種／最多 1 種`, pass: (categories.processed || 0) <= 1 },
      { label: `熱量 ${formatNumber(total.calories)} kcal／550–650 kcal`, pass: total.calories >= 550 && total.calories <= 650 },
      { label: '食品安全：僅納入保存狀態良好且未過期食材', pass: true }
    ];
  }
  function eligibleItems() {
    const blocked = [...state.profile.allergies, ...state.profile.dislikedFoods].map((item) => item.toLowerCase());
    return state.inventory.filter((item) => number(item.quantity) > 0 && item.safety === 'good' && !isExpired(item) && !blocked.includes(item.name.toLowerCase()));
  }
  function preferenceScore(item) {
    const pref = state.foodPreferences[item.name];
    const acceptance = pref && pref.offered ? pref.accepted / pref.offered : .55;
    return acceptance * 30 + (isExpiring(item) ? 22 : 0) + Math.min(number(item.quantity), 8);
  }
  function createRecommendation(request = '', date = today()) {
    const items = eligibleItems();
    if (!state.profile.healthGoal) return { error: '請先在「個人設定」選擇健康目標。' };
    if (!items.length) return { error: '目前沒有可安全使用的庫存食材。請新增食材，並確認保存狀態。' };
    const desired = request.trim().toLowerCase();
    const selected = [];
    const choose = (candidates) => {
      const unused = candidates.filter((item) => !selected.some((entry) => entry.id === item.id));
      if (!unused.length) return null;
      const winner = unused.sort((a, b) => preferenceScore(b) - preferenceScore(a))[0];
      selected.push({ id: winner.id, name: winner.name, category: winner.category, unit: winner.unit, quantity: 1, nutrition: nutritionOf(winner) });
      return winner;
    };
    if (desired) {
      const wanted = items.filter((item) => item.name.toLowerCase().includes(desired) || desired.includes(item.name.toLowerCase()));
      if (wanted.length) choose(wanted);
    }
    ['protein', 'fruit', 'vegetable', 'main'].forEach((category) => choose(items.filter((item) => item.category === category)));
    if (!selected.length) choose(items);

    // Fill with a second available portion while still prioritising an in-range energy total.
    let total = totalNutrition(selected);
    for (let index = 0; index < 5 && total.calories < 550; index += 1) {
      const candidates = items.filter((item) => {
        const current = selected.find((entry) => entry.id === item.id);
        return !current || current.quantity < number(item.quantity);
      }).sort((a, b) => {
        const aGap = Math.abs(600 - (total.calories + nutritionOf(a).calories));
        const bGap = Math.abs(600 - (total.calories + nutritionOf(b).calories));
        return aGap - bGap || preferenceScore(b) - preferenceScore(a);
      });
      const choice = candidates[0];
      if (!choice) break;
      const entry = selected.find((food) => food.id === choice.id);
      if (entry) entry.quantity += 1;
      else selected.push({ id: choice.id, name: choice.name, category: choice.category, unit: choice.unit, quantity: 1, nutrition: nutritionOf(choice) });
      total = totalNutrition(selected);
    }
    const rules = rulesFor(selected, total);
    return { id: uid(), date, request, foods: selected, total, rules, createdAt: new Date().toISOString(), completed: false };
  }

  function renderAll() {
    $('#today-label').textContent = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
    $('#recommend-date').value ||= today();
    $('#goal-summary').textContent = state.profile.healthGoal ? `目前目標：${state.profile.healthGoal}。系統會優先使用即期與你接受度較高的食材。` : '請先完成個人設定，讓推薦更貼近你的需求。';
    $('#inventory-count').textContent = state.inventory.length;
    renderInventory(); renderRecommendation(); renderFeedback(); renderHistory(); renderProfile();
  }
  function renderInventory() {
    const alerts = state.inventory.filter((item) => isExpired(item) || isExpiring(item) || item.safety !== 'good');
    $('#expiry-alerts').innerHTML = alerts.map((item) => {
      const bad = isExpired(item) || item.safety === 'unsafe';
      const text = isExpired(item) ? '已過期，請勿推薦食用' : item.safety !== 'good' ? '保存狀況待確認，不會納入推薦' : `即將於 ${item.expiry} 到期`;
      return `<div class="alert ${bad ? 'danger' : ''}"><b>${escapeHtml(item.name)}</b>：${text}</div>`;
    }).join('');
    const list = $('#inventory-list');
    if (!state.inventory.length) { list.innerHTML = '<div class="empty-state">尚無食材。從「新增食材」建立你的庫存。</div>'; return; }
    list.innerHTML = state.inventory.map((item) => `<article class="inventory-item">
      <div><h3>${escapeHtml(item.name)} <span class="category">${categoryLabels[item.category]}</span></h3><span class="inventory-meta">${item.expiry ? `到期：${item.expiry}` : '未設定到期日'} · 保存：${item.safety === 'good' ? '良好' : item.safety === 'check' ? '需確認' : '不適合食用'}</span></div>
      <strong>${formatNumber(item.quantity)} ${escapeHtml(item.unit)}</strong>
      <span class="inventory-meta">${item.nutrition?.calories !== '' && item.nutrition?.calories !== undefined ? `${formatNumber(item.nutrition.calories)} kcal／份` : '營養資料待補'}</span>
      <div class="item-actions"><button class="text-button" data-edit-food="${item.id}">編輯</button><button class="text-button danger" data-delete-food="${item.id}">刪除</button></div>
    </article>`).join('');
  }
  function latestRecommendation() { return [...state.recommendations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; }
  function renderRecommendation() {
    const recommendation = latestRecommendation();
    const empty = $('#recommendation-empty'); const result = $('#recommendation-result');
    if (!recommendation) { empty.classList.remove('hidden'); result.classList.add('hidden'); return; }
    empty.classList.add('hidden'); result.classList.remove('hidden');
    const complete = recommendation.rules.every((rule) => rule.pass);
    result.innerHTML = `<div class="panel"><div class="recommendation-top"><div><p class="eyebrow accent">${escapeHtml(recommendation.date)} 的建議</p><h3 class="recommendation-title">${recommendation.request ? `搭配「${escapeHtml(recommendation.request)}」的早餐` : '均衡早餐組合'}</h3><p class="muted">${recommendation.completed ? '已完成回饋並更新資料' : '確認實際攝取後，才會扣除庫存。'}</p></div><span class="score-label">${complete ? '規則完整' : '待補強'}</span></div>
      <div class="food-chips">${recommendation.foods.map((food) => `<span class="food-chip">${escapeHtml(food.name)} ×${formatNumber(food.quantity)} ${escapeHtml(food.unit)}</span>`).join('')}</div>
      <div class="result-grid"><section class="nutrition-card"><h3>營養分析</h3><div class="nutrition-values"><div><b>${formatNumber(recommendation.total.calories)}</b><small>kcal</small></div><div><b>${formatNumber(recommendation.total.protein)}g</b><small>蛋白質</small></div><div><b>${formatNumber(recommendation.total.carbs)}g</b><small>碳水</small></div><div><b>${formatNumber(recommendation.total.fat)}g</b><small>脂肪</small></div><div><b>${formatNumber(recommendation.total.fiber)}g</b><small>膳食纖維</small></div></div></section>
      <section class="rules-card"><h3>規則檢查</h3><ul class="rule-list">${recommendation.rules.map((rule) => `<li class="${rule.pass ? 'pass' : 'fail'}">${rule.pass ? '✓' : '!' } ${rule.label}</li>`).join('')}</ul></section></div>
      ${recommendation.total.estimated ? '<p class="notice">部分食材沒有完整營養標示，已以分類的通用估算值計算；建議補齊包裝數據。</p>' : ''}
      ${!complete ? '<p class="notice">現有庫存不足以完全符合全部規則。請補充缺少的分類食材或調整份量後再試。</p>' : ''}</div>`;
  }
  function renderFeedback() {
    const select = $('#feedback-recommendation');
    const previous = select.value;
    const options = [...state.recommendations].filter((item) => !item.completed).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    select.innerHTML = `<option value="">${options.length ? '請選擇一份推薦' : '尚無可回饋的推薦'}</option>${options.map((item) => `<option value="${item.id}">${item.date}｜${item.foods.map((food) => food.name).join('、')}</option>`).join('')}`;
    select.value = options.some((item) => item.id === previous) ? previous : (options[0]?.id || '');
    renderConsumedItems();
  }
  function renderConsumedItems() {
    const selected = state.recommendations.find((item) => item.id === $('#feedback-recommendation').value);
    const box = $('#consumed-items');
    if (!selected) { box.className = 'consumed-items empty-state'; box.innerHTML = '請先產生一份早餐推薦。'; return; }
    box.className = 'consumed-items';
    box.innerHTML = `<h3>實際吃了什麼？</h3>${selected.foods.map((food) => `<label class="consumed-row"><input type="checkbox" data-consumed-id="${food.id}" checked /><span>${escapeHtml(food.name)} <small class="muted">（推薦 ${formatNumber(food.quantity)} ${escapeHtml(food.unit)}）</small></span><input aria-label="${escapeHtml(food.name)}實際份量" type="number" min="0" max="${food.quantity}" step="0.1" value="${food.quantity}" data-consumed-quantity="${food.id}" /></label>`).join('')}`;
  }
  function renderHistory() {
    const history = state.history;
    const avg = (key) => history.length ? history.reduce((sum, item) => sum + number(item.total[key]), 0) / history.length : 0;
    const completion = history.length ? history.reduce((sum, item) => sum + item.completionRate, 0) / history.length : 0;
    $('#stats-grid').innerHTML = [
      [`${history.length}`, '已記錄早餐'], [`${formatNumber(completion * 100)}%`, '平均完成率'], [`${formatNumber(avg('calories'))}`, '平均熱量 kcal'], [`${formatNumber(avg('protein'))}g`, '平均蛋白質']
    ].map(([value, label]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join('');
    $('#history-list').innerHTML = history.length ? [...history].reverse().slice(0, 10).map((entry) => `<article class="history-item"><div><h4>${escapeHtml(entry.date)}｜${entry.actualFoods.map((food) => food.name).join('、') || '未記錄實際食用'}</h4><p>${entry.feedback.energy || '未填精神'} · ${entry.feedback.satiety || '未填飽足感'} · ${entry.feedback.digestion || '未填腸胃狀況'}${entry.feedback.note ? ` · ${escapeHtml(entry.feedback.note)}` : ''}</p></div><strong>${formatNumber(entry.total.calories)} kcal</strong></article>`).join('') : '<div class="empty-state">完成早餐回饋後，這裡會顯示你的趨勢。</div>';
  }
  function renderProfile() {
    $('#health-goal').value = state.profile.healthGoal;
    $('#allergies').value = state.profile.allergies.join('、'); $('#restrictions').value = state.profile.restrictions.join('、'); $('#disliked-foods').value = state.profile.dislikedFoods.join('、');
  }
  function openFoodDialog(item) {
    $('#inventory-form').reset(); $('#inventory-id').value = item?.id || ''; $('#inventory-dialog-title').textContent = item ? '編輯食材' : '新增食材';
    if (item) {
      $('#food-name').value = item.name; $('#food-category').value = item.category; $('#food-quantity').value = item.quantity; $('#food-unit').value = item.unit; $('#food-expiry').value = item.expiry || ''; $('#food-safety').value = item.safety;
      ['calories', 'protein', 'carbs', 'fat', 'fiber'].forEach((key) => $(`#food-${key}`).value = item.nutrition?.[key] ?? '');
    }
    $('#inventory-dialog').showModal();
  }
  function bindEvents() {
    $$('.tab').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
    $$('[data-tab-target]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tabTarget)));
    $('#open-inventory-dialog').addEventListener('click', () => openFoodDialog());
    $('#close-inventory-dialog').addEventListener('click', () => $('#inventory-dialog').close());
    $('#cancel-inventory').addEventListener('click', () => $('#inventory-dialog').close());
    $('#inventory-form').addEventListener('submit', saveFood);
    $('#inventory-list').addEventListener('click', inventoryAction);
    $('#recommend-form').addEventListener('submit', submitRecommendation);
    $('#feedback-recommendation').addEventListener('change', renderConsumedItems);
    $('#feedback-form').addEventListener('submit', submitFeedback);
    $('#feedback-photo').addEventListener('change', readPhoto);
    $('#profile-form').addEventListener('submit', saveProfile);
    $('#export-data').addEventListener('click', exportData);
    $('#import-data').addEventListener('change', importData);
  }
  function activateTab(id) { $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === id)); $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === id)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function saveFood(event) {
    event.preventDefault();
    const id = $('#inventory-id').value || uid();
    const food = { id, name: $('#food-name').value.trim(), category: $('#food-category').value, quantity: number($('#food-quantity').value), unit: $('#food-unit').value.trim(), expiry: $('#food-expiry').value, safety: $('#food-safety').value,
      nutrition: Object.fromEntries(['calories', 'protein', 'carbs', 'fat', 'fiber'].map((key) => [key, $(`#food-${key}`).value === '' ? '' : number($(`#food-${key}`).value)])) };
    const index = state.inventory.findIndex((item) => item.id === id); if (index >= 0) state.inventory[index] = food; else state.inventory.push(food);
    save(); $('#inventory-dialog').close(); renderAll(); toast('食材庫存已儲存。');
  }
  function inventoryAction(event) {
    const editId = event.target.dataset.editFood; const deleteId = event.target.dataset.deleteFood;
    if (editId) openFoodDialog(state.inventory.find((item) => item.id === editId));
    if (deleteId && confirm('確定要刪除這項食材嗎？')) { state.inventory = state.inventory.filter((item) => item.id !== deleteId); save(); renderAll(); toast('已刪除食材。'); }
  }
  function submitRecommendation(event) {
    event.preventDefault(); const recommendation = createRecommendation($('#requested-food').value, $('#recommend-date').value || today());
    if (recommendation.error) { toast(recommendation.error); if (!state.profile.healthGoal) activateTab('profile'); else activateTab('inventory'); return; }
    state.recommendations.push(recommendation); save(); renderAll(); toast('已產生新的早餐推薦。');
  }
  function readPhoto(event) { const file = event.target.files[0]; if (!file) { activePhoto = ''; return; } const reader = new FileReader(); reader.onload = () => { activePhoto = reader.result; }; reader.readAsDataURL(file); }
  function submitFeedback(event) {
    event.preventDefault(); const recommendation = state.recommendations.find((item) => item.id === $('#feedback-recommendation').value); if (!recommendation) { toast('請先選擇一份早餐推薦。'); return; }
    const actualFoods = recommendation.foods.flatMap((food) => {
      const checkbox = $(`[data-consumed-id="${food.id}"]`); const quantity = number($(`[data-consumed-quantity="${food.id}"]`).value);
      return checkbox?.checked && quantity > 0 ? [{ ...food, quantity: Math.min(quantity, food.quantity) }] : [];
    });
    actualFoods.forEach((food) => { const item = state.inventory.find((inventory) => inventory.id === food.id); if (item) item.quantity = Math.max(0, number(item.quantity) - food.quantity); });
    recommendation.foods.forEach((food) => { const pref = state.foodPreferences[food.name] || { offered: 0, accepted: 0 }; pref.offered += 1; if (actualFoods.some((actual) => actual.id === food.id)) pref.accepted += 1; state.foodPreferences[food.name] = pref; });
    const total = totalNutrition(actualFoods); const feedback = { satiety: $('#satiety').value, energy: $('#energy').value, digestion: $('#digestion').value, note: $('#feedback-note').value.trim(), photo: activePhoto };
    state.history.push({ id: uid(), date: recommendation.date, recommendationId: recommendation.id, actualFoods, total, completionRate: recommendation.foods.length ? actualFoods.length / recommendation.foods.length : 0, feedback, createdAt: new Date().toISOString() });
    recommendation.completed = true; save(); activePhoto = ''; $('#feedback-form').reset(); renderAll(); toast('已更新庫存、早餐紀錄與食材偏好。'); activateTab('history');
  }
  function saveProfile(event) { event.preventDefault(); state.profile = { healthGoal: $('#health-goal').value, allergies: cleanList($('#allergies').value), restrictions: cleanList($('#restrictions').value), dislikedFoods: cleanList($('#disliked-foods').value) }; save(); renderAll(); toast('個人設定已儲存。'); }
  function exportData() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `via-breakfast-backup-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); toast('資料已匯出。'); }
  function importData(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); if (!data || !Array.isArray(data.inventory)) throw new Error(); state = { ...defaultState(), ...data, profile: { ...defaultState().profile, ...data.profile } }; save(); renderAll(); toast('資料已匯入。'); } catch { toast('匯入失敗：請選擇 Via 匯出的 JSON 檔。'); } finally { event.target.value = ''; } }; reader.readAsText(file); }

  bindEvents(); renderAll();
})();
