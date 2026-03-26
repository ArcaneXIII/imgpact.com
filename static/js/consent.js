/**
 * imgpact — Cookie Consent Manager
 * ─────────────────────────────────
 * Gère le consentement RGPD pour GA4 et Microsoft Clarity.
 * Modifiable facilement : cherchez les sections "CONFIG" ci-dessous.
 *
 * Stockage : localStorage["imgpact_consent"] = JSON { ts, ga, clarity }
 * Durée     : 365 jours
 */

// ─── CONFIG : IDs analytics ───────────────────────────────────────────────
var CONSENT_GA4_ID      = "G-X07VC59SDB";
var CONSENT_CLARITY_ID  = "w0c24cfip7";
var CONSENT_KEY         = "imgpact_consent";
var CONSENT_DAYS        = 365;
// ─────────────────────────────────────────────────────────────────────────

// ─── Traductions ──────────────────────────────────────────────────────────
var CONSENT_I18N = {
  en: {
    banner_title:      "🍪 Cookies & Analytics",
    banner_text:       "We use Google Analytics and Microsoft Clarity to improve your experience. Your data stays anonymous if you decline.",
    btn_accept:        "Accept all",
    btn_refuse:        "Decline",
    btn_customize:     "Customize",
    modal_title:       "Cookie preferences",
    ga_title:          "Google Analytics (GA4)",
    ga_desc:           "Measures visits and tool usage to understand which features are most useful. No personal data is shared with third parties.",
    clarity_title:     "Microsoft Clarity",
    clarity_desc:      "Records anonymised sessions and heatmaps to understand how tools are used and improve the interface.",
    modal_save:        "Save my preferences",
    floating_btn:      "Cookies"
  },
  fr: {
    banner_title:      "🍪 Cookies & Analytique",
    banner_text:       "Nous utilisons Google Analytics et Microsoft Clarity pour améliorer l'expérience. Vos données restent anonymes si vous refusez.",
    btn_accept:        "Tout accepter",
    btn_refuse:        "Refuser",
    btn_customize:     "Personnaliser",
    modal_title:       "Préférences cookies",
    ga_title:          "Google Analytics (GA4)",
    ga_desc:           "Mesure les visites et l'utilisation des outils pour comprendre quelles fonctionnalités sont les plus utiles. Aucune donnée personnelle n'est partagée avec des tiers.",
    clarity_title:     "Microsoft Clarity",
    clarity_desc:      "Enregistre des sessions et cartes de chaleur anonymisées pour comprendre comment les outils sont utilisés et améliorer l'interface.",
    modal_save:        "Enregistrer mes préférences",
    floating_btn:      "Cookies"
  },
  es: {
    banner_title:      "🍪 Cookies y Analítica",
    banner_text:       "Usamos Google Analytics y Microsoft Clarity para mejorar la experiencia. Sus datos permanecen anónimos si rechaza.",
    btn_accept:        "Aceptar todo",
    btn_refuse:        "Rechazar",
    btn_customize:     "Personalizar",
    modal_title:       "Preferencias de cookies",
    ga_title:          "Google Analytics (GA4)",
    ga_desc:           "Mide las visitas y el uso de herramientas para entender qué funciones son más útiles. No se comparten datos personales con terceros.",
    clarity_title:     "Microsoft Clarity",
    clarity_desc:      "Registra sesiones y mapas de calor anonimizados para entender cómo se usan las herramientas y mejorar la interfaz.",
    modal_save:        "Guardar mis preferencias",
    floating_btn:      "Cookies"
  },
  ru: {
    banner_title:      "🍪 Cookies и аналитика",
    banner_text:       "Мы используем Google Analytics и Microsoft Clarity для улучшения работы сайта. Ваши данные остаются анонимными при отказе.",
    btn_accept:        "Принять всё",
    btn_refuse:        "Отказаться",
    btn_customize:     "Настроить",
    modal_title:       "Настройки cookies",
    ga_title:          "Google Analytics (GA4)",
    ga_desc:           "Измеряет посещения и использование инструментов для понимания наиболее полезных функций. Личные данные не передаются третьим сторонам.",
    clarity_title:     "Microsoft Clarity",
    clarity_desc:      "Записывает анонимизированные сессии и тепловые карты для понимания того, как используются инструменты, и улучшения интерфейса.",
    modal_save:        "Сохранить настройки",
    floating_btn:      "Cookies"
  }
};

function getI18n() {
  var lang = (window.IMGPACT_LANG || "en").toLowerCase();
  return CONSENT_I18N[lang] || CONSENT_I18N["en"];
}
// ─────────────────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // ── Lecture / écriture du consentement ──────────────────────────────────

  function readConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      var age  = (Date.now() - data.ts) / 86400000; // jours écoulés
      if (age > CONSENT_DAYS) { localStorage.removeItem(CONSENT_KEY); return null; }
      return data;
    } catch (e) { return null; }
  }

  function saveConsent(ga, clarity) {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({
      ts: Date.now(),
      ga: !!ga,
      clarity: !!clarity
    }));
  }

  // ── Injection analytics ─────────────────────────────────────────────────

  // Étape 1 : initialiser dataLayer + gtag + consent default AVANT tout script
  // Appelé une seule fois au démarrage, toujours en mode "denied" par défaut
  function initDataLayer() {
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      window.gtag = function() { window.dataLayer.push(arguments); };
    }
    // Étape 2 : consent default = denied (DOIT être avant le script GTM)
    window.gtag("consent", "default", {
      analytics_storage:       "denied",
      ad_storage:              "denied",
      ad_user_data:            "denied",
      ad_personalization:      "denied"
    });
  }

  function loadGA4(granted) {
    if (document.getElementById("consent-ga4-script")) {
      // Script déjà chargé — on met juste à jour le consentement
      if (granted) {
        window.gtag("consent", "update", { analytics_storage: "granted" });
      }
      return;
    }

    // Étape 3 : injecter le script googletagmanager
    var s = document.createElement("script");
    s.id    = "consent-ga4-script";
    s.async = true;
    s.src   = "https://www.googletagmanager.com/gtag/js?id=" + CONSENT_GA4_ID;
    document.head.appendChild(s);

    // Étape 4 : gtag('js') + config (après l'injection du script)
    window.gtag("js", new Date());
    window.gtag("config", CONSENT_GA4_ID, {
      anonymize_ip:                      !granted,
      allow_google_signals:              granted,
      allow_ad_personalization_signals:  false
    });

    // Étape 5 : mettre à jour le consentement si accordé
    if (granted) {
      window.gtag("consent", "update", { analytics_storage: "granted" });
    }
  }

  function loadClarity() {
    if (document.getElementById("consent-clarity-script")) return;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.id = "consent-clarity-script";
      t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", CONSENT_CLARITY_ID);
  }

  function applyConsent(ga, clarity) {
    loadGA4(!!ga); // true = consentement accordé, false = mode anonyme
    if (clarity) loadClarity();
  }

  // ── Création du HTML de la bannière ─────────────────────────────────────

  function createBanner() {
    var i18n = getI18n();
    var el = document.createElement("div");
    el.id = "consent-banner";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Cookie consent");
    el.innerHTML = [
      '<div class="consent-banner__inner">',
        '<div class="consent-banner__text">',
          '<strong>' + i18n.banner_title + '</strong>',
          '<p>' + i18n.banner_text + '</p>',
        '</div>',
        '<div class="consent-banner__actions">',
          '<button id="consent-btn-accept" class="consent-btn consent-btn--primary">' + i18n.btn_accept + '</button>',
          '<button id="consent-btn-refuse" class="consent-btn consent-btn--secondary">' + i18n.btn_refuse + '</button>',
          '<button id="consent-btn-customize" class="consent-btn consent-btn--ghost">' + i18n.btn_customize + '</button>',
        '</div>',
      '</div>'
    ].join("");
    return el;
  }

  // ── Création du modal "Personnaliser" ───────────────────────────────────

  function createModal() {
    var i18n = getI18n();
    var el = document.createElement("div");
    el.id = "consent-modal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", i18n.modal_title);
    el.innerHTML = [
      '<div class="consent-modal__backdrop" id="consent-modal-backdrop"></div>',
      '<div class="consent-modal__box">',
        '<div class="consent-modal__header">',
          '<h2 class="consent-modal__title">' + i18n.modal_title + '</h2>',
          '<button class="consent-modal__close" id="consent-modal-close" aria-label="Close">✕</button>',
        '</div>',
        '<div class="consent-modal__body">',

          // Toggle GA4
          '<div class="consent-toggle-row">',
            '<div class="consent-toggle-info">',
              '<strong>' + i18n.ga_title + '</strong>',
              '<p>' + i18n.ga_desc + '</p>',
            '</div>',
            '<label class="consent-toggle" aria-label="' + i18n.ga_title + '">',
              '<input type="checkbox" id="consent-toggle-ga" />',
              '<span class="consent-toggle__track"><span class="consent-toggle__thumb"></span></span>',
            '</label>',
          '</div>',

          // Toggle Clarity
          '<div class="consent-toggle-row">',
            '<div class="consent-toggle-info">',
              '<strong>' + i18n.clarity_title + '</strong>',
              '<p>' + i18n.clarity_desc + '</p>',
            '</div>',
            '<label class="consent-toggle" aria-label="' + i18n.clarity_title + '">',
              '<input type="checkbox" id="consent-toggle-clarity" />',
              '<span class="consent-toggle__track"><span class="consent-toggle__thumb"></span></span>',
            '</label>',
          '</div>',

        '</div>',
        '<div class="consent-modal__footer">',
          '<button id="consent-modal-save" class="consent-btn consent-btn--primary">' + i18n.modal_save + '</button>',
        '</div>',
      '</div>'
    ].join("");
    return el;
  }

  // ── Bouton flottant "Cookies" ────────────────────────────────────────────

  function createFloatingBtn() {
    var i18n = getI18n();
    var el = document.createElement("button");
    el.id = "consent-floating-btn";
    el.setAttribute("aria-label", i18n.floating_btn);
    el.title = i18n.floating_btn;
    el.textContent = i18n.floating_btn;
    return el;
  }

  // ── Logique principale ──────────────────────────────────────────────────

  function hideBanner(banner) {
    banner.classList.add("consent-banner--hiding");
    setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 350);
  }

  function showModal(modal, currentConsent) {
    var ga      = document.getElementById("consent-toggle-ga");
    var clarity = document.getElementById("consent-toggle-clarity");
    // Pré-rempli avec les préférences actuelles (ou cochés par défaut si vierge)
    ga.checked      = currentConsent ? currentConsent.ga      : false;
    clarity.checked = currentConsent ? currentConsent.clarity : false;
    modal.classList.add("consent-modal--visible");
    document.body.style.overflow = "hidden";
  }

  function hideModal(modal) {
    modal.classList.remove("consent-modal--visible");
    document.body.style.overflow = "";
  }

  function init() {
    // Étape 1+2 : initialiser dataLayer et poser consent default=denied
    // DOIT être la toute première chose avant tout script tiers
    initDataLayer();

    var existing = readConsent();

    // Toujours créer le modal et le bouton flottant
    var modal       = createModal();
    var floatingBtn = createFloatingBtn();
    document.body.appendChild(modal);
    document.body.appendChild(floatingBtn);

    // Si consentement déjà donné : appliquer et sortir
    if (existing) {
      applyConsent(existing.ga, existing.clarity);
      wireModalEvents(modal, floatingBtn, existing);
      return;
    }

    // Sinon : afficher la bannière
    var banner = createBanner();
    document.body.appendChild(banner);
    // Force reflow pour déclencher la transition CSS
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { banner.classList.add("consent-banner--visible"); });
    });

    // ── Accepter tout
    document.getElementById("consent-btn-accept").addEventListener("click", function () {
      saveConsent(true, true);
      applyConsent(true, true);
      hideBanner(banner);
    });

    // ── Refuser
    document.getElementById("consent-btn-refuse").addEventListener("click", function () {
      saveConsent(false, false);
      applyConsent(false, false);
      hideBanner(banner);
    });

    // ── Personnaliser → ouvre le modal
    document.getElementById("consent-btn-customize").addEventListener("click", function () {
      showModal(modal, null);
    });

    wireModalEvents(modal, floatingBtn, null);
  }

  function wireModalEvents(modal, floatingBtn, currentConsent) {
    // Fermer le modal (croix ou backdrop)
    document.getElementById("consent-modal-close").addEventListener("click", function () {
      hideModal(modal);
    });
    document.getElementById("consent-modal-backdrop").addEventListener("click", function () {
      hideModal(modal);
    });

    // Enregistrer les préférences depuis le modal
    document.getElementById("consent-modal-save").addEventListener("click", function () {
      var ga      = document.getElementById("consent-toggle-ga").checked;
      var clarity = document.getElementById("consent-toggle-clarity").checked;
      saveConsent(ga, clarity);
      applyConsent(ga, clarity);
      hideModal(modal);
      // Masquer la bannière si encore visible
      var banner = document.getElementById("consent-banner");
      if (banner) hideBanner(banner);
    });

    // Bouton flottant → rouvre le modal avec les préfs actuelles
    floatingBtn.addEventListener("click", function () {
      var c = readConsent();
      showModal(modal, c);
    });

    // Touche Échap pour fermer le modal
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("consent-modal--visible")) {
        hideModal(modal);
      }
    });
  }

  // Lancer après chargement du DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
