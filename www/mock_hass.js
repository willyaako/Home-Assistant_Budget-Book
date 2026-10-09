// mock_hass.js — provides a full Home Assistant environment for local standalone preview
(function () {
  const STORAGE_KEY = 'budget_book_preview_data';

  function migrateData(data) {
    if (!data || !data.books) return data;
    for (const book of Object.values(data.books)) {
      if (!Array.isArray(book.categories)) book.categories = [];
      if (!Array.isArray(book.transactions)) book.transactions = [];
      if (!Array.isArray(book.recurring)) book.recurring = [];
      if (!book.budgets || typeof book.budgets !== 'object') book.budgets = {};
      for (const cat of book.categories) {
        if (!Array.isArray(cat.note_tags)) cat.note_tags = [];
      }
    }
    return data;
  }

  async function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.books && Object.keys(parsed.books).length > 0) {
          return migrateData(parsed);
        }
      } catch (e) {}
    }
    try {
      const resp = await fetch('sample_data.json');
      if (resp.ok) {
        const d = await resp.json();
        const migrated = migrateData(d);
        saveData(migrated);
        return migrated;
      }
    } catch (e) {}
    return { books: {}, active_book_id: null };
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function computeMetrics(book) {
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;
    const monthPrefix = `${curYear}-${String(curMonth).padStart(2, '0')}`;

    const txs = book?.transactions || [];
    const thisMonthTxs = txs.filter(t => t.date && t.date.startsWith(monthPrefix));

    const totalIncome = txs.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
    const totalExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);

    const monthIncome = thisMonthTxs.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
    const monthExpense = thisMonthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);

    const cats = book?.categories || [];
    const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
    const budgets = book?.budgets || {};

    const byCat = {};
    for (const t of thisMonthTxs) {
      if (t.type === 'expense') {
        if (!byCat[t.category]) byCat[t.category] = { amount: 0, count: 0 };
        byCat[t.category].amount += (t.amount || 0);
        byCat[t.category].count += 1;
      }
    }

    const breakdown = Object.entries(byCat).map(([cid, agg]) => {
      const cat = catMap[cid] || { name: cid, icon: 'mdi:tag', color: '#95A5A6' };
      const budget = budgets[cid];
      const usage = (budget && budget > 0) ? (agg.amount / budget * 100) : null;
      return {
        category_id: cid,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        amount: Math.round(agg.amount * 100) / 100,
        count: agg.count,
        budget: budget || null,
        usage_pct: usage != null ? Math.round(usage * 10) / 10 : null,
      };
    }).sort((a, b) => b.amount - a.amount);

    const budgetAlerts = [];
    for (const [cid, limit] of Object.entries(budgets)) {
      if (!limit || limit <= 0) continue;
      const spent = (byCat[cid]?.amount) || 0;
      const pct = (spent / limit) * 100;
      const severity = pct >= 100 ? 'over' : (pct >= 80 ? 'warning' : 'ok');
      budgetAlerts.push({
        category_id: cid,
        name: catMap[cid]?.name || cid,
        limit,
        spent,
        pct: Math.round(pct),
        severity,
      });
    }

    return {
      month_expense: monthExpense,
      month_income: monthIncome,
      month_balance: monthIncome - monthExpense,
      balance: totalIncome - totalExpense,
      transaction_count: txs.length,
      month_label: monthPrefix,
      this_month_count: thisMonthTxs.length,
      category_breakdown: breakdown,
      budget_alerts: budgetAlerts,
    };
  }

  function updateHassStates(data) {
    const activeId = data.active_book_id || Object.keys(data.books || {})[0];
    const activeBook = data.books ? data.books[activeId] : null;
    const metrics = computeMetrics(activeBook);

    const states = {
      'sensor.budget_book_all_books': {
        state: String(Object.keys(data.books || {}).length),
        attributes: {
          books: Object.values(data.books || {}).map(b => ({
            id: b.id,
            name: b.name,
            currency: b.currency || 'TWD',
            transaction_count: (b.transactions || []).length,
          })),
          active_book_id: activeId,
          full_data: JSON.parse(JSON.stringify(data)),
        }
      },
      'sensor.budget_book_active_book': {
        state: activeBook ? activeBook.name : '',
        attributes: {
          book_id: activeId,
          currency: activeBook?.currency || 'TWD',
          transaction_count: (activeBook?.transactions || []).length,
          category_count: (activeBook?.categories || []).length,
          recurring_count: (activeBook?.recurring || []).length,
          budget_count: Object.keys(activeBook?.budgets || {}).length,
        }
      },
      'sensor.budget_book_month_expense': {
        state: String(metrics.month_expense),
        attributes: {
          month_label: metrics.month_label,
          this_month_count: metrics.this_month_count,
          category_breakdown: metrics.category_breakdown,
          budget_alerts: metrics.budget_alerts,
        }
      },
      'sensor.budget_book_month_income': {
        state: String(metrics.month_income),
        attributes: {}
      },
      'sensor.budget_book_month_balance': {
        state: String(metrics.month_balance),
        attributes: {}
      },
      'sensor.budget_book_balance': {
        state: String(metrics.balance),
        attributes: {}
      },
      'sensor.budget_book_transaction_count': {
        state: String(metrics.transaction_count),
        attributes: {}
      },
      'sensor.budget_book_over_budget_count': {
        state: String(metrics.budget_alerts.filter(a => a.severity === 'over').length),
        attributes: { alerts: metrics.budget_alerts }
      }
    };

    window.__mock_data = data;
    haEl.hass = {
      states,
      language: 'zh-Hant',
      locale: { language: 'zh-Hant' },
      callService: async (domain, service, callData) => {
        return handleServiceCall(domain, service, callData);
      }
    };
  }

  async function handleServiceCall(domain, service, callData) {
    const data = window.__mock_data;
    const bookId = callData.book_id || data.active_book_id;
    const book = data.books ? (data.books[bookId] || Object.values(data.books)[0]) : null;
    if (!book) return;

    switch (service) {
      case 'add_transaction': {
        const id = Math.random().toString(36).substring(2, 10);
        const entry = {
          id,
          date: callData.date,
          time: callData.time || null,
          type: callData.type,
          amount: parseFloat(callData.amount),
          category: callData.category || 'other',
          note: callData.note || '',
        };
        book.transactions.push(entry);
        if (entry.note && entry.note.trim()) {
          const cat = book.categories.find(c => c.id === entry.category);
          if (cat) {
            if (!cat.note_tags) cat.note_tags = [];
            if (!cat.note_tags.includes(entry.note.trim())) cat.note_tags.push(entry.note.trim());
          }
        }
        break;
      }
      case 'update_transaction': {
        const t = book.transactions.find(x => x.id === callData.transaction_id);
        if (t) {
          if (callData.date) t.date = callData.date;
          t.time = callData.time || null;
          if (callData.type) t.type = callData.type;
          if (callData.amount != null) t.amount = parseFloat(callData.amount);
          if (callData.category) t.category = callData.category;
          t.note = callData.note || '';
          if (t.note && t.note.trim()) {
            const cat = book.categories.find(c => c.id === t.category);
            if (cat) {
              if (!cat.note_tags) cat.note_tags = [];
              if (!cat.note_tags.includes(t.note.trim())) cat.note_tags.push(t.note.trim());
            }
          }
        }
        break;
      }
      case 'delete_transaction': {
        book.transactions = book.transactions.filter(x => x.id !== callData.transaction_id);
        break;
      }
      case 'add_note_tag': {
        const cat = book.categories.find(c => c.id === callData.category);
        if (cat) {
          if (!cat.note_tags) cat.note_tags = [];
          if (!cat.note_tags.includes(callData.tag)) cat.note_tags.push(callData.tag);
        }
        break;
      }
      case 'delete_note_tag': {
        const cat = book.categories.find(c => c.id === callData.category);
        if (cat && cat.note_tags) {
          cat.note_tags = cat.note_tags.filter(t => t !== callData.tag);
        }
        break;
      }
      case 'set_active_book': {
        data.active_book_id = callData.book_id;
        break;
      }
      case 'create_book': {
        const newId = Math.random().toString(36).substring(2, 10);
        data.books[newId] = {
          id: newId,
          name: callData.name,
          currency: callData.currency || 'TWD',
          created_at: new Date().toISOString(),
          transactions: [],
          categories: JSON.parse(JSON.stringify(book.categories)),
          budgets: {},
          recurring: []
        };
        data.active_book_id = newId;
        break;
      }
      case 'rename_book': {
        if (data.books[callData.book_id]) data.books[callData.book_id].name = callData.name;
        break;
      }
      case 'delete_book': {
        delete data.books[callData.book_id];
        if (data.active_book_id === callData.book_id) {
          data.active_book_id = Object.keys(data.books)[0];
        }
        break;
      }
      case 'set_budget': {
        if (!book.budgets) book.budgets = {};
        if (callData.amount && callData.amount > 0) book.budgets[callData.category] = parseFloat(callData.amount);
        else delete book.budgets[callData.category];
        break;
      }
      case 'add_category': {
        const catId = callData.name.toLowerCase().replace(/[^a-z0-9]/g, '_') || Math.random().toString(36).substring(2, 6);
        book.categories.push({
          id: catId,
          name: callData.name,
          type: callData.type,
          icon: callData.icon || 'mdi:tag',
          color: callData.color || '#E67E22',
          note_tags: []
        });
        break;
      }
      case 'delete_category': {
        book.categories = book.categories.filter(c => c.id !== callData.category);
        break;
      }
      case 'load_sample': {
        const resp = await fetch('sample_data.json');
        const sample = await resp.json();
        Object.assign(data, sample);
        break;
      }
      case 'clear_all': {
        book.transactions = [];
        book.budgets = {};
        book.recurring = [];
        break;
      }
      case 'replace_data': {
        Object.assign(data, callData.data);
        break;
      }
    }

    saveData(data);
    updateHassStates(data);
  }

  // Set up <home-assistant> element
  let haEl = document.querySelector('home-assistant');
  if (!haEl) {
    haEl = document.createElement('home-assistant');
    document.body.appendChild(haEl);
  }

  window.resetSampleData = async () => {
    localStorage.removeItem(STORAGE_KEY);
    const d = await loadData();
    updateHassStates(d);
    const iframe = document.querySelector('iframe');
    if (iframe) iframe.src = iframe.src;
  };

  loadData().then(d => {
    updateHassStates(d);
  });
})();
