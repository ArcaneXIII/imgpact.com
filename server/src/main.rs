mod i18n;
mod stats;
use i18n::{detect_lang, get_translations, Lang};
use stats::StatsDb;
use std::sync::Arc;

// ─── Global Tera instance (parsed once at startup, never again) ───────────
static TERA: std::sync::OnceLock<Tera> = std::sync::OnceLock::new();

fn get_tera() -> &'static Tera {
    TERA.get_or_init(build_tera)
}

// ─── Slug validation ──────────────────────────────────────────────────────
/// Only allow slugs that contain lowercase letters, digits, and hyphens.
/// Rejects path traversal attempts like `../secret`, `%2F`, etc.
fn is_valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 120
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

// ─── Parse language code from URL path segment ────────────────────────────
fn lang_from_code(s: &str) -> Option<Lang> {
    match s {
        "en" => Some(Lang::En),
        "fr" => Some(Lang::Fr),
        "es" => Some(Lang::Es),
        "ru" => Some(Lang::Ru),
        _    => None,
    }
}

use axum::{
    extract::{Path, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::net::SocketAddr;
use tera::{Context, Tera};
use tower_http::{compression::CompressionLayer, services::ServeDir};

// ─── All tool slugs (internal / EN canonical) ─────────────────────────────
static TOOL_SLUGS: &[&str] = &[
    "gif-maker", "gif-editor", "gif-split", "gif-analyzer",
    "video-to-gif", "gif-to-mp4", "gif-to-webm", "gif-to-mov",
    "crop", "resize", "optimize", "effects", "transform", "add-text",
];

// ─── Convert page slugs (for sitemap /tools/convert/:format routes) ───────
static CONVERT_SLUGS: &[&str] = &["png", "jpg", "webp", "gif", "svg", "avif", "heic", "tiff", "bmp"];

// ─── Tool slug translations: (en, fr, es) ─────────────────────────────────
static TOOL_SLUG_MAP: &[(&str, &str, &str)] = &[
    ("gif-maker",    "creer-gif",         "crear-gif"),
    ("gif-editor",   "editer-gif",        "editar-gif"),
    ("gif-split",    "decouper-gif",      "dividir-gif"),
    ("gif-analyzer", "analyser-gif",      "analizar-gif"),
    ("video-to-gif", "video-en-gif",      "video-a-gif"),
    ("gif-to-mp4",   "gif-en-mp4",        "gif-a-mp4"),
    ("gif-to-webm",  "gif-en-webm",       "gif-a-webm"),
    ("gif-to-mov",   "gif-en-mov",        "gif-a-mov"),
    ("crop",         "recadrer",          "recortar"),
    ("resize",       "redimensionner",    "redimensionar"),
    ("optimize",     "optimiser",         "optimizar"),
    ("effects",      "effets",            "efectos"),
    ("transform",    "transformer",       "transformar"),
    ("add-text",     "ajouter-texte",     "anadir-texto"),
];

/// Section word for "tools" in URL.
fn section_tools(lang: Lang) -> &'static str {
    match lang { Lang::Fr => "outils", Lang::Es => "herramientas", _ => "tools" }
}
/// Section word for "guides" in URL.
fn section_guides(lang: Lang) -> &'static str {
    match lang { Lang::Es => "guias", _ => "guides" }
}
/// Sub-section word for "convert" in URL.
fn section_convert(lang: Lang) -> &'static str {
    match lang { Lang::Fr | Lang::Es => "convertir", _ => "convert" }
}

/// Return the URL-facing tool slug for a given lang (EN slug is canonical for EN/RU).
fn tool_url_slug(en_slug: &str, lang: Lang) -> &'static str {
    match TOOL_SLUG_MAP.iter().find(|m| m.0 == en_slug) {
        Some(m) => match lang { Lang::Fr => m.1, Lang::Es => m.2, _ => m.0 },
        None    => TOOL_SLUGS.iter().copied().find(|&s| s == en_slug).unwrap_or("unknown"),
    }
}

/// Resolve a URL tool slug (any lang) → internal EN slug.
fn en_tool_slug_from_url(url_slug: &str, lang: Lang) -> Option<&'static str> {
    // Direct EN match (also covers RU)
    if let Some(&s) = TOOL_SLUGS.iter().find(|&&s| s == url_slug) {
        return Some(s);
    }
    match lang {
        Lang::Fr => TOOL_SLUG_MAP.iter().find(|m| m.1 == url_slug).map(|m| m.0),
        Lang::Es => TOOL_SLUG_MAP.iter().find(|m| m.2 == url_slug).map(|m| m.0),
        // Backward compat: accept any translation on EN/RU too
        _        => TOOL_SLUG_MAP.iter().find(|m| m.1 == url_slug || m.2 == url_slug).map(|m| m.0),
    }
}

// ─── Guide slug mapping: French (template) slug → Spanish URL slug ───────
static GUIDE_SLUG_ES_MAP: &[(&str, &str)] = &[
    ("formats-image",                       "formatos-imagen"),
    ("optimiser-images-site-web",           "optimizar-imagenes-web"),
    ("compression-image-lossy-lossless",    "compresion-con-perdida-sin-perdida"),
    ("tailles-images-reseaux-sociaux-2026", "tamanos-imagenes-redes-sociales-2026"),
    ("images-produits-ecommerce",           "imagenes-productos-ecommerce"),
    ("jpeg-vs-png",                         "jpeg-vs-png"),
    ("format-avif",                         "formato-avif"),
    ("svg-pour-le-web",                     "svg-para-web"),
    ("format-heic",                         "formato-heic"),
    ("lazy-loading-images",                 "lazy-loading-imagenes"),
    ("images-core-web-vitals",              "imagenes-core-web-vitals"),
    ("cdn-images-comparatif",               "comparativa-cdn-imagenes"),
    ("responsive-images-srcset-sizes",      "imagenes-responsive-srcset"),
    ("compresser-sans-perdre-qualite",      "comprimir-sin-perder-calidad"),
    ("reduire-poids-gif",                   "reducir-tamano-gif"),
    ("optimiser-images-email",              "optimizar-imagenes-email"),
    ("compression-webp-vs-jpeg",            "compresion-webp-vs-jpeg"),
    ("dimensions-images-instagram",         "dimensiones-imagenes-instagram"),
    ("dimensions-images-facebook",          "dimensiones-imagenes-facebook"),
    ("taille-banniere-youtube",             "tamano-banner-youtube"),
    ("images-linkedin-optimales",           "imagenes-linkedin-optimas"),
    ("images-shopify",                      "tamanos-imagenes-shopify"),
    ("amazon-product-images",               "imagenes-productos-amazon"),
    ("photos-produit-fond-blanc",           "fotos-producto-fondo-blanco"),
    ("zoom-produit-interactif",             "zoom-producto-interactivo"),
];

// ─── Guide slug mapping: French (template) slug → English URL slug ────────
static GUIDE_SLUG_EN_MAP: &[(&str, &str)] = &[
    ("formats-image",                       "image-formats"),
    ("optimiser-images-site-web",           "optimize-website-images"),
    ("compression-image-lossy-lossless",    "lossy-vs-lossless-compression"),
    ("tailles-images-reseaux-sociaux-2026", "social-media-image-sizes-2026"),
    ("images-produits-ecommerce",           "ecommerce-product-images"),
    ("jpeg-vs-png",                         "jpeg-vs-png"),
    ("format-avif",                         "avif-format"),
    ("svg-pour-le-web",                     "svg-for-the-web"),
    ("format-heic",                         "heic-format"),
    ("lazy-loading-images",                 "lazy-loading-images"),
    ("images-core-web-vitals",              "images-core-web-vitals"),
    ("cdn-images-comparatif",               "image-cdn-comparison"),
    ("responsive-images-srcset-sizes",      "responsive-images-srcset-sizes"),
    ("compresser-sans-perdre-qualite",      "compress-without-quality-loss"),
    ("reduire-poids-gif",                   "reduce-gif-file-size"),
    ("optimiser-images-email",              "optimize-images-for-email"),
    ("compression-webp-vs-jpeg",            "webp-vs-jpeg-compression"),
    ("dimensions-images-instagram",         "instagram-image-dimensions"),
    ("dimensions-images-facebook",          "facebook-image-dimensions"),
    ("taille-banniere-youtube",             "youtube-banner-size"),
    ("images-linkedin-optimales",           "linkedin-image-sizes"),
    ("images-shopify",                      "shopify-image-sizes"),
    ("amazon-product-images",               "amazon-product-images"),
    ("photos-produit-fond-blanc",           "product-photos-white-background"),
    ("zoom-produit-interactif",             "interactive-product-zoom"),
];

/// Given a French (template) slug, return the Spanish URL slug.
fn es_slug_for_fr(fr_slug: &str) -> &'static str {
    if let Some(entry) = GUIDE_SLUG_ES_MAP.iter().find(|m| m.0 == fr_slug) {
        return entry.1;
    }
    GUIDE_SLUGS.iter().copied().find(|&s| s == fr_slug).unwrap_or("unknown")
}

/// Given a French (template) slug, return the English URL slug.
fn en_slug_for_fr(fr_slug: &str) -> &'static str {
    if let Some(entry) = GUIDE_SLUG_EN_MAP.iter().find(|m| m.0 == fr_slug) {
        return entry.1;
    }
    GUIDE_SLUGS.iter().copied().find(|&s| s == fr_slug).unwrap_or("unknown")
}

/// Resolve a URL slug (any language) to the internal French template slug.
/// Returns None if unrecognised.
fn fr_slug_from_url(url_slug: &str, lang: Lang) -> Option<&'static str> {
    match lang {
        Lang::Fr => GUIDE_SLUGS.iter().copied().find(|&s| s == url_slug),
        Lang::Es => {
            if let Some(entry) = GUIDE_SLUG_ES_MAP.iter().find(|m| m.1 == url_slug) {
                return Some(entry.0);
            }
            if let Some(entry) = GUIDE_SLUG_EN_MAP.iter().find(|m| m.1 == url_slug) {
                return Some(entry.0);
            }
            GUIDE_SLUGS.iter().copied().find(|&s| s == url_slug)
        }
        _ => {
            if let Some(entry) = GUIDE_SLUG_EN_MAP.iter().find(|m| m.1 == url_slug) {
                return Some(entry.0);
            }
            GUIDE_SLUGS.iter().copied().find(|&s| s == url_slug)
        }
    }
}

/// URL slug to use for a given French template slug and language.
fn url_slug_for_lang(fr_slug: &'static str, lang: Lang) -> &'static str {
    match lang {
        Lang::Fr => fr_slug,
        Lang::Es => es_slug_for_fr(fr_slug),
        _        => en_slug_for_fr(fr_slug),
    }
}

// ─── Guide slugs ──────────────────────────────────────────────────────────
static GUIDE_SLUGS: &[&str] = &[
    // Pillar articles
    "formats-image", "optimiser-images-site-web", "compression-image-lossy-lossless",
    "tailles-images-reseaux-sociaux-2026", "images-produits-ecommerce",
    // Formats d'image
    "jpeg-vs-png", "format-avif", "svg-pour-le-web", "format-heic",
    // Optimisation web
    "lazy-loading-images", "images-core-web-vitals", "cdn-images-comparatif",
    "responsive-images-srcset-sizes",
    // Compression
    "compresser-sans-perdre-qualite", "reduire-poids-gif",
    "optimiser-images-email", "compression-webp-vs-jpeg",
    // Réseaux sociaux
    "dimensions-images-instagram", "dimensions-images-facebook",
    "taille-banniere-youtube", "images-linkedin-optimales",
    // E-commerce
    "images-shopify", "amazon-product-images",
    "photos-produit-fond-blanc", "zoom-produit-interactif",
];

// ─── Guide metadata (slug, page_title, meta_description, pillar_label) ────
static GUIDE_META: &[(&str, &str, &str, &str)] = &[
    ("formats-image",
     "Formats d'image web : JPEG, PNG, WebP, AVIF, SVG, guide complet | imgpact",
     "Tout comprendre sur les formats d'image web en 2026 : JPEG, PNG, WebP, AVIF, GIF, SVG. Quand utiliser chaque format pour les meilleures performances.",
     "Formats d'image"),
    ("optimiser-images-site-web",
     "Optimiser les images d'un site web : guide complet 2026 | imgpact",
     "Comment optimiser les images pour le web : formats, compression, lazy loading, CDN, Core Web Vitals. Guide complet pour améliorer les performances.",
     "Optimisation web"),
    ("compression-image-lossy-lossless",
     "Compression image : lossy vs lossless, tout comprendre | imgpact",
     "Différences entre compression avec pertes (lossy) et sans pertes (lossless). Quand choisir JPEG, PNG, WebP ou AVIF selon votre cas d'usage.",
     "Compression"),
    ("tailles-images-reseaux-sociaux-2026",
     "Tailles images réseaux sociaux 2026 : guide complet | imgpact",
     "Toutes les dimensions d'images pour Instagram, Facebook, YouTube, LinkedIn, TikTok en 2026. Tableau récapitulatif mis à jour.",
     "Réseaux sociaux"),
    ("images-produits-ecommerce",
     "Images produits e-commerce : guide complet pour convertir | imgpact",
     "Comment optimiser vos images produits pour l'e-commerce : dimensions, formats, fond blanc, zoom, alt text. Guide complet pour augmenter les conversions.",
     "E-commerce"),
    ("jpeg-vs-png",
     "JPEG vs PNG : lequel choisir pour votre projet ? | imgpact",
     "JPEG ou PNG : quelles différences techniques, quels cas d'usage ? Comparatif complet pour choisir le bon format image selon votre situation.",
     "Formats d'image"),
    ("format-avif",
     "Qu'est-ce que le format AVIF ? Guide complet 2026 | imgpact",
     "AVIF : le format image du futur. 50% plus léger que JPEG, HDR, transparence. Compatibilité navigateurs, cas d'usage et comment l'utiliser dès maintenant.",
     "Formats d'image"),
    ("svg-pour-le-web",
     "SVG pour le web : guide complet des images vectorielles | imgpact",
     "Tout sur le format SVG : quand l'utiliser, inline vs img, optimisation SVGO, animations, accessibilité. Guide pratique pour les développeurs web.",
     "Formats d'image"),
    ("format-heic",
     "Format HEIC : tout ce qu'il faut savoir (et comment le convertir) | imgpact",
     "HEIC : le format photo Apple 2× plus léger que JPEG. Pourquoi il ne s'ouvre pas partout et comment convertir vos HEIC en JPG facilement.",
     "Formats d'image"),
    ("lazy-loading-images",
     "Lazy loading des images : guide complet et bonnes pratiques | imgpact",
     "Comment implémenter le lazy loading des images en HTML, JavaScript et avec IntersectionObserver. Améliorer le temps de chargement et les Core Web Vitals.",
     "Optimisation web"),
    ("images-core-web-vitals",
     "Images et Core Web Vitals : optimiser LCP, CLS et FID | imgpact",
     "Comment les images impactent vos Core Web Vitals Google (LCP, CLS). Optimisations concrètes pour améliorer votre score PageSpeed et votre SEO.",
     "Optimisation web"),
    ("cdn-images-comparatif",
     "CDN images 2026 : quel service choisir ? Comparatif complet | imgpact",
     "Comparatif des CDN images en 2026 : Cloudflare, Cloudinary, ImageKit, imgix, Bunny.net. Fonctionnalités, tarifs et cas d'usage pour chaque service.",
     "Optimisation web"),
    ("responsive-images-srcset-sizes",
     "Images responsive avec srcset et sizes : guide technique | imgpact",
     "Maîtriser srcset, sizes et l'élément picture HTML pour servir la bonne image selon l'écran. Exemples pratiques et erreurs courantes à éviter.",
     "Optimisation web"),
    ("compresser-sans-perdre-qualite",
     "Compresser une image sans perdre en qualité : techniques 2026 | imgpact",
     "Comment compresser vos images sans dégradation visible : compression lossless, optimisation des métadonnées, outils gratuits et automatisation.",
     "Compression"),
    ("reduire-poids-gif",
     "Réduire le poids d'un GIF animé : techniques et alternatives | imgpact",
     "Comment réduire la taille d'un GIF animé : palette de couleurs, FPS, dimensions, lossy GIF. Et quand remplacer le GIF par WebP ou MP4.",
     "Compression"),
    ("optimiser-images-email",
     "Optimiser les images pour les emails : guide complet | imgpact",
     "Images dans les emails : tailles recommandées, formats (JPEG vs PNG), compatibilité Outlook et Gmail, GIF animés, alt text. Checklist complète.",
     "Compression"),
    ("compression-webp-vs-jpeg",
     "Compression WebP vs JPEG : comparatif chiffré | imgpact",
     "WebP est-il vraiment 30% plus léger que JPEG ? Analyse technique avec chiffres réels, cas d'usage et stratégie de migration vers WebP.",
     "Compression"),
    ("dimensions-images-instagram",
     "Dimensions des images Instagram en 2026 : guide complet | imgpact",
     "Toutes les tailles d'images Instagram en 2026 : feed carré, paysage, portrait, Stories, Reels, profil, carrousel. Tableau récapitulatif mis à jour.",
     "Réseaux sociaux"),
    ("dimensions-images-facebook",
     "Dimensions des images Facebook en 2026 : guide complet | imgpact",
     "Toutes les tailles d'images Facebook en 2026 : cover, profil, post, Story, événement, publicité. Tableau récapitulatif mis à jour.",
     "Réseaux sociaux"),
    ("taille-banniere-youtube",
     "Taille bannière YouTube et miniatures 2026 : guide complet | imgpact",
     "Dimensions bannière YouTube (2560×1440px), miniatures (1280×720px), photo de profil. Guide complet pour une chaîne YouTube bien optimisée.",
     "Réseaux sociaux"),
    ("images-linkedin-optimales",
     "Dimensions images LinkedIn optimales en 2026 | imgpact",
     "Toutes les tailles d'images LinkedIn en 2026 : profil, bannière, post, article, page entreprise, carrousel. Guide complet mis à jour.",
     "Réseaux sociaux"),
    ("images-shopify",
     "Images Shopify : formats, tailles et optimisation complète | imgpact",
     "Guide complet des images Shopify : dimensions recommandées, conversion WebP automatique, optimisation SEO, alt text et apps indispensables.",
     "E-commerce"),
    ("amazon-product-images",
     "Images Amazon : exigences techniques et bonnes pratiques | imgpact",
     "Tout sur les images Amazon : fond blanc obligatoire, 2000px minimum pour le zoom, formats acceptés, raisons de rejet et optimisation pour le SEO Amazon.",
     "E-commerce"),
    ("photos-produit-fond-blanc",
     "Photos produit sur fond blanc : techniques DIY et outils | imgpact",
     "Comment réaliser des photos produit sur fond blanc parfaites : setup DIY, retouche Lightroom/Photoshop, outils IA de suppression de fond.",
     "E-commerce"),
    ("zoom-produit-interactif",
     "Zoom produit interactif : implémentation et bonnes pratiques | imgpact",
     "Comment implémenter un zoom produit interactif pour booster les conversions : librairies JS, CSS, taille d'image requise, mobile vs desktop.",
     "E-commerce"),
];

static GUIDE_META_EN: &[(&str, &str, &str, &str)] = &[
    ("formats-image", "Web Image Formats: JPEG, PNG, WebP, AVIF, SVG. Complete Guide | imgpact", "Understanding web image formats in 2026: JPEG, PNG, WebP, AVIF, GIF, SVG. When to use each format for best performance.", "Image Formats"),
    ("optimiser-images-site-web", "Optimize Website Images: Complete 2026 Guide | imgpact", "How to optimize images for the web: formats, compression, lazy loading, CDN, Core Web Vitals. Complete performance guide.", "Web Optimization"),
    ("compression-image-lossy-lossless", "Image Compression: Lossy vs Lossless Explained | imgpact", "Differences between lossy and lossless compression. When to choose JPEG, PNG, WebP or AVIF for your use case.", "Compression"),
    ("tailles-images-reseaux-sociaux-2026", "Social Media Image Sizes 2026: Complete Guide | imgpact", "All social media image dimensions for Instagram, Facebook, YouTube, LinkedIn, TikTok in 2026. Updated reference table.", "Social Media"),
    ("images-produits-ecommerce", "E-commerce Product Images: Complete Conversion Guide | imgpact", "How to optimize product images for e-commerce: dimensions, formats, white background, zoom, alt text. Complete guide.", "E-commerce"),
    ("jpeg-vs-png", "JPEG vs PNG: Which to Choose for Your Project? | imgpact", "JPEG or PNG: technical differences and use cases. Complete comparison to choose the right image format.", "Image Formats"),
    ("format-avif", "What is AVIF? Complete Guide 2026 | imgpact", "AVIF: the future image format. 50% lighter than JPEG, HDR, transparency. Browser support, use cases, and how to use it now.", "Image Formats"),
    ("svg-pour-le-web", "SVG for the Web: Complete Vector Images Guide | imgpact", "Everything about SVG: when to use it, inline vs img, SVGO optimization, animations, accessibility. Practical guide for web developers.", "Image Formats"),
    ("format-heic", "HEIC Format: Everything You Need to Know (and How to Convert) | imgpact", "HEIC: Apple's photo format, 2× lighter than JPEG. Why it doesn't open everywhere and how to convert HEIC to JPG easily.", "Image Formats"),
    ("lazy-loading-images", "Image Lazy Loading: Complete Guide and Best Practices | imgpact", "How to implement image lazy loading in HTML, JavaScript and IntersectionObserver. Improve load time and Core Web Vitals.", "Web Optimization"),
    ("images-core-web-vitals", "Images and Core Web Vitals: Optimize LCP, CLS and FID | imgpact", "How images impact your Google Core Web Vitals (LCP, CLS). Concrete optimizations to improve your PageSpeed score and SEO.", "Web Optimization"),
    ("cdn-images-comparatif", "Image CDN 2026: Which Service to Choose? Full Comparison | imgpact", "Image CDN comparison 2026: Cloudflare, Cloudinary, ImageKit, imgix, Bunny.net. Features, pricing and use cases for each service.", "Web Optimization"),
    ("responsive-images-srcset-sizes", "Responsive Images with srcset and sizes: Technical Guide | imgpact", "Master srcset, sizes and the HTML picture element to serve the right image per screen. Practical examples and common mistakes.", "Web Optimization"),
    ("compresser-sans-perdre-qualite", "Compress Images Without Quality Loss: 2026 Techniques | imgpact", "How to compress images without visible degradation: lossless compression, metadata optimization, free tools and automation.", "Compression"),
    ("reduire-poids-gif", "Reduce Animated GIF Size: Techniques and Alternatives | imgpact", "How to reduce animated GIF file size: color palette, FPS, dimensions, lossy GIF. And when to replace GIF with WebP or MP4.", "Compression"),
    ("optimiser-images-email", "Optimize Images for Email: Complete Guide | imgpact", "Email images: recommended sizes, formats (JPEG vs PNG), Outlook and Gmail compatibility, animated GIFs, alt text. Full checklist.", "Compression"),
    ("compression-webp-vs-jpeg", "WebP vs JPEG Compression: Data-Backed Comparison | imgpact", "Is WebP really 30% lighter than JPEG? Technical analysis with real numbers, use cases and migration strategy to WebP.", "Compression"),
    ("dimensions-images-instagram", "Instagram Image Dimensions 2026: Complete Guide | imgpact", "All Instagram image sizes in 2026: square, landscape, portrait, Stories, Reels, profile, carousel. Updated reference table.", "Social Media"),
    ("dimensions-images-facebook", "Facebook Image Dimensions 2026: Complete Guide | imgpact", "All Facebook image sizes in 2026: cover, profile, post, Story, event, advertising. Updated reference table.", "Social Media"),
    ("taille-banniere-youtube", "YouTube Banner Size and Thumbnails 2026: Complete Guide | imgpact", "YouTube banner and thumbnail sizes 2026: total canvas, safe zone, pixel coordinates. Complete visual guide.", "Social Media"),
    ("images-linkedin-optimales", "Optimal LinkedIn Images 2026: Complete Guide | imgpact", "All LinkedIn image dimensions 2026: profile, banner, post, ads. Best-performing sizes for maximum engagement.", "Social Media"),
    ("images-shopify", "Shopify Image Sizes 2026: Complete Optimization Guide | imgpact", "Shopify image sizes 2026: recommended dimensions, automatic WebP conversion, optimization tips for product pages.", "E-commerce"),
    ("amazon-product-images", "Amazon Product Images: Technical Requirements Guide | imgpact", "Amazon product image requirements: MAIN image specs, white background, 85% fill rule, no watermarks. Technical guide.", "E-commerce"),
    ("photos-produit-fond-blanc", "Product Photography on White Background: Complete Guide | imgpact", "DIY white background product photography: two-light setup, removing background in Photoshop, verifying pure white RGB.", "E-commerce"),
    ("zoom-produit-interactif", "Interactive Product Zoom: Implementation Guide | imgpact", "Interactive product zoom implementation: source size formula, CSS zoom, JS cursor tracking, lightbox, mobile considerations.", "E-commerce"),
];

static GUIDE_META_ES: &[(&str, &str, &str, &str)] = &[
    ("formats-image", "Formatos de imagen web: JPEG, PNG, WebP, AVIF, SVG, guía completa | imgpact", "Todo sobre los formatos de imagen web en 2026: JPEG, PNG, WebP, AVIF, GIF, SVG. Cuándo usar cada formato para el mejor rendimiento.", "Formatos de imagen"),
    ("optimiser-images-site-web", "Optimizar imágenes de sitios web: guía completa 2026 | imgpact", "Cómo optimizar imágenes para la web: formatos, compresión, lazy loading, CDN, Core Web Vitals. Guía completa de rendimiento.", "Optimización web"),
    ("compression-image-lossy-lossless", "Compresión de imagen: con pérdida vs sin pérdida | imgpact", "Diferencias entre compresión con pérdida y sin pérdida. Cuándo elegir JPEG, PNG, WebP o AVIF según tu caso de uso.", "Compresión"),
    ("tailles-images-reseaux-sociaux-2026", "Tamaños de imágenes en redes sociales 2026: guía completa | imgpact", "Todas las dimensiones de imágenes para Instagram, Facebook, YouTube, LinkedIn, TikTok en 2026. Tabla de referencia actualizada.", "Redes sociales"),
    ("images-produits-ecommerce", "Imágenes de productos e-commerce: guía completa | imgpact", "Cómo optimizar imágenes de producto para e-commerce: dimensiones, formatos, fondo blanco, zoom, alt text.", "E-commerce"),
    ("jpeg-vs-png", "JPEG vs PNG: ¿cuál elegir para tu proyecto? | imgpact", "JPEG o PNG: diferencias técnicas y casos de uso. Comparativa completa para elegir el formato de imagen adecuado.", "Formatos de imagen"),
    ("format-avif", "¿Qué es el formato AVIF? Guía completa 2026 | imgpact", "AVIF: el formato de imagen del futuro. Un 50% más ligero que JPEG, HDR, transparencia. Compatibilidad y cómo usarlo ahora.", "Formatos de imagen"),
    ("svg-pour-le-web", "SVG para la web: guía completa de imágenes vectoriales | imgpact", "Todo sobre SVG: cuándo usarlo, inline vs img, optimización SVGO, animaciones, accesibilidad. Guía práctica para desarrolladores.", "Formatos de imagen"),
    ("format-heic", "Formato HEIC: todo lo que debes saber (y cómo convertirlo) | imgpact", "HEIC: el formato de foto de Apple, 2× más ligero que JPEG. Por qué no abre en todas partes y cómo convertir HEIC a JPG.", "Formatos de imagen"),
    ("lazy-loading-images", "Lazy loading de imágenes: guía completa y buenas prácticas | imgpact", "Cómo implementar lazy loading en HTML, JavaScript e IntersectionObserver. Mejora el tiempo de carga y los Core Web Vitals.", "Optimización web"),
    ("images-core-web-vitals", "Imágenes y Core Web Vitals: optimizar LCP, CLS y FID | imgpact", "Cómo las imágenes afectan tus Core Web Vitals de Google (LCP, CLS). Optimizaciones concretas para mejorar PageSpeed y SEO.", "Optimización web"),
    ("cdn-images-comparatif", "CDN de imágenes 2026: ¿qué servicio elegir? Comparativa completa | imgpact", "Comparativa de CDN de imágenes 2026: Cloudflare, Cloudinary, ImageKit, imgix, Bunny.net. Características, precios y casos de uso.", "Optimización web"),
    ("responsive-images-srcset-sizes", "Imágenes responsive con srcset y sizes: guía técnica | imgpact", "Domina srcset, sizes y el elemento picture HTML para servir la imagen correcta según la pantalla. Ejemplos prácticos.", "Optimización web"),
    ("compresser-sans-perdre-qualite", "Comprimir imágenes sin perder calidad: técnicas 2026 | imgpact", "Cómo comprimir imágenes sin degradación visible: compresión sin pérdida, optimización de metadatos, herramientas gratuitas.", "Compresión"),
    ("reduire-poids-gif", "Reducir el tamaño de un GIF animado: técnicas y alternativas | imgpact", "Cómo reducir el tamaño de un GIF animado: paleta de colores, FPS, dimensiones, lossy GIF. Y cuándo reemplazar el GIF por WebP o MP4.", "Compresión"),
    ("optimiser-images-email", "Optimizar imágenes para correo electrónico: guía completa | imgpact", "Imágenes en emails: tamaños recomendados, formatos (JPEG vs PNG), compatibilidad Outlook y Gmail, GIF animados, alt text.", "Compresión"),
    ("compression-webp-vs-jpeg", "Compresión WebP vs JPEG: comparativa con datos reales | imgpact", "¿Es WebP realmente un 30% más ligero que JPEG? Análisis técnico con cifras reales, casos de uso y estrategia de migración.", "Compresión"),
    ("dimensions-images-instagram", "Dimensiones de imágenes en Instagram 2026: guía completa | imgpact", "Todos los tamaños de imágenes de Instagram en 2026: cuadrado, paisaje, retrato, Stories, Reels, perfil, carrusel.", "Redes sociales"),
    ("dimensions-images-facebook", "Dimensiones de imágenes en Facebook 2026: guía completa | imgpact", "Todos los tamaños de imágenes de Facebook en 2026: portada, perfil, publicación, Story, evento, publicidad.", "Redes sociales"),
    ("taille-banniere-youtube", "Tamaño de banner de YouTube y miniaturas 2026: guía completa | imgpact", "Dimensiones del banner y miniaturas de YouTube 2026: lienzo total, zona segura, coordenadas. Guía visual completa.", "Redes sociales"),
    ("images-linkedin-optimales", "Imágenes óptimas en LinkedIn 2026: guía completa | imgpact", "Todas las dimensiones de imágenes de LinkedIn 2026: perfil, banner, publicación, anuncios. Tamaños para máximo engagement.", "Redes sociales"),
    ("images-shopify", "Tamaños de imágenes en Shopify 2026: guía de optimización completa | imgpact", "Tamaños de imágenes en Shopify 2026: dimensiones recomendadas, conversión automática a WebP, consejos de optimización.", "E-commerce"),
    ("amazon-product-images", "Imágenes de producto en Amazon: guía de requisitos técnicos | imgpact", "Requisitos de imágenes de producto en Amazon: especificaciones MAIN, fondo blanco, regla del 85%, sin marcas de agua.", "E-commerce"),
    ("photos-produit-fond-blanc", "Fotografía de producto sobre fondo blanco: guía completa | imgpact", "Fotografía DIY con fondo blanco: configuración con dos luces, eliminar fondo en Photoshop, verificar blanco puro RGB.", "E-commerce"),
    ("zoom-produit-interactif", "Zoom interactivo de producto: guía de implementación | imgpact", "Implementación de zoom interactivo de producto: fórmula de tamaño fuente, zoom CSS, seguimiento de cursor JS, lightbox, móvil.", "E-commerce"),
];

static GUIDE_META_RU: &[(&str, &str, &str, &str)] = &[
    ("formats-image", "Форматы веб-изображений: JPEG, PNG, WebP, AVIF, SVG. полное руководство | imgpact", "Всё о форматах веб-изображений в 2026 году: JPEG, PNG, WebP, AVIF, GIF, SVG. Когда использовать каждый формат для лучшей производительности.", "Форматы изображений"),
    ("optimiser-images-site-web", "Оптимизация изображений сайта: полное руководство 2026 | imgpact", "Как оптимизировать изображения для веба: форматы, сжатие, отложенная загрузка, CDN, Core Web Vitals. Полное руководство.", "Веб-оптимизация"),
    ("compression-image-lossy-lossless", "Сжатие изображений: с потерями и без потерь | imgpact", "Различия между сжатием с потерями и без потерь. Когда выбирать JPEG, PNG, WebP или AVIF для вашего случая использования.", "Сжатие"),
    ("tailles-images-reseaux-sociaux-2026", "Размеры изображений в социальных сетях 2026: полное руководство | imgpact", "Все размеры изображений для Instagram, Facebook, YouTube, LinkedIn, TikTok в 2026 году. Обновлённая справочная таблица.", "Социальные сети"),
    ("images-produits-ecommerce", "Изображения товаров для e-commerce: полное руководство | imgpact", "Как оптимизировать изображения товаров для интернет-магазина: размеры, форматы, белый фон, зум, alt-текст.", "Электронная коммерция"),
    ("jpeg-vs-png", "JPEG vs PNG: что выбрать для вашего проекта? | imgpact", "JPEG или PNG: технические различия и сценарии использования. Полное сравнение для выбора правильного формата изображения.", "Форматы изображений"),
    ("format-avif", "Что такое формат AVIF? Полное руководство 2026 | imgpact", "AVIF: формат изображений будущего. На 50% легче JPEG, HDR, прозрачность. Поддержка браузерами и как использовать его сейчас.", "Форматы изображений"),
    ("svg-pour-le-web", "SVG для веба: полное руководство по векторным изображениям | imgpact", "Всё о SVG: когда использовать, inline vs img, оптимизация SVGO, анимации, доступность. Практическое руководство.", "Форматы изображений"),
    ("format-heic", "Формат HEIC: всё что нужно знать (и как конвертировать) | imgpact", "HEIC: формат фото Apple, в 2× легче JPEG. Почему он не открывается везде и как легко конвертировать HEIC в JPG.", "Форматы изображений"),
    ("lazy-loading-images", "Отложенная загрузка изображений: полное руководство | imgpact", "Как реализовать отложенную загрузку в HTML, JavaScript и IntersectionObserver. Улучшение времени загрузки и Core Web Vitals.", "Веб-оптимизация"),
    ("images-core-web-vitals", "Изображения и Core Web Vitals: оптимизация LCP, CLS и FID | imgpact", "Как изображения влияют на Core Web Vitals Google (LCP, CLS). Конкретные оптимизации для улучшения PageSpeed и SEO.", "Веб-оптимизация"),
    ("cdn-images-comparatif", "CDN изображений 2026: какой сервис выбрать? Полное сравнение | imgpact", "Сравнение CDN изображений 2026: Cloudflare, Cloudinary, ImageKit, imgix, Bunny.net. Функции, цены и сценарии использования.", "Веб-оптимизация"),
    ("responsive-images-srcset-sizes", "Адаптивные изображения с srcset и sizes: техническое руководство | imgpact", "Освойте srcset, sizes и элемент picture HTML для подачи нужного изображения под каждый экран. Практические примеры.", "Веб-оптимизация"),
    ("compresser-sans-perdre-qualite", "Сжатие изображений без потери качества: методы 2026 | imgpact", "Как сжимать изображения без видимой деградации: сжатие без потерь, оптимизация метаданных, бесплатные инструменты.", "Сжатие"),
    ("reduire-poids-gif", "Уменьшение размера анимированного GIF: методы и альтернативы | imgpact", "Как уменьшить размер анимированного GIF: палитра цветов, FPS, размеры, lossy GIF. И когда заменить GIF на WebP или MP4.", "Сжатие"),
    ("optimiser-images-email", "Оптимизация изображений для email: полное руководство | imgpact", "Изображения в email: рекомендуемые размеры, форматы (JPEG vs PNG), совместимость с Outlook и Gmail, анимированные GIF.", "Сжатие"),
    ("compression-webp-vs-jpeg", "Сжатие WebP vs JPEG: сравнение с реальными данными | imgpact", "Действительно ли WebP на 30% легче JPEG? Технический анализ с реальными числами, сценарии использования и стратегия миграции.", "Сжатие"),
    ("dimensions-images-instagram", "Размеры изображений Instagram 2026: полное руководство | imgpact", "Все размеры изображений Instagram в 2026 году: квадрат, горизонталь, вертикаль, Stories, Reels, профиль, карусель.", "Социальные сети"),
    ("dimensions-images-facebook", "Размеры изображений Facebook 2026: полное руководство | imgpact", "Все размеры изображений Facebook в 2026 году: обложка, профиль, публикация, Story, событие, реклама.", "Социальные сети"),
    ("taille-banniere-youtube", "Размер баннера YouTube и миниатюр 2026: полное руководство | imgpact", "Размеры баннера и миниатюр YouTube 2026: общий холст, безопасная зона, координаты. Полное визуальное руководство.", "Социальные сети"),
    ("images-linkedin-optimales", "Оптимальные изображения LinkedIn 2026: полное руководство | imgpact", "Все размеры изображений LinkedIn 2026: профиль, баннер, публикация, реклама. Лучшие размеры для максимального охвата.", "Социальные сети"),
    ("images-shopify", "Размеры изображений Shopify 2026: полное руководство по оптимизации | imgpact", "Размеры изображений Shopify 2026: рекомендуемые размеры, автоматическая конвертация в WebP, советы по оптимизации.", "Электронная коммерция"),
    ("amazon-product-images", "Изображения товаров Amazon: руководство по техническим требованиям | imgpact", "Требования к изображениям товаров Amazon: характеристики MAIN, белый фон, правило 85%, без водяных знаков.", "Электронная коммерция"),
    ("photos-produit-fond-blanc", "Фотография товара на белом фоне: полное руководство | imgpact", "DIY фотография с белым фоном: двухсветовая схема, удаление фона в Photoshop, проверка чистого белого RGB.", "Электронная коммерция"),
    ("zoom-produit-interactif", "Интерактивный зум товара: руководство по реализации | imgpact", "Реализация интерактивного зума товара: формула размера источника, CSS зум, отслеживание курсора JS, лайтбокс, мобильные.", "Электронная коммерция"),
];

// ─── Convert page metadata ─────────────────────────────────────────────────
// (format, label, accept_types, page_title, meta_description)
static CONVERT_PAGE_META: &[(&str, &str, &str, &str, &str)] = &[
    ("png",  "PNG",  ".png,image/png",
     "Convert PNG - Free Online PNG Converter | imgpact",
     "Convert PNG to JPG, WebP, GIF, AVIF, and more. Free, no signup, runs in your browser."),
    ("jpg",  "JPG",  ".jpg,.jpeg,image/jpeg",
     "Convert JPG - Free Online JPG Converter | imgpact",
     "Convert JPG to PNG, WebP, GIF, AVIF, and more. Free, no signup, runs in your browser."),
    ("webp", "WebP", ".webp,image/webp",
     "Convert WebP - Free Online WebP Converter | imgpact",
     "Convert WebP to PNG, JPG, GIF, AVIF, and more. Free, no signup, runs in your browser."),
    ("gif",  "GIF",  ".gif,image/gif",
     "Convert GIF - Free Online GIF Converter | imgpact",
     "Convert GIF to PNG, JPG, WebP, MP4, and more. Free, no signup, runs in your browser."),
    ("svg",  "SVG",  ".svg,image/svg+xml",
     "Convert SVG - Free Online SVG Converter | imgpact",
     "Convert SVG to PNG, JPG, WebP, and more. Free rasterization, runs in your browser."),
    ("avif", "AVIF", ".avif,image/avif",
     "Convert AVIF - Free Online AVIF Converter | imgpact",
     "Convert AVIF to JPG, PNG, WebP, GIF, and more. Free, no signup, runs in your browser."),
    ("heic", "HEIC", ".heic,.heif,image/heic,image/heif",
     "Convert HEIC - Free Online HEIC to JPG Converter | imgpact",
     "Convert iPhone HEIC photos to JPG, PNG, WebP, and more. Free, no signup, runs in your browser."),
    ("tiff", "TIFF", ".tif,.tiff,image/tiff",
     "Convert TIFF - Free Online TIFF Converter | imgpact",
     "Convert TIFF to JPG, PNG, WebP, AVIF, and more. Free, no signup, runs in your browser."),
    ("bmp",  "BMP",  ".bmp,image/bmp",
     "Convert BMP - Free Online BMP Converter | imgpact",
     "Convert BMP to JPG, PNG, WebP, AVIF, and more. Free, no signup, runs in your browser."),
];

// ─── Target format lists per source ───────────────────────────────────────
static CONVERT_PAGE_TARGETS: &[(&str, &[&str])] = &[
    ("png",  &["jpg", "webp", "gif", "bmp", "ico", "avif", "tiff", "svg"]),
    ("jpg",  &["png", "webp", "gif", "bmp", "ico", "avif", "tiff", "svg"]),
    ("webp", &["png", "jpg", "gif", "bmp", "ico", "avif", "tiff", "svg"]),
    ("gif",  &["png", "jpg", "webp", "bmp", "ico", "avif", "tiff", "svg"]),
    ("svg",  &["png", "jpg", "webp", "gif", "bmp", "ico", "avif", "tiff"]),
    ("avif", &["jpg", "png", "webp", "gif", "bmp", "ico", "tiff"]),
    ("heic", &["jpg", "png", "webp", "avif", "gif", "bmp", "tiff"]),
    ("tiff", &["jpg", "png", "webp", "avif", "gif", "bmp", "ico"]),
    ("bmp",  &["jpg", "png", "webp", "avif", "gif", "ico", "tiff"]),
];

// ─── Display labels for all target formats ────────────────────────────────
static FORMAT_LABELS: &[(&str, &str)] = &[
    ("png", "PNG"), ("jpg", "JPG"), ("webp", "WebP"), ("gif", "GIF"),
    ("bmp", "BMP"), ("ico", "ICO"), ("avif", "AVIF"), ("tiff", "TIFF"),
    ("heic", "HEIC"), ("svg", "SVG (embedded)"),
];

#[derive(Serialize)]
struct FormatOption {
    value: String,
    label: String,
}

// ─── Tool metadata for SEO context ────────────────────────────────────────
// (slug, page_title, meta_description)
static TOOL_META: &[(&str, &str, &str)] = &[
    ("gif-maker",    "GIF Maker - Create Animated GIFs Online for Free | imgpact",    "Create animated GIFs from images or video frames. Drag-and-drop frames, set delays, preview instantly. Free, no upload."),
    ("gif-editor",   "GIF Editor - Edit Animated GIFs Online for Free | imgpact",    "Edit animated GIFs: reorder frames, adjust timing, crop, rotate, flip, reverse, change speed. Free, in-browser."),
    ("gif-split",    "GIF Split - Extract GIF Frames Online | imgpact",              "Extract individual frames from animated GIFs as PNG images. Download all as ZIP. Free browser tool."),
    ("gif-analyzer", "GIF Analyzer - Inspect GIF Metadata Online | imgpact",         "Analyze GIF frame timing, dimensions, loop count and metadata. Free, no upload required."),
    ("video-to-gif", "Video to GIF Converter - Free Online | imgpact",               "Convert MP4, WebM, MOV video clips to animated GIFs with custom frame rate and size. Free, browser-based."),
    ("gif-to-mp4",   "GIF to MP4 Converter - Free Online | imgpact",                 "Convert animated GIFs to MP4 video. Smaller file, wider compatibility. Free, runs in your browser."),
    ("gif-to-webm",  "GIF to WebM Converter - Free Online | imgpact",                "Convert animated GIFs to WebM video. Excellent compression for the web. Free browser tool."),
    ("gif-to-mov",   "GIF to MOV Converter - Free Online | imgpact",                 "Convert animated GIFs to QuickTime MOV format. Free, browser-based with FFmpeg.wasm."),
    ("crop",         "Crop Image - Free Online Crop Tool | imgpact",                  "Crop images to any size or aspect ratio with visual drag handles. Free, no upload required."),
    ("resize",       "Resize Image - Free Online Resize Tool | imgpact",              "Resize images by pixels or percentage. Aspect ratio lock, multiple resampling filters. Free browser tool."),
    ("optimize",     "Optimize Images - Free Online Batch Optimizer | imgpact",       "Compress PNG, JPG, WebP images without visible quality loss. Unlimited batch processing. Free, runs in your browser."),
    ("effects",      "Image Effects - Apply Filters Online Free | imgpact",           "Apply grayscale, sepia, blur, sharpen, brightness and more. Stack multiple effects. Free browser tool."),
    ("transform",    "Transform Image - Rotate & Flip Online Free | imgpact",         "Rotate and flip images instantly. Chain multiple transforms. Free, runs entirely in your browser."),
    ("add-text",     "Add Text to Image - Free Online Tool | imgpact",               "Overlay custom text on images. Choose font size, color, position. Free, no signup required."),
];

fn translated_tool_name(en_slug: &str, lang: Lang) -> String {
    let t = get_translations(lang);
    match en_slug {
        "resize"       => t.tool_resize_title.to_string(),
        "crop"         => t.tool_crop_title.to_string(),
        "optimize"     => t.tool_optimize_title.to_string(),
        "effects"      => t.tool_effects_title.to_string(),
        "add-text"     => t.tool_add_text_title.to_string(),
        "transform"    => t.tool_transform_title.to_string(),
        "gif-editor"   => t.tool_gif_editor_title.to_string(),
        "gif-split"    => t.tool_gif_split_title.to_string(),
        "gif-analyzer" => t.tool_gif_analyzer_title.to_string(),
        "gif-maker"    => t.nav_gif_maker.to_string(),
        "video-to-gif" => t.nav_video_to_gif.to_string(),
        "gif-to-mp4"   => "GIF to MP4".to_string(),
        "gif-to-webm"  => "GIF to WebM".to_string(),
        "gif-to-mov"   => "GIF to MOV".to_string(),
        _              => en_slug.to_string(),
    }
}

// ─── App state ────────────────────────────────────────────────────────────
type AppState = Arc<StatsDb>;

// ─── /api/track ───────────────────────────────────────────────────────────
#[derive(serde::Deserialize)]
struct TrackEvent {
    tool: String,
    session_id: String,
}

async fn api_track(
    State(db): State<AppState>,
    Json(payload): Json<TrackEvent>,
) -> StatusCode {
    // Validate tool slug
    let tool = payload.tool.as_str();
    let valid_tool = TOOL_SLUGS.contains(&tool)
        || CONVERT_SLUGS.iter().any(|&fmt| tool == format!("convert-{}", fmt));
    if !valid_tool { return StatusCode::BAD_REQUEST; }
    // Validate session_id: 1–64 chars, alphanumeric + hyphens only
    let sid = payload.session_id.as_str();
    if sid.is_empty() || sid.len() > 64 || !sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return StatusCode::BAD_REQUEST;
    }
    match db.record(tool, sid) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// ─── /api/stats ───────────────────────────────────────────────────────────
async fn api_stats(State(db): State<AppState>) -> impl IntoResponse {
    match db.get_stats() {
        Ok(data) => (StatusCode::OK, Json(data)).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// ─── /{lang}/stats ────────────────────────────────────────────────────────
#[derive(Serialize)]
struct ToolStatDisplay {
    display_name: String,
    slug: String,
    uses: i64,
    unique_users: i64,
    icon: &'static str,
}

#[derive(Serialize)]
struct StatGroup {
    name: String,
    color: &'static str,
    icon: &'static str,
    tools: Vec<ToolStatDisplay>,
}

fn tool_display_name(slug: &str, lang: Lang) -> String {
    if let Some(fmt) = slug.strip_prefix("convert-") {
        return format!("{} {}", fmt.to_uppercase(), get_translations(lang).label_converter);
    }
    translated_tool_name(slug, lang)
}

fn tool_icon(slug: &str) -> &'static str {
    match slug {
        "convert-png" | "convert-jpg" | "convert-webp" | "convert-gif" | "convert-svg"
        | "convert-avif" | "convert-heic" | "convert-tiff" | "convert-bmp"
            => "arrow-right-left",
        "crop"        => "crop",
        "resize"      => "scaling",
        "optimize"    => "zap",
        "effects"     => "wand-2",
        "add-text"    => "type",
        "transform"   => "rotate-cw",
        "gif-maker"   => "film",
        "gif-editor"  => "sliders-horizontal",
        "gif-split"   => "scissors",
        "gif-analyzer"=> "bar-chart-2",
        "video-to-gif"=> "video",
        "gif-to-mp4"  => "play-circle",
        "gif-to-webm" => "play-circle",
        "gif-to-mov"  => "play-circle",
        _             => "tool",
    }
}

async fn lang_stats_page(
    Path(lang_code): Path<String>,
    headers: HeaderMap,
    State(db): State<AppState>,
) -> Html<String> {
    let lang = lang_from_code(&lang_code).unwrap_or_else(|| detect_lang(&headers));
    let tera = get_tera();
    let t = get_translations(lang);
    let mut ctx = base_context_lang("", lang);
    ctx.insert("canonical_url", &format!("https://imgpact.com/{}/stats", lang.code()));
    ctx.insert("page_title", &format!("{} | imgpact", t.stats_title));
    ctx.insert("meta_description", t.stats_subtitle);

    let stats_data = db.get_stats().unwrap_or(stats::StatsData {
        total_uses: 0,
        total_unique_users: 0,
        tools: vec![],
    });

    let make_rows = |slugs: &[&str]| -> Vec<ToolStatDisplay> {
        slugs.iter().map(|&slug| {
            let db_entry = stats_data.tools.iter().find(|t| t.tool == slug);
            ToolStatDisplay {
                display_name: tool_display_name(slug, lang),
                slug:         slug.to_string(),
                uses:         db_entry.map(|t| t.uses).unwrap_or(0),
                unique_users: db_entry.map(|t| t.unique_users).unwrap_or(0),
                icon:         tool_icon(slug),
            }
        }).collect()
    };

    let t = get_translations(lang);
    let groups = vec![
        StatGroup {
            name:  t.sidebar_convert.to_string(),
            color: "convert",
            icon:  "arrow-right-left",
            tools: make_rows(&["convert-png","convert-jpg","convert-webp","convert-gif","convert-svg","convert-avif","convert-heic","convert-tiff","convert-bmp"]),
        },
        StatGroup {
            name:  t.sidebar_image.to_string(),
            color: "image",
            icon:  "image",
            tools: make_rows(&["crop","resize","optimize","effects","add-text","transform"]),
        },
        StatGroup {
            name:  t.sidebar_gif.to_string(),
            color: "gif",
            icon:  "film",
            tools: make_rows(&["gif-maker","gif-editor","gif-split","gif-analyzer","video-to-gif","gif-to-mp4","gif-to-webm","gif-to-mov"]),
        },
    ];

    ctx.insert("total_uses", &stats_data.total_uses);
    ctx.insert("total_unique_users", &stats_data.total_unique_users);
    ctx.insert("groups", &groups);

    if tera.get_template_names().any(|n| n == "stats.html") {
        Html(tera.render("stats.html", &ctx).unwrap_or_else(|_| "<h1>500</h1>".to_string()))
    } else {
        Html("<h1>Stats page coming soon</h1>".to_string())
    }
}

fn build_tera() -> Tera {
    // Paths are relative to the working directory.
    // Always run the server from the workspace root (G:\imgpact.com\):
    //   cargo run -p server          ← development
    //   cargo run -p server --release ← production
    //   ./build.sh dev / ./build.sh prod
    let mut tera = Tera::new("templates/**/*.html").unwrap_or_else(|e| {
        eprintln!(
            "ERROR: Failed to load templates: {}\n\
             Run the server from the workspace root, not from server/.\n\
             Current working directory: {}",
            e,
            std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "<unknown>".into())
        );
        std::process::exit(1);
    });
    tera.autoescape_on(vec![]);
    tera
}

fn base_context_lang(slug: &str, lang: Lang) -> Context {
    let t = get_translations(lang);
    let mut ctx = Context::new();
    ctx.insert("active_tool", slug);
    ctx.insert("tool_slug", slug);
    ctx.insert("lang", lang.code());
    ctx.insert("html_lang", lang.html_lang());
    ctx.insert("t", &t);
    let canonical = if slug.is_empty() {
        "https://imgpact.com/".to_string()
    } else {
        format!("https://imgpact.com/tools/{}", slug)
    };
    ctx.insert("canonical_url", &canonical);
    ctx.insert("og_title",       t.site_title);
    ctx.insert("og_description", "Free image, GIF & video tools that run in your browser. No upload, no signup, no limits.");
    ctx.insert("og_image",       "https://imgpact.com/static/img/og-image.png");

    // ── Localised section words ────────────────────────────────────────────
    let ts = section_tools(lang);
    let gs = section_guides(lang);
    let cs = section_convert(lang);
    ctx.insert("tools_section",   ts);
    ctx.insert("guides_section",  gs);
    ctx.insert("convert_section", cs);

    // ── Per-tool URL context variables ────────────────────────────────────
    for &(en, fr, es) in TOOL_SLUG_MAP {
        let url_slug = match lang { Lang::Fr => fr, Lang::Es => es, _ => en };
        let var = format!("url_{}", en.replace('-', "_"));
        ctx.insert(&var, &format!("/{}/{}/{}", lang.code(), ts, url_slug));
    }

    // ── Convert page URL context variables ───────────────────────────────
    for &fmt in CONVERT_SLUGS {
        let var = format!("url_convert_{}", fmt);
        ctx.insert(&var, &format!("/{}/{}/{}/{}", lang.code(), ts, cs, fmt));
    }

    // ── Guides section URL ────────────────────────────────────────────────
    ctx.insert("url_guides", &format!("/{}/{}", lang.code(), gs));

    // ── Per-lang URLs for the current tool (used by language switcher JS) ─
    if !slug.is_empty() {
        let mut parts = Vec::new();
        for &l in &[Lang::En, Lang::Fr, Lang::Es, Lang::Ru] {
            let url = if let Some(fmt) = slug.strip_prefix("convert-") {
                format!("/{}/{}/{}/{}", l.code(), section_tools(l), section_convert(l), fmt)
            } else {
                format!("/{}/{}/{}", l.code(), section_tools(l), tool_url_slug(slug, l))
            };
            parts.push(format!("\"{}\":\"{}\"", l.code(), url));
        }
        ctx.insert("tool_urls_json", &format!("{{{}}}", parts.join(",")));
    }

    ctx
}

fn base_context(slug: &str, headers: &HeaderMap) -> Context {
    base_context_lang(slug, detect_lang(headers))
}

/// Inserts format-specific translated strings into a convert page context.
fn add_convert_ctx(ctx: &mut Context, lang: Lang, source_label: &str) {
    let t = get_translations(lang);
    let r = |s: &'static str| s.replace("{fmt}", source_label);
    ctx.insert("convert_h1",             &r(t.convert_page_h1));
    ctx.insert("convert_subtitle",       &r(t.convert_page_subtitle));
    ctx.insert("convert_drop_files",     &r(t.convert_drop_files));
    ctx.insert("convert_drop_hint",      &r(t.convert_drop_hint));
    ctx.insert("convert_seo_how_title",  &r(t.convert_seo_how_title));
    ctx.insert("convert_seo_about_title",&r(t.convert_seo_about_title));
    ctx.insert("convert_seo_step1",      &r(t.convert_seo_step1));
    ctx.insert("convert_seo_about",      &r(t.convert_seo_about));
}

async fn index(headers: HeaderMap) -> impl IntoResponse {
    let lang = detect_lang(&headers);
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, HeaderValue::from_str(&format!("/{}/", lang.code())).unwrap()),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
    )
}

async fn tool_page(Path(slug): Path<String>, headers: HeaderMap) -> Html<String> {
    if !is_valid_slug(&slug) {
        return Html("<h1>404 Not Found</h1>".to_string());
    }
    let tera = get_tera();
    let mut ctx = base_context(&slug, &headers);

    if let Some(meta) = TOOL_META.iter().find(|m| m.0 == slug) {
        ctx.insert("page_title",       meta.1);
        ctx.insert("meta_description", meta.2);
        ctx.insert("og_title",         meta.1);
        ctx.insert("og_description",   meta.2);
    }

    let template = format!("tools/{}.html", slug);
    let html = if tera.get_template_names().any(|n| n == template) {
        tera.render(&template, &ctx).unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string())
    } else {
        ctx.insert("tool_name", &slug.replace('-', " "));
        tera.render("tools/placeholder.html", &ctx).unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string())
    };
    Html(html)
}

async fn convert_page(Path(format): Path<String>, headers: HeaderMap) -> Html<String> {
    if !is_valid_slug(&format) {
        return Html("<h1>404 Not Found</h1>".to_string());
    }
    let tera = get_tera();
    let fmt = format.as_str();

    let meta = match CONVERT_PAGE_META.iter().find(|m| m.0 == fmt) {
        Some(m) => m,
        None => return Html("<h1>404 Not Found</h1>".to_string()),
    };

    let lang = detect_lang(&headers);
    let mut ctx = base_context(&format!("convert-{}", fmt), &headers);
    ctx.insert("source_format",     meta.0);
    ctx.insert("source_label",      meta.1);
    ctx.insert("accept_types",      meta.2);
    ctx.insert("title",             meta.3);
    ctx.insert("page_title",        meta.3);
    ctx.insert("meta_description",  meta.4);
    ctx.insert("og_title",          meta.3);
    ctx.insert("og_description",    meta.4);
    add_convert_ctx(&mut ctx, lang, meta.1);

    let target_slugs = CONVERT_PAGE_TARGETS.iter()
        .find(|t| t.0 == fmt)
        .map(|t| t.1)
        .unwrap_or(&[]);

    let target_formats: Vec<FormatOption> = FORMAT_LABELS.iter()
        .filter(|f| target_slugs.contains(&f.0))
        .map(|f| FormatOption { value: f.0.to_string(), label: f.1.to_string() })
        .collect();

    ctx.insert("target_formats", &target_formats);

    let html = tera.render("tools/convert.html", &ctx)
        .unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string());
    Html(html)
}

async fn sitemap() -> impl IntoResponse {
    let base = "https://imgpact.com";
    let lastmod = "2026-03-22";
    let mut urls = format!(
        "<url><loc>{}/</loc><lastmod>{}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n",
        base, lastmod
    );
    for lang_code in &["en", "fr", "es", "ru"] {
        let lang = Lang::from_code(lang_code);
        let ts = section_tools(lang);
        let gs = section_guides(lang);
        let cs = section_convert(lang);
        // Tool pages
        for &en_slug in TOOL_SLUGS {
            let url_slug = tool_url_slug(en_slug, lang);
            urls.push_str(&format!(
                "<url><loc>{}/{}/{}/{}</loc><lastmod>{}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n",
                base, lang_code, ts, url_slug, lastmod
            ));
        }
        // Convert pages
        for fmt in CONVERT_SLUGS {
            urls.push_str(&format!(
                "<url><loc>{}/{}/{}/{}/{}</loc><lastmod>{}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n",
                base, lang_code, ts, cs, fmt, lastmod
            ));
        }
        // Guides
        urls.push_str(&format!(
            "<url><loc>{}/{}/{}</loc><lastmod>{}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n",
            base, lang_code, gs, lastmod
        ));
        for &fr_slug in GUIDE_SLUGS {
            let url_slug = url_slug_for_lang(fr_slug, lang);
            urls.push_str(&format!(
                "<url><loc>{}/{}/{}/{}</loc><lastmod>{}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n",
                base, lang_code, gs, url_slug, lastmod
            ));
        }
    }
    for page in &["about", "help", "privacy", "cookies", "terms"] {
        urls.push_str(&format!(
            "<url><loc>{}/{}</loc><lastmod>{}</lastmod><changefreq>monthly</changefreq><priority>0.4</priority></url>\n",
            base, page, lastmod
        ));
    }
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
{}</urlset>"#,
        urls
    );
    (
        [(header::CONTENT_TYPE, "application/xml")],
        xml,
    )
}

async fn robots() -> impl IntoResponse {
    let body = "\
User-agent: *\n\
Allow: /\n\
\n\
# Bloquer les crawlers d'entrainement IA\n\
User-agent: GPTBot\n\
Disallow: /\n\
\n\
User-agent: Google-Extended\n\
Disallow: /\n\
\n\
User-agent: anthropic-ai\n\
Disallow: /\n\
\n\
User-agent: CCBot\n\
Disallow: /\n\
\n\
Sitemap: https://imgpact.com/sitemap.xml\n";
    ([(header::CONTENT_TYPE, "text/plain")], body)
}

static INFO_PAGE_META: &[(&str, &str, &str)] = &[
    ("about",   "About imgpact. Free Browser-Based Image Tools",                  "imgpact is a free collection of browser-based image, GIF, and video tools powered by WebAssembly. No uploads, no signup, 100% private."),
    ("help",    "Help & FAQ, imgpact Image Tools",                                "Frequently asked questions about imgpact: file limits, privacy, supported formats, browser compatibility, and more."),
    ("privacy", "Privacy Policy, imgpact",                                        "imgpact processes all files locally in your browser. No file data is ever sent to our servers. Read our full privacy policy."),
    ("cookies", "Cookie Policy, imgpact",                                         "imgpact uses minimal cookies for theme preferences and analytics. No tracking cookies without consent. Read our cookie policy."),
    ("terms",   "Terms of Service, imgpact",                                      "Terms of service for imgpact.com, free browser-based image tools. Read our terms before using the service."),
];

// ─── Guide structs (module-level so both handlers can use them) ───────────
#[derive(Serialize)]
struct GuideCard {
    slug: String,
    url_slug: String,
    title: String,
    description: String,
    pillar: String,
    pillar_key: String,
}
#[derive(Serialize)]
struct PillarGroup {
    name: String,
    icon: String,
    key: String,
    guides: Vec<GuideCard>,
}

fn build_pillar_groups(lang: Lang) -> Vec<PillarGroup> {
    let t = get_translations(lang);
    let meta_source: &[(&str, &str, &str, &str)] = match lang {
        Lang::Fr => GUIDE_META,
        Lang::Es => GUIDE_META_ES,
        Lang::Ru => GUIDE_META_RU,
        _        => GUIDE_META_EN,
    };
    let pillars_def: &[(&str, &str, &str, &[&str])] = &[
        (t.guide_pillar_formats,     "file-image",    "formats",     &["formats-image", "jpeg-vs-png", "format-avif", "svg-pour-le-web", "format-heic"]),
        (t.guide_pillar_opti,        "zap",           "opti",        &["optimiser-images-site-web", "lazy-loading-images", "images-core-web-vitals", "cdn-images-comparatif", "responsive-images-srcset-sizes"]),
        (t.guide_pillar_compression, "minimize-2",    "compression", &["compression-image-lossy-lossless", "compresser-sans-perdre-qualite", "reduire-poids-gif", "optimiser-images-email", "compression-webp-vs-jpeg"]),
        (t.guide_pillar_social,      "share-2",       "social",      &["tailles-images-reseaux-sociaux-2026", "dimensions-images-instagram", "dimensions-images-facebook", "taille-banniere-youtube", "images-linkedin-optimales"]),
        (t.guide_pillar_ecommerce,   "shopping-cart", "ecommerce",   &["images-produits-ecommerce", "images-shopify", "amazon-product-images", "photos-produit-fond-blanc", "zoom-produit-interactif"]),
    ];
    pillars_def.iter().map(|(name, icon, key, slugs)| {
        let guides = slugs.iter().filter_map(|s| {
            meta_source.iter().find(|m| m.0 == *s).map(|m| GuideCard {
                slug: m.0.to_string(),
                url_slug: url_slug_for_lang(m.0, lang).to_string(),
                title: m.1.split(" | ").next().unwrap_or(m.1).to_string(),
                description: m.2.to_string(),
                pillar: m.3.to_string(),
                pillar_key: key.to_string(),
            })
        }).collect();
        PillarGroup { name: name.to_string(), icon: icon.to_string(), key: key.to_string(), guides }
    }).collect()
}

// ─── /guides  → 301 redirect to /{lang}/guides ────────────────────────────
async fn guides_index_redirect(headers: HeaderMap) -> impl IntoResponse {
    let lang = detect_lang(&headers);
    (
        StatusCode::MOVED_PERMANENTLY,
        [(header::LOCATION, format!("/{}/guides", lang.code()))],
    )
}

// ─── /guides/{slug}  → 301 redirect to /{lang}/guides/{slug} ─────────────
async fn guide_page_redirect(Path(slug): Path<String>, headers: HeaderMap) -> impl IntoResponse {
    let lang = detect_lang(&headers);
    (
        StatusCode::MOVED_PERMANENTLY,
        [(header::LOCATION, format!("/{}/guides/{}", lang.code(), slug))],
    )
}

// ─── /{lang}/guides ───────────────────────────────────────────────────────
async fn lang_guides_index(Path(lang_code): Path<String>, headers: HeaderMap) -> Html<String> {
    let lang = lang_from_code(&lang_code).unwrap_or_else(|| detect_lang(&headers));
    let tera = get_tera();
    let mut ctx = base_context_lang("", lang);
    ctx.insert("canonical_url", &format!("https://imgpact.com/{}/guides", lang.code()));
    ctx.insert("page_title",        "Image Guides & Tutorials | imgpact");
    ctx.insert("meta_description",  "Free image guides: formats, web optimization, compression, social media sizes, e-commerce. Updated for 2026.");
    ctx.insert("og_title",          "Image Guides & Tutorials | imgpact");
    ctx.insert("og_description",    "Free image guides: formats, web optimization, compression, social media sizes, e-commerce.");
    ctx.insert("pillar_groups", &build_pillar_groups(lang));

    let html = if tera.get_template_names().any(|n| n == "guides/index.html") {
        tera.render("guides/index.html", &ctx).unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string())
    } else {
        "<h1>Guides index coming soon</h1>".to_string()
    };
    Html(html)
}

// ─── /{lang}/guides/{slug} ────────────────────────────────────────────────
async fn lang_guide_page(
    Path((lang_code, slug)): Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !is_valid_slug(&slug) {
        return Html("<h1>404 Not Found</h1>".to_string()).into_response();
    }
    let lang = lang_from_code(&lang_code).unwrap_or_else(|| detect_lang(&headers));

    // Resolve URL slug → internal FR template slug
    let fr_slug = match fr_slug_from_url(&slug, lang) {
        Some(s) => s,
        None    => return Html("<h1>404. Guide not found</h1>".to_string()).into_response(),
    };

    // If visitor reaches a wrong-language URL slug, redirect to the proper one
    if lang != Lang::Fr {
        let proper_slug = url_slug_for_lang(fr_slug, lang);
        if slug != proper_slug {
            return (
                StatusCode::MOVED_PERMANENTLY,
                [(header::LOCATION, format!("/{}/{}/{}", lang.code(), section_guides(lang), proper_slug))],
            ).into_response();
        }
    }

    let tera    = get_tera();
    let mut ctx = base_context_lang("", lang);
    ctx.insert("canonical_url", &format!("https://imgpact.com/{}/{}/{}", lang.code(), section_guides(lang), slug));

    let guide_meta_source: &[(&str, &str, &str, &str)] = match lang {
        Lang::Fr => GUIDE_META,
        Lang::Es => GUIDE_META_ES,
        Lang::Ru => GUIDE_META_RU,
        _        => GUIDE_META_EN,
    };
    if let Some(meta) = guide_meta_source.iter().find(|m| m.0 == fr_slug) {
        ctx.insert("page_title",       meta.1);
        ctx.insert("meta_description", meta.2);
        ctx.insert("og_title",         meta.1);
        ctx.insert("og_description",   meta.2);
    } else {
        ctx.insert("page_title",       "Guide | imgpact");
        ctx.insert("meta_description", "Guide imgpact.");
    }

    // Template fallback: requested lang → en → fr → 404
    let preferred = format!("guides/{}/{}.html", lang.code(), fr_slug);
    let en_tmpl   = format!("guides/en/{}.html", fr_slug);
    let fr_tmpl   = format!("guides/fr/{}.html", fr_slug);
    let names: Vec<_> = tera.get_template_names().collect();

    let template = if names.contains(&preferred.as_str()) {
        preferred
    } else if names.contains(&en_tmpl.as_str()) {
        en_tmpl
    } else if names.contains(&fr_tmpl.as_str()) {
        fr_tmpl
    } else {
        return Html("<h1>404. Guide not found</h1>".to_string()).into_response();
    };

    let html = tera.render(&template, &ctx)
        .unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string());
    Html(html).into_response()
}

async fn info_page(Path(slug): Path<String>, headers: HeaderMap) -> Html<String> {
    let tera = get_tera();
    let lang = detect_lang(&headers);
    let mut ctx = base_context("", &headers);
    ctx.insert("canonical_url", &format!("https://imgpact.com/{}", slug));
    if let Some(meta) = INFO_PAGE_META.iter().find(|m| m.0 == slug.as_str()) {
        ctx.insert("page_title",       meta.1);
        ctx.insert("meta_description", meta.2);
        ctx.insert("og_title",         meta.1);
        ctx.insert("og_description",   meta.2);
    }
    let preferred = format!("pages/{}/{}.html", lang.code(), slug);
    let fallback  = format!("pages/{}.html", slug);
    let names: Vec<_> = tera.get_template_names().collect();
    let template = if names.contains(&preferred.as_str()) { preferred } else { fallback.clone() };
    let html = if names.contains(&template.as_str()) {
        tera.render(&template, &ctx).unwrap_or_else(|_| "<h1>Error</h1>".to_string())
    } else {
        "<h1>404 Not Found</h1>".to_string()
    };
    Html(html)
}

// ─── /{lang}  (home page with explicit language) ─────────────────────────
async fn lang_home(Path(lang_code): Path<String>, _headers: HeaderMap) -> impl IntoResponse {
    let lang = match lang_from_code(&lang_code) {
        Some(l) => l,
        None    => return Html("<h1>404 Not Found</h1>".to_string()).into_response(),
    };
    let tera = get_tera();
    let mut ctx = base_context_lang("", lang);
    ctx.insert("canonical_url",    &format!("https://imgpact.com/{}/", lang.code()));
    ctx.insert("page_title",       get_translations(lang).site_title);
    ctx.insert("meta_description", "Free browser-based image, GIF, and video tools. No upload limits, no signup. Everything runs in your browser.");
    let html = tera.render("index.html", &ctx)
        .unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string());
    Html(html).into_response()
}

// ─── /{lang}/{tools_section}/{slug} ──────────────────────────────────────
async fn lang_tool_page(
    Path((lang_code, slug)): Path<(String, String)>,
    _headers: HeaderMap,
) -> impl IntoResponse {
    if !is_valid_slug(&slug) {
        return Html("<h1>404 Not Found</h1>".to_string()).into_response();
    }
    let lang = match lang_from_code(&lang_code) {
        Some(l) => l,
        None    => return Html("<h1>404 Not Found</h1>".to_string()).into_response(),
    };
    // Resolve any-lang slug → internal EN slug
    let en_slug = match en_tool_slug_from_url(&slug, lang) {
        Some(s) => s,
        None    => return Html("<h1>404 Not Found</h1>".to_string()).into_response(),
    };
    // Redirect to canonical slug for this lang if needed
    let canonical_slug = tool_url_slug(en_slug, lang);
    if slug != canonical_slug {
        return (
            StatusCode::MOVED_PERMANENTLY,
            [(header::LOCATION, format!("/{}/{}/{}", lang.code(), section_tools(lang), canonical_slug))],
        ).into_response();
    }
    let tera = get_tera();
    let mut ctx = base_context_lang(en_slug, lang);
    ctx.insert("canonical_url", &format!("https://imgpact.com/{}/{}/{}", lang.code(), section_tools(lang), canonical_slug));
    if let Some(meta) = TOOL_META.iter().find(|m| m.0 == en_slug) {
        let t = get_translations(lang);
        let tool_name = translated_tool_name(en_slug, lang);
        let page_title = format!("{} - {}", tool_name, t.page_title_suffix);
        ctx.insert("page_title",       &page_title);
        ctx.insert("meta_description", meta.2);
        ctx.insert("og_title",         &page_title);
        ctx.insert("og_description",   meta.2);
    }
    let template = format!("tools/{}.html", en_slug);
    let html = if tera.get_template_names().any(|n| n == template) {
        tera.render(&template, &ctx).unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string())
    } else {
        ctx.insert("tool_name", &en_slug.replace('-', " "));
        tera.render("tools/placeholder.html", &ctx).unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string())
    };
    Html(html).into_response()
}

// ─── /{lang}/tools/convert/{format} ─────────────────────────────────────
async fn lang_convert_page(
    Path((lang_code, format)): Path<(String, String)>,
    _headers: HeaderMap,
) -> impl IntoResponse {
    if !is_valid_slug(&format) {
        return Html("<h1>404 Not Found</h1>".to_string()).into_response();
    }
    let lang = match lang_from_code(&lang_code) {
        Some(l) => l,
        None    => return Html("<h1>404 Not Found</h1>".to_string()).into_response(),
    };
    let tera = get_tera();
    let fmt  = format.as_str();
    let meta = match CONVERT_PAGE_META.iter().find(|m| m.0 == fmt) {
        Some(m) => m,
        None    => return Html("<h1>404 Not Found</h1>".to_string()).into_response(),
    };
    let mut ctx = base_context_lang(&format!("convert-{}", fmt), lang);
    ctx.insert("canonical_url",    &format!("https://imgpact.com/{}/{}/{}/{}", lang.code(), section_tools(lang), section_convert(lang), fmt));
    let t = get_translations(lang);
    let page_title = format!("{} {} - {}", t.convert_title_prefix, meta.1, t.page_title_suffix);
    ctx.insert("source_format",    meta.0);
    ctx.insert("source_label",     meta.1);
    ctx.insert("accept_types",     meta.2);
    ctx.insert("title",            &page_title);
    ctx.insert("page_title",       &page_title);
    ctx.insert("meta_description", meta.4);
    add_convert_ctx(&mut ctx, lang, meta.1);
    ctx.insert("og_title",         &page_title);
    ctx.insert("og_description",   meta.4);
    let target_slugs = CONVERT_PAGE_TARGETS.iter()
        .find(|t| t.0 == fmt).map(|t| t.1).unwrap_or(&[]);
    let target_formats: Vec<FormatOption> = FORMAT_LABELS.iter()
        .filter(|f| target_slugs.contains(&f.0))
        .map(|f| FormatOption { value: f.0.to_string(), label: f.1.to_string() })
        .collect();
    ctx.insert("target_formats", &target_formats);
    let html = tera.render("tools/convert.html", &ctx)
        .unwrap_or_else(|_| "<h1>500. Render error</h1>".to_string());
    Html(html).into_response()
}

// ─── /{lang}/{page}  (info pages: about, help, privacy, cookies, terms) ──
async fn lang_info_page_route(
    Path((lang_code, slug)): Path<(String, String)>,
    headers: HeaderMap,
) -> Html<String> {
    const INFO_PAGES: &[&str] = &["about", "help", "privacy", "cookies", "terms"];
    if !INFO_PAGES.contains(&slug.as_str()) {
        return Html("<h1>404 Not Found</h1>".to_string());
    }
    let lang = lang_from_code(&lang_code).unwrap_or_else(|| detect_lang(&headers));
    let tera = get_tera();
    let mut ctx = base_context_lang("", lang);
    ctx.insert("canonical_url", &format!("https://imgpact.com/{}/{}", lang.code(), slug));
    if let Some(meta) = INFO_PAGE_META.iter().find(|m| m.0 == slug.as_str()) {
        ctx.insert("page_title",       meta.1);
        ctx.insert("meta_description", meta.2);
        ctx.insert("og_title",         meta.1);
        ctx.insert("og_description",   meta.2);
    }
    let preferred = format!("pages/{}/{}.html", lang.code(), slug);
    let fallback  = format!("pages/{}.html", slug);
    let names: Vec<_> = tera.get_template_names().collect();
    let template = if names.contains(&preferred.as_str()) { preferred } else { fallback };
    if names.contains(&template.as_str()) {
        Html(tera.render(&template, &ctx).unwrap_or_else(|_| "<h1>Error</h1>".to_string()))
    } else {
        Html("<h1>404 Not Found</h1>".to_string())
    }
}

/// Security headers: COOP/COEP (FFmpeg.wasm), CSP, framing, MIME sniff, referrer, HSTS.
async fn security_headers(req: Request, next: Next) -> Response {
    let mut response: Response = next.run(req).await;
    let h = response.headers_mut();

    // Required for SharedArrayBuffer / FFmpeg.wasm
    // "credentialless" = active SharedArrayBuffer comme require-corp,
    // mais autorise les ressources cross-origin sans CORP header (ex: Clarity, GA4)
    h.insert("Cross-Origin-Opener-Policy",   HeaderValue::from_static("same-origin"));
    // "credentialless" = active SharedArrayBuffer (FFmpeg.wasm) comme require-corp,
    // ET autorise les scripts cross-origin sans CORP header (Clarity, GA4).
    // Supporté Chrome 96+, Edge 96+, Firefox 119+.
    h.insert("Cross-Origin-Embedder-Policy", HeaderValue::from_static("credentialless"));

    // Prevent MIME-type sniffing
    h.insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));

    // Prevent clickjacking (belt-and-suspenders with CSP frame-ancestors)
    h.insert("X-Frame-Options", HeaderValue::from_static("DENY"));

    // Disable legacy XSS filter (causes more harm than good in modern browsers)
    h.insert("X-XSS-Protection", HeaderValue::from_static("0"));

    // Referrer policy, send origin only on cross-origin requests
    h.insert("Referrer-Policy", HeaderValue::from_static("strict-origin-when-cross-origin"));

    // Disable browser features we don't use
    h.insert("Permissions-Policy", HeaderValue::from_static(
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()"
    ));

    // HSTS, tell browsers to always use HTTPS for 1 year (only effective over HTTPS/Cloudflare)
    h.insert("Strict-Transport-Security", HeaderValue::from_static(
        "max-age=31536000; includeSubDomains"
    ));

    // Content-Security-Policy
    // - script-src: self + jsdelivr CDN (Lucide icons) + inline scripts (theme/lang switcher) + WASM eval
    // - style-src: self + Google Fonts + inline styles
    // - img-src / media-src: self + data: + blob: (canvas export, video preview)
    // - worker-src / child-src: blob: (FFmpeg.wasm web workers)
    // - frame-ancestors: none (no embedding)
    h.insert("Content-Security-Policy", HeaderValue::from_static(
        "default-src 'self'; \
         script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://*.clarity.ms; \
         style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
         font-src 'self' https://fonts.gstatic.com; \
         img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com; \
         media-src 'self' blob:; \
         connect-src 'self' blob: https://cdn.jsdelivr.net https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://*.clarity.ms; \
         worker-src 'self' blob:; \
         child-src 'self' blob:; \
         object-src 'none'; \
         base-uri 'self'; \
         form-action 'self'; \
         frame-ancestors 'none';"
    ));

    response
}

/// Cache-Control headers: 1 year for static assets (2xx only), no-cache for HTML.
async fn cache_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let mut response = next.run(req).await;
    if !response.status().is_success() {
        return response;
    }
    let h = response.headers_mut();
    let value = if path.starts_with("/static/") {
        // Assets versionnés (JS/CSS/images/WASM), cache 1 an, immuable
        "public, max-age=31536000, immutable"
    } else if path == "/sitemap.xml" || path == "/robots.txt" {
        // Sitemap et robots, cache 24h navigateur, 7j Cloudflare
        "public, max-age=86400, s-maxage=604800"
    } else if path.starts_with("/api/") || path.ends_with("/stats") {
        // API endpoints + stats page, never cache
        "no-store"
    } else if path == "/" || (path.starts_with("/tools") && !path.starts_with("/tools.")) {
        // Root page + non-lang tool pages: content depends on cookie → don't let Cloudflare cache
        "no-store"
    } else {
        // Pages HTML (guides, outils, accueil), cache 10min navigateur, 1h Cloudflare
        // Le lang est dans l'URL donc chaque URL est déterministe → safe à cacher
        "public, max-age=600, s-maxage=3600"
    };
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    response
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // Initialise Tera at startup so the first real request isn't slower and
    // template errors surface immediately rather than on the first visitor.
    let _ = get_tera();
    tracing::info!("Tera templates loaded successfully");

    // Initialise SQLite stats DB
    let db_path = std::env::var("STATS_DB_PATH").unwrap_or_else(|_| "stats.db".to_string());
    let db = match StatsDb::new(&db_path) {
        Ok(db) => {
            tracing::info!("Stats DB opened at {}", db_path);
            db
        }
        Err(e) => {
            tracing::error!("Failed to open stats DB at {}: {}", db_path, e);
            std::process::exit(1);
        }
    };
    let state: AppState = Arc::new(db);

    // Build an absolute path to static/ using current_dir().join() rather than
    // canonicalize(), which on Windows returns a \\?\ UNC-prefixed path that
    // tower-http's ServeDir cannot resolve correctly.
    let static_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("static");
    if !static_dir.exists() {
        tracing::warn!(
            "Static directory not found at '{}'. \
             Run the server from the workspace root (G:\\imgpact.com\\).",
            static_dir.display()
        );
    }
    tracing::info!("Serving static files from: {}", static_dir.display());

    let app = Router::new()
        .route("/", get(index))
        .route("/tools/convert/{format}", get(convert_page))
        .route("/tools/{slug}", get(tool_page))
        .route("/guides", get(guides_index_redirect))
        .route("/guides/{slug}", get(guide_page_redirect))
        // Legacy non-prefixed routes (keep working for bookmarks)
        .route("/about",   get(|h: HeaderMap| info_page(Path("about".to_string()),   h)))
        .route("/help",    get(|h: HeaderMap| info_page(Path("help".to_string()),    h)))
        .route("/privacy", get(|h: HeaderMap| info_page(Path("privacy".to_string()), h)))
        .route("/cookies", get(|h: HeaderMap| info_page(Path("cookies".to_string()), h)))
        .route("/terms",   get(|h: HeaderMap| info_page(Path("terms".to_string()),   h)))
        // Stats & tracking API
        .route("/api/track", post(api_track))
        .route("/api/stats", get(api_stats))
        // Language-prefixed routes
        .route("/{lang}", get(lang_home))
        .route("/{lang}/", get(lang_home))
        .route("/{lang}/stats", get(lang_stats_page))
        // FR: /fr/outils/...
        .route("/{lang}/outils/convertir/{format}", get(lang_convert_page))
        .route("/{lang}/outils/{slug}", get(lang_tool_page))
        // ES: /es/herramientas/... and /es/guias/...
        .route("/{lang}/herramientas/convertir/{format}", get(lang_convert_page))
        .route("/{lang}/herramientas/{slug}", get(lang_tool_page))
        .route("/{lang}/guias", get(lang_guides_index))
        .route("/{lang}/guias/{slug}", get(lang_guide_page))
        // EN/RU + generic fallback
        .route("/{lang}/guides", get(lang_guides_index))
        .route("/{lang}/guides/{slug}", get(lang_guide_page))
        .route("/{lang}/tools/convert/{format}", get(lang_convert_page))
        .route("/{lang}/tools/{slug}", get(lang_tool_page))
        .route("/{lang}/{page}", get(lang_info_page_route))
        .route("/sitemap.xml", get(sitemap))
        .route("/robots.txt", get(robots))
        .nest_service("/static", ServeDir::new(static_dir))
        .layer(CompressionLayer::new())
        .layer(middleware::from_fn(security_headers))
        .layer(middleware::from_fn(cache_headers))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("imgpact server listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
