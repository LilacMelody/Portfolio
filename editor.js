/* ===== Portfolio Editor ===== */
(function () {
  const STORAGE_KEY = 'portfolio_data';
  const PHOTO_KEY = 'portfolio_photo';
  const ADMIN_USER = atob('bGFyYUJ4ZWxB').split('').reverse().join('');
  const ADMIN_PASS = atob('NjIwMnBtZVQ=').split('').reverse().join('');
  const AUTH_KEY = 'portfolio_admin';

  let editMode = false;
  let pendingChanges = {};
  let activeEditEl = null;
  let currentData = {};
  let firebaseRef = null;
  let firebasePhotoRef = null;

  /* ---------- Cached DOM ---------- */
  const editToggle = document.getElementById('edit-toggle');
  const editActions = document.getElementById('edit-actions');
  const saveBtn = document.getElementById('save-btn');
  const resetBtn = document.getElementById('reset-btn');
  const themeToggle = document.getElementById('theme-toggle');
  const adminTrigger = document.getElementById('admin-trigger');
  const adminModal = document.getElementById('admin-modal');
  const adminModalOverlay = document.getElementById('admin-modal-overlay');
  const adminLoginForm = document.getElementById('admin-login-form');
  const adminUsernameInput = document.getElementById('admin-username');
  const adminPasswordInput = document.getElementById('admin-password');
  const adminError = document.getElementById('admin-error');
  const adminLogout = document.getElementById('admin-logout');
  const editToolbar = document.getElementById('edit-toolbar');
  const colorBtn = document.getElementById('color-btn');
  const colorPanel = document.getElementById('color-panel');
  const colorBar = document.getElementById('color-bar');
  const colorPicker = document.getElementById('font-color-picker');
  const colorResetBtn = document.getElementById('color-reset-btn');
  const colorPanelHint = document.getElementById('color-panel-hint');
  const modal = document.getElementById('edit-modal');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalInput = document.getElementById('modal-input');
  const modalSave = document.getElementById('modal-save');
  const modalCancel = document.getElementById('modal-cancel');
  const toast = document.getElementById('toast');
  const photoInput = document.getElementById('photo-input');
  const heroImage = document.getElementById('hero-image');
  const profileImg = document.getElementById('profile-img');
  const heroPlaceholder = document.getElementById('hero-placeholder');
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.querySelector('.nav-links');

  /* ---------- Load Saved Data ---------- */
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function applyData(data) {
    Object.entries(data).forEach(([key, value]) => {
      if (key.startsWith('color__')) {
        const editKey = key.slice(7);
        document.querySelectorAll(`[data-editable="${editKey}"]`).forEach(el => {
          el.style.color = value === 'inherit' ? '' : value;
        });
        return;
      }
      const els = document.querySelectorAll(`[data-editable="${key}"]`);
      els.forEach(el => {
        const type = el.dataset.editType;
        if (type === 'href') {
          el.href = value;
        } else if (type === 'both') {
          el.href = `mailto:${value}`;
          el.textContent = value;
        } else {
          el.textContent = value;
          if (key.endsWith('-pct')) {
            const bar = el.closest('.skill-bar');
            if (bar) {
              const fill = bar.querySelector('.bar-fill');
              const pct = Math.min(100, Math.max(0, parseInt(value) || 0));
              if (fill) fill.style.setProperty('--pct', pct + '%');
            }
          }
        }
      });
    });
  }

  function applyPhoto(src) {
    if (!src) return;
    profileImg.src = src;
    profileImg.classList.remove('hidden');
    heroPlaceholder.style.opacity = '0';
  }

  /* ---------- Save ---------- */
  function saveData() {
    const merged = Object.assign({}, currentData, pendingChanges);
    if (firebaseRef) {
      firebaseRef.set(merged)
        .then(() => { pendingChanges = {}; showToast('Changes saved!', 'success'); })
        .catch(() => showToast('Save failed — check Firebase config', 'error'));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      pendingChanges = {};
      showToast('Changes saved!', 'success');
    }
  }

  /* ---------- Reset ---------- */
  function resetData() {
    if (!confirm('Reset all content to defaults? This cannot be undone.')) return;
    if (firebaseRef) {
      firebaseRef.remove();
      firebasePhotoRef.remove();
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PHOTO_KEY);
    }
    showToast('Reset to defaults', 'success');
    setTimeout(() => location.reload(), 800);
  }

  /* ---------- Edit Mode ---------- */
  function toggleEditMode() {
    editMode = !editMode;
    document.body.classList.toggle('edit-mode', editMode);
    editToggle.classList.toggle('active', editMode);
    editActions.classList.toggle('hidden', !editMode);

    if (editMode) {
      makeEditable();
      showToast('Edit mode on — click any text to edit', 'success');
    } else {
      removeEditable();
    }
  }

  function makeEditable() {
    document.querySelectorAll('[data-editable]').forEach(el => {
      el.addEventListener('mousedown', handleElFocus);
      const type = el.dataset.editType;
      if (type === 'href') {
        el.addEventListener('click', handleLinkEdit);
      } else if (type === 'both') {
        el.addEventListener('click', handleBothEdit);
      } else {
        el.contentEditable = 'true';
        el.spellcheck = false;
        el.addEventListener('input', handleTextInput);
        el.addEventListener('keydown', handleTextKeydown);
        el.addEventListener('paste', handlePaste);
      }
    });
    heroImage.addEventListener('click', triggerPhotoUpload);
  }

  function removeEditable() {
    document.querySelectorAll('[data-editable]').forEach(el => {
      el.removeEventListener('mousedown', handleElFocus);
      el.contentEditable = 'false';
      el.removeEventListener('input', handleTextInput);
      el.removeEventListener('keydown', handleTextKeydown);
      el.removeEventListener('paste', handlePaste);
      el.removeEventListener('click', handleLinkEdit);
      el.removeEventListener('click', handleBothEdit);
    });
    activeEditEl = null;
    heroImage.removeEventListener('click', triggerPhotoUpload);
  }

  /* ---------- Color Picker ---------- */
  function handleElFocus(e) {
    activeEditEl = e.currentTarget;
    syncColorUI();
    if (!colorPanel.classList.contains('hidden')) {
      colorPanelHint.textContent = `Editing: ${activeEditEl.textContent.trim().slice(0, 28) || 'selected element'}`;
    }
  }

  function syncColorUI() {
    if (!activeEditEl) return;
    const current = activeEditEl.style.color || 'inherit';
    colorPanelHint.textContent = `Editing: ${activeEditEl.textContent.trim().slice(0, 28) || 'selected element'}`;
    try { colorPicker.value = current === 'inherit' ? '#7c6af4' : rgbToHex(current); } catch {}
    colorBar.style.background = current === 'inherit' ? 'var(--accent)' : current;
    document.querySelectorAll('.swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === current);
    });
  }

  function applyColor(color) {
    if (!activeEditEl) { showToast('Click a text element first', 'error'); return; }
    const key = activeEditEl.dataset.editable;
    activeEditEl.style.color = color === 'inherit' ? '' : color;
    pendingChanges[`color__${key}`] = color;
    colorBar.style.background = color === 'inherit' ? 'var(--accent)' : color;
    try { if (color !== 'inherit') colorPicker.value = rgbToHex(color); } catch {}
    document.querySelectorAll('.swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === color);
    });
  }

  function rgbToHex(color) {
    if (color.startsWith('#')) return color;
    const d = document.createElement('div');
    d.style.color = color;
    document.body.appendChild(d);
    const computed = getComputedStyle(d).color;
    document.body.removeChild(d);
    const m = computed.match(/\d+/g);
    if (!m) return '#7c6af4';
    return '#' + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }

  function toggleColorPanel() {
    colorPanel.classList.toggle('hidden');
    if (!colorPanel.classList.contains('hidden')) {
      if (activeEditEl) {
        syncColorUI();
      } else {
        colorPanelHint.textContent = 'Select a text element first';
      }
    }
  }

  function handleTextInput(e) {
    const key = e.target.dataset.editable;
    const val = e.target.textContent.trim();
    pendingChanges[key] = val;

    if (key.endsWith('-pct')) {
      const bar = e.target.closest('.skill-bar');
      if (bar) {
        const fill = bar.querySelector('.bar-fill');
        const pct = Math.min(100, Math.max(0, parseInt(val) || 0));
        if (fill) fill.style.setProperty('--pct', pct + '%');
      }
    }
  }

  function handleTextKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  /* ---------- Link Edit Modal ---------- */
  let currentLinkEl = null;

  function handleLinkEdit(e) {
    e.preventDefault();
    currentLinkEl = e.currentTarget;
    openModal('Edit URL', currentLinkEl.href || '', 'href');
  }

  function handleBothEdit(e) {
    e.preventDefault();
    currentLinkEl = e.currentTarget;
    openModal('Edit Email Address', currentLinkEl.textContent.trim(), 'both');
  }

  function openModal(title, value, type) {
    modalTitle.textContent = title;
    modalInput.value = value;
    modalInput.dataset.type = type;
    modal.classList.remove('hidden');
    setTimeout(() => { modalInput.focus(); modalInput.select(); }, 50);
  }

  function closeModal() {
    modal.classList.add('hidden');
    currentLinkEl = null;
  }

  function applyModal() {
    if (!currentLinkEl) { closeModal(); return; }
    const val = modalInput.value.trim();
    const type = modalInput.dataset.type;
    const key = currentLinkEl.dataset.editable;

    if (type === 'href') {
      currentLinkEl.href = val;
      pendingChanges[key] = val;
    } else if (type === 'both') {
      currentLinkEl.href = `mailto:${val}`;
      currentLinkEl.textContent = val;
      pendingChanges[key] = val;
    }
    closeModal();
    showToast('Link updated', 'success');
  }

  /* ---------- Photo Upload ---------- */
  function triggerPhotoUpload() {
    if (!editMode) return;
    photoInput.click();
  }

  photoInput.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const src = e.target.result;
      applyPhoto(src);
      if (firebasePhotoRef) {
        firebasePhotoRef.set(src)
          .catch(() => localStorage.setItem(PHOTO_KEY, src));
      } else {
        localStorage.setItem(PHOTO_KEY, src);
      }
      showToast('Photo updated', 'success');
    };
    reader.readAsDataURL(file);
  });

  /* ---------- Firebase ---------- */
  function initFirebase() {
    try {
      if (typeof FIREBASE_CONFIG === 'undefined' ||
          !FIREBASE_CONFIG.databaseURL ||
          FIREBASE_CONFIG.databaseURL.includes('YOUR_PROJECT')) return false;
      firebase.initializeApp(FIREBASE_CONFIG);
      const db = firebase.database();
      firebaseRef = db.ref('portfolio');
      firebasePhotoRef = db.ref('portfolio_photo');
      return true;
    } catch { return false; }
  }

  /* ---------- Admin Auth ---------- */
  function showAdminUI() {
    editToolbar.style.display = 'flex';
    adminTrigger.classList.add('authenticated');
    document.body.classList.add('admin-active');
    sessionStorage.setItem(AUTH_KEY, '1');
  }

  function hideAdminUI() {
    editToolbar.style.display = 'none';
    adminTrigger.classList.remove('authenticated');
    document.body.classList.remove('admin-active');
    sessionStorage.removeItem(AUTH_KEY);
    if (editMode) toggleEditMode();
  }

  function openAdminModal() {
    adminModal.classList.remove('hidden');
    adminError.classList.add('hidden');
    adminLoginForm.reset();
    setTimeout(() => adminUsernameInput.focus(), 50);
  }

  function closeAdminModal() {
    adminModal.classList.add('hidden');
  }

  function handleAdminLogin(e) {
    e.preventDefault();
    const user = adminUsernameInput.value.trim();
    const pass = adminPasswordInput.value;
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      showAdminUI();
      closeAdminModal();
      showToast('Welcome, ' + ADMIN_USER, 'success');
    } else {
      adminError.classList.remove('hidden');
      adminPasswordInput.value = '';
      adminPasswordInput.focus();
    }
  }

  /* ---------- Theme ---------- */
  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('portfolio_theme', next);
  }

  function loadTheme() {
    const saved = localStorage.getItem('portfolio_theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }

  /* ---------- Navbar ---------- */
  const navbar = document.getElementById('navbar');

  hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });

  document.querySelectorAll('.nav-links a').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
  });

  /* ---------- Toast ---------- */
  let toastTimer;
  function showToast(msg, type = 'success') {
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
  }

  /* ---------- Scroll Reveal ---------- */
  function initReveal() {
    document.querySelectorAll('.section-header, .about-grid, .skills-grid, .projects-grid, .contact-grid, .detail-card, .project-card').forEach(el => {
      el.classList.add('reveal');
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }

  /* ---------- Skill Bar Animation ---------- */
  function initSkillBars() {
    const bars = document.querySelectorAll('.bar-fill');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.style.width = e.target.style.getPropertyValue('--pct') || getComputedStyle(e.target).getPropertyValue('--pct');
        }
      });
    }, { threshold: 0.3 });
    bars.forEach(b => {
      const pct = b.style.getPropertyValue('--pct');
      b.style.setProperty('--pct', pct);
      observer.observe(b);
    });
  }

  /* ---------- Contact Form ---------- */
  document.getElementById('contact-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type=submit]');
    btn.textContent = 'Message Sent!';
    btn.style.background = 'var(--green)';
    showToast('Message sent! (Demo)', 'success');
    setTimeout(() => {
      btn.textContent = 'Send Message';
      btn.style.background = '';
      this.reset();
    }, 3000);
  });

  /* ---------- Active Nav Link ---------- */
  function updateActiveNav() {
    const sections = document.querySelectorAll('section[id]');
    const scrollY = window.scrollY + 140;
    sections.forEach(section => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      const id = section.getAttribute('id');
      const link = document.querySelector(`.nav-links a[href="#${id}"]`);
      if (link) {
        link.style.color = (scrollY >= top && scrollY < top + height) ? 'var(--accent)' : '';
      }
    });
  }
  window.addEventListener('scroll', updateActiveNav, { passive: true });

  /* ---------- Event Bindings ---------- */
  editToggle.addEventListener('click', toggleEditMode);
  saveBtn.addEventListener('click', saveData);
  resetBtn.addEventListener('click', resetData);
  themeToggle.addEventListener('click', toggleTheme);
  modalOverlay.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modalSave.addEventListener('click', applyModal);
  modalInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyModal(); if (e.key === 'Escape') closeModal(); });

  adminTrigger.addEventListener('click', openAdminModal);
  adminModalOverlay.addEventListener('click', closeAdminModal);
  adminLoginForm.addEventListener('submit', handleAdminLogin);
  adminLogout.addEventListener('click', () => { hideAdminUI(); showToast('Logged out', 'success'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAdminModal(); });

  colorBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleColorPanel(); });
  colorResetBtn.addEventListener('click', () => applyColor('inherit'));
  colorPicker.addEventListener('input', (e) => applyColor(e.target.value));
  document.querySelectorAll('.swatch').forEach(s => {
    s.addEventListener('click', () => applyColor(s.dataset.color));
  });
  document.addEventListener('click', (e) => {
    if (!colorPanel.classList.contains('hidden') && !colorBtn.contains(e.target) && !colorPanel.contains(e.target)) {
      colorPanel.classList.add('hidden');
    }
  });

  /* ---------- Init ---------- */
  loadTheme();
  if (sessionStorage.getItem(AUTH_KEY)) showAdminUI();
  const useFirebase = initFirebase();
  if (useFirebase) {
    firebaseRef.on('value', snapshot => {
      currentData = snapshot.val() || {};
      applyData(currentData);
    });
    firebasePhotoRef.on('value', snapshot => {
      const src = snapshot.val();
      if (src) applyPhoto(src);
    });
  } else {
    currentData = loadData();
    applyData(currentData);
    applyPhoto(localStorage.getItem(PHOTO_KEY));
  }
  initReveal();
  initSkillBars();
  updateActiveNav();

})();
