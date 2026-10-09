const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const loading = ref(true);
    const loadingMessage = ref('尋找 Home Assistant 連線中...');
    
    // UI State
    const activeTab = ref('home');
    const tabs = [
      { id: 'home', name: '總覽' },
      { id: 'tx', name: '交易' },
      { id: 'charts', name: '圖表' },
      { id: 'categories', name: '分類' },
      { id: 'budgets', name: '預算' },
      { id: 'recurring', name: '固定支出' },
      { id: 'settings', name: '設定' }
    ];
    
    // Data State
    const books = ref([]);
    const activeBookId = ref(null);
    const transactions = ref([]);
    const categories = ref([]);
    const budgets = ref({});
    const recurring = ref([]);
    
    const showAddTx = ref(false);
    const txForm = ref({ type: 'expense', amount: null, category: null, date: '', note: '' });
    
    // Filters and Pagination
    const filters = ref({ search: '', type: '', category: '' });
    const txPage = ref(1);
    const itemsPerPage = 50;

    // Get HA Connection
    async function getHAConnection(maxWait = 5000) {
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        try {
          const parentDoc = window.parent.document;
          const haEl = parentDoc.querySelector('home-assistant');
          if (haEl && haEl.hass && haEl.hass.connection) {
            return haEl.hass.connection;
          }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }

    let haConnection = null;

    async function init() {
      haConnection = await getHAConnection();
      if (!haConnection) {
        loadingMessage.value = '無法連線到 Home Assistant，請確認是否在 HA 內執行。';
        return;
      }
      
      loadingMessage.value = '取得記帳本資料中...';
      await fetchBooks();
      if (activeBookId.value) {
        await fetchBookData();
      }
      
      // Initialize form date
      const today = new Date();
      txForm.value.date = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
      
      loading.value = false;
    }

    async function fetchBooks() {
      try {
        const res = await haConnection.sendMessagePromise({ type: 'budget_book/get_books' });
        books.value = res.books || [];
        activeBookId.value = res.active_book_id || (books.value[0]?.id);
      } catch (e) {
        console.error('Failed to fetch books', e);
      }
    }

    async function fetchBookData(month = null) {
      try {
        const res = await haConnection.sendMessagePromise({ 
          type: 'budget_book/get_book_data', 
          book_id: activeBookId.value,
          month: month 
        });
        transactions.value = res.transactions || [];
        // Sort newest first
        transactions.value.sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
        
        categories.value = res.categories || [];
        budgets.value = res.budgets || {};
        recurring.value = res.recurring || [];
      } catch (e) {
        console.error('Failed to fetch book data', e);
      }
    }

    async function onBookChange() {
      loading.value = true;
      await fetchBookData();
      loading.value = false;
    }

    const recentTransactions = computed(() => {
      return transactions.value.slice(0, 5);
    });
    
    // Transactions logic
    const filteredTransactions = computed(() => {
      let result = transactions.value;
      if (filters.value.type) {
        result = result.filter(tx => tx.type === filters.value.type);
      }
      if (filters.value.category) {
        result = result.filter(tx => tx.category === filters.value.category);
      }
      if (filters.value.search) {
        const s = filters.value.search.toLowerCase();
        result = result.filter(tx => (tx.note && tx.note.toLowerCase().includes(s)) || (String(tx.amount).includes(s)));
      }
      return result;
    });
    
    const paginatedTransactions = computed(() => {
      return filteredTransactions.value.slice(0, txPage.value * itemsPerPage);
    });
    
    const hasMoreTransactions = computed(() => {
      return paginatedTransactions.value.length < filteredTransactions.value.length;
    });

    function getCategoryName(catId) {
      const cat = categories.value.find(c => c.id === catId);
      return cat ? cat.name : '其他';
    }
    
    function getCategoryColor(catId) {
      const cat = categories.value.find(c => c.id === catId);
      return cat ? cat.color : '#95a5a6';
    }
    
    // Add Transaction Logic
    const currentCategoryNoteTags = computed(() => {
      if (!txForm.value.category) return [];
      const cat = categories.value.find(c => c.id === txForm.value.category);
      return (cat && cat.note_tags) ? cat.note_tags : [];
    });
    
    function toggleNoteTag(tag) {
      let currentNote = txForm.value.note || '';
      if (currentNote.includes(tag)) {
        txForm.value.note = currentNote.replace(tag, '').trim();
      } else {
        txForm.value.note = (currentNote + ' ' + tag).trim();
      }
    }
    
    async function submitTx() {
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'add_transaction',
          service_data: {
            book_id: activeBookId.value,
            type: txForm.value.type,
            amount: txForm.value.amount,
            category: txForm.value.category,
            date: txForm.value.date,
            note: txForm.value.note
          }
        });
        showAddTx.value = false;
        txForm.value.amount = null;
        txForm.value.note = '';
        await fetchBookData(); // refresh data
      } catch (e) {
        alert('儲存失敗: ' + e.message);
      }
    }
    
    async function deleteTx(txId) {
      if (!confirm('確定要刪除這筆交易嗎？')) return;
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'delete_transaction',
          service_data: {
            book_id: activeBookId.value,
            transaction_id: txId
          }
        });
        await fetchBookData(); // refresh data
      } catch (e) {
        alert('刪除失敗: ' + e.message);
      }
    }

    // Categories Logic
    const showAddCat = ref(false);
    const catForm = ref({ type: 'expense', name: '', color: '#E67E22' });

    function openAddCat(type) {
      catForm.value.type = type;
      catForm.value.name = '';
      showAddCat.value = true;
    }

    async function submitCat() {
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'add_category',
          service_data: {
            book_id: activeBookId.value,
            type: catForm.value.type,
            name: catForm.value.name,
            color: catForm.value.color
          }
        });
        showAddCat.value = false;
        await fetchBookData();
      } catch (e) { alert('儲存失敗: ' + e.message); }
    }

    async function deleteCategory(catId) {
      if (!confirm('確定要刪除這個分類嗎？原有交易會歸類為「其他」')) return;
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'delete_category',
          service_data: { book_id: activeBookId.value, category: catId }
        });
        await fetchBookData();
      } catch (e) { alert('刪除失敗: ' + e.message); }
    }

    async function addNoteTag(catId) {
      const tag = prompt('請輸入常用備註標籤名稱：');
      if (!tag) return;
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'add_note_tag',
          service_data: { book_id: activeBookId.value, category: catId, tag: tag }
        });
        await fetchBookData();
      } catch (e) { alert('新增失敗: ' + e.message); }
    }

    async function deleteNoteTag(catId, tag) {
      if (!confirm(`確定要刪除標籤「${tag}」嗎？`)) return;
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'delete_note_tag',
          service_data: { book_id: activeBookId.value, category: catId, tag: tag }
        });
        await fetchBookData();
      } catch (e) { alert('刪除失敗: ' + e.message); }
    }

    // Recurring Logic
    const showAddRecurring = ref(false);
    const recForm = ref({ name: '', amount: null, category: null, day_of_month: 1 });

    async function submitRecurring() {
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'add_recurring',
          service_data: {
            book_id: activeBookId.value,
            name: recForm.value.name,
            amount: recForm.value.amount,
            category: recForm.value.category,
            day_of_month: recForm.value.day_of_month,
            type: 'expense'
          }
        });
        showAddRecurring.value = false;
        await fetchBookData();
      } catch (e) { alert('儲存失敗: ' + e.message); }
    }

    async function deleteRecurring(recId) {
      if (!confirm('確定刪除這個固定支出嗎？')) return;
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'delete_recurring',
          service_data: { book_id: activeBookId.value, recurring_id: recId }
        });
        await fetchBookData();
      } catch (e) { alert('刪除失敗: ' + e.message); }
    }

    // Book Logic
    const showAddBook = ref(false);
    const bookForm = ref({ name: '', currency: 'TWD' });

    async function submitBook() {
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'create_book',
          service_data: { name: bookForm.value.name, currency: bookForm.value.currency }
        });
        showAddBook.value = false;
        await fetchBooks();
      } catch (e) { alert('儲存失敗: ' + e.message); }
    }

    async function deleteBook(bookId) {
      if (!confirm('確定刪除這本記帳本嗎？所有資料將無法復原！')) return;
      try {
        await haConnection.sendMessagePromise({
          type: 'call_service',
          domain: 'budget_book',
          service: 'delete_book',
          service_data: { book_id: bookId }
        });
        await fetchBooks();
      } catch (e) { alert('刪除失敗: ' + e.message); }
    }

    function openAddBudget(catId) {
      const current = budgets.value[catId] || '';
      const amount = prompt('請輸入此分類的每月預算上限 (留空或 0 取消預算)：', current);
      if (amount === null) return;
      
      haConnection.sendMessagePromise({
        type: 'call_service',
        domain: 'budget_book',
        service: 'set_budget',
        service_data: { 
          book_id: activeBookId.value, 
          category: catId, 
          amount: amount ? parseFloat(amount) : null 
        }
      }).then(() => fetchBookData()).catch(e => alert('設定失敗: ' + e.message));
    }

    onMounted(() => {
      init();
    });

    return {
      loading, loadingMessage,
      activeTab, tabs,
      books, activeBookId,
      transactions, categories, budgets, recurring,
      showAddTx, txForm,
      filters, txPage, filteredTransactions, paginatedTransactions, hasMoreTransactions,
      onBookChange, recentTransactions, getCategoryName, getCategoryColor,
      currentCategoryNoteTags, toggleNoteTag, submitTx, deleteTx,
      showAddCat, catForm, openAddCat, submitCat, deleteCategory, addNoteTag, deleteNoteTag,
      showAddRecurring, recForm, submitRecurring, deleteRecurring,
      showAddBook, bookForm, submitBook, deleteBook,
      openAddBudget
    };
  }
});

app.mount('#app');
