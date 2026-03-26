// imgpact — shared JS utilities

// ===== THEME TOGGLE =====
(function () {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const icon = btn.querySelector('.theme-icon');

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function setIcon(theme) {
    const name = theme === 'dark' ? 'sun' : 'moon';
    icon.innerHTML = `<i data-lucide="${name}"></i>`;
    if (window.lucide) lucide.createIcons({ nodes: [icon] });
  }

  setIcon(getTheme());

  btn.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('imgpact-theme', next);
    setIcon(next);
  });
})();

// ===== TOOL SEARCH =====
(function () {
  const TOOLS = [
    { name: 'PNG Converter',  url: '/tools/convert/png',  cat: 'Convert',      icon: 'arrow-right-left' },
    { name: 'JPG Converter',  url: '/tools/convert/jpg',  cat: 'Convert',      icon: 'arrow-right-left' },
    { name: 'WebP Converter', url: '/tools/convert/webp', cat: 'Convert',      icon: 'arrow-right-left' },
    { name: 'GIF Converter',  url: '/tools/convert/gif',  cat: 'Convert',      icon: 'arrow-right-left' },
    { name: 'SVG Converter',  url: '/tools/convert/svg',  cat: 'Convert',      icon: 'pen-tool' },
    { name: 'Crop',           url: '/tools/crop',          cat: 'Image Tools',  icon: 'crop' },
    { name: 'Resize',         url: '/tools/resize',        cat: 'Image Tools',  icon: 'scaling' },
    { name: 'Optimize',       url: '/tools/optimize',      cat: 'Image Tools',  icon: 'gauge' },
    { name: 'Effects',        url: '/tools/effects',       cat: 'Image Tools',  icon: 'wand-sparkles' },
    { name: 'Add Text',       url: '/tools/add-text',      cat: 'Image Tools',  icon: 'type' },
    { name: 'Transform',      url: '/tools/transform',     cat: 'Image Tools',  icon: 'rotate-cw' },
    { name: 'GIF Maker',      url: '/tools/gif-maker',     cat: 'GIF Tools',    icon: 'clapperboard' },
    { name: 'GIF Editor',     url: '/tools/gif-editor',    cat: 'GIF Tools',    icon: 'pencil-ruler' },
    { name: 'GIF Split',      url: '/tools/gif-split',     cat: 'GIF Tools',    icon: 'scissors' },
    { name: 'GIF Analyzer',   url: '/tools/gif-analyzer',  cat: 'GIF Tools',    icon: 'bar-chart-2' },
    { name: 'Video to GIF',   url: '/tools/video-to-gif',  cat: 'GIF Tools',    icon: 'video' },
    { name: 'GIF to MP4',     url: '/tools/gif-to-mp4',    cat: 'GIF Tools',    icon: 'file-video' },
    { name: 'GIF to WebM',    url: '/tools/gif-to-webm',   cat: 'GIF Tools',    icon: 'monitor-play' },
    { name: 'GIF to MOV',     url: '/tools/gif-to-mov',    cat: 'GIF Tools',    icon: 'film' },
  ];

  function buildDropdown(query, container, style) {
    const q = query.trim().toLowerCase();
    container.innerHTML = '';
    if (!q) { container.hidden = true; return; }
    const matches = TOOLS.filter(t =>
      t.name.toLowerCase().includes(q) || t.cat.toLowerCase().includes(q)
    ).slice(0, 8);
    if (!matches.length) {
      const el = document.createElement('div');
      el.className = 'search-no-results';
      el.textContent = 'No tools found';
      container.appendChild(el);
    } else {
      matches.forEach(t => {
        if (style === 'footer') {
          const a = document.createElement('a');
          a.href = t.url;
          a.textContent = t.name;
          container.appendChild(a);
        } else {
          const a = document.createElement('a');
          a.className = 'search-result-item';
          a.href = t.url;
          a.innerHTML = `<i data-lucide="${t.icon}"></i><span>${t.name}</span><span class="search-result-cat">${t.cat}</span>`;
          container.appendChild(a);
        }
      });
    }
    container.hidden = false;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
  }

  // Navbar search
  const navInput = document.getElementById('nav-search-input');
  const navDropdown = document.getElementById('nav-search-dropdown');
  if (navInput && navDropdown) {
    navInput.addEventListener('input', () => buildDropdown(navInput.value, navDropdown, 'nav'));
    navInput.addEventListener('focus', () => { if (navInput.value) buildDropdown(navInput.value, navDropdown, 'nav'); });
    document.addEventListener('click', (e) => {
      if (!navInput.closest('#nav-search').contains(e.target)) navDropdown.hidden = true;
    });
    // ⌘K / Ctrl+K shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); navInput.focus(); navInput.select(); }
      if (e.key === 'Escape') { navDropdown.hidden = true; navInput.blur(); }
    });
  }

  // Footer search
  const footerInput = document.getElementById('footer-search-input');
  const footerResults = document.getElementById('footer-search-results');
  if (footerInput && footerResults) {
    footerInput.addEventListener('input', () => buildDropdown(footerInput.value, footerResults, 'footer'));
  }
})();

// ===== HAMBURGER / SIDEBAR TOGGLE =====
(function () {
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');

  if (!hamburger || !sidebar) return;

  // Create overlay element
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  overlay.addEventListener('click', closeSidebar);

  // Close on resize to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      closeSidebar();
    }
  });
})();

// ===== FORMAT UTILITIES (used by tools) =====
const imgpact = {
  formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  },

  formatDimensions(w, h) {
    return `${w} × ${h}`;
  },

  // Load WASM module (populated in Phase 2)
  wasm: null,

  async loadWasm() {
    if (this.wasm) return this.wasm;
    try {
      const mod = await import('/static/wasm/wasm_engine.js');
      await mod.default();
      this.wasm = mod;
      return mod;
    } catch (e) {
      console.warn('WASM not yet available:', e.message);
      return null;
    }
  },
};

window.imgpact = imgpact;

// ===== GLOBAL ERROR HANDLER =====
window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error || e.message);
  if (window.TC && typeof TC.showToast === 'function') {
    TC.showToast('Something went wrong. Please try again.', 'error');
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  const msg = e.reason?.message || String(e.reason);
  if (window.TC && typeof TC.showToast === 'function') {
    if (msg.includes('wasm') || msg.includes('WebAssembly')) {
      TC.showToast('Failed to load processing engine. Please refresh.', 'error');
    } else {
      TC.showToast('Something went wrong. Please try again.', 'error');
    }
  }
});
