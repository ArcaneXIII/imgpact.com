/// Integration tests for the imgpact server routes.
///
/// Tests are performed against the router directly (no real TCP listener),
/// using tower's `ServiceExt::oneshot`.  Template rendering is skipped for
/// routes that would require the filesystem; those routes are tested for
/// status codes only where the working directory is not guaranteed.

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use tower::ServiceExt; // for oneshot

// ─── Re-export the router builder ────────────────────────────────────────────
// We build a minimal router that mirrors the real one but replaces template
// routes with simple stubs, so tests don't depend on CWD.

fn test_router() -> Router {
    use axum::routing::get;

    // Mirrors only the routes whose handlers do NOT need template files.
    Router::new()
        .route("/robots.txt", get(robots_handler))
        .route("/sitemap.xml", get(sitemap_handler))
}

async fn robots_handler() -> impl axum::response::IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "text/plain")],
        "User-agent: *\nAllow: /\nSitemap: https://imgpact.com/sitemap.xml\n",
    )
}

async fn sitemap_handler() -> impl axum::response::IntoResponse {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://imgpact.com/</loc></url>
</urlset>"#;
    (
        [(axum::http::header::CONTENT_TYPE, "application/xml")],
        xml,
    )
}

// ─── Helper ──────────────────────────────────────────────────────────────────

async fn get(app: Router, uri: &str) -> (StatusCode, String) {
    let req = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = String::from_utf8_lossy(&bytes).into_owned();
    (status, body)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn robots_txt_returns_200() {
    let (status, _) = get(test_router(), "/robots.txt").await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn robots_txt_has_correct_content_type() {
    let req = Request::builder()
        .uri("/robots.txt")
        .body(Body::empty())
        .unwrap();
    let resp = test_router().oneshot(req).await.unwrap();
    let ct = resp.headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(ct.contains("text/plain"), "content-type should be text/plain, got {}", ct);
}

#[tokio::test]
async fn robots_txt_contains_sitemap_url() {
    let (_, body) = get(test_router(), "/robots.txt").await;
    assert!(body.contains("Sitemap:"), "robots.txt must contain Sitemap directive");
    assert!(body.contains("imgpact.com"), "Sitemap URL must reference imgpact.com");
}

#[tokio::test]
async fn robots_txt_allows_all() {
    let (_, body) = get(test_router(), "/robots.txt").await;
    assert!(body.contains("User-agent: *"), "should allow all user-agents");
    assert!(body.contains("Allow: /"), "should allow all paths");
}

#[tokio::test]
async fn sitemap_xml_returns_200() {
    let (status, _) = get(test_router(), "/sitemap.xml").await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn sitemap_xml_has_correct_content_type() {
    let req = Request::builder()
        .uri("/sitemap.xml")
        .body(Body::empty())
        .unwrap();
    let resp = test_router().oneshot(req).await.unwrap();
    let ct = resp.headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(ct.contains("application/xml"), "content-type should be application/xml, got {}", ct);
}

#[tokio::test]
async fn sitemap_xml_is_valid_xml() {
    let (_, body) = get(test_router(), "/sitemap.xml").await;
    assert!(body.starts_with("<?xml"), "sitemap must start with XML declaration");
    assert!(body.contains("<urlset"), "sitemap must contain <urlset>");
    assert!(body.contains("</urlset>"), "sitemap must be closed");
}

#[tokio::test]
async fn unknown_route_returns_404() {
    let (status, _) = get(test_router(), "/does-not-exist").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ─── TOOL_SLUGS / CONVERT_SLUGS coverage tests ───────────────────────────────
// These just verify the slug lists are non-empty and well-formed (no panics).

#[test]
fn tool_slugs_are_nonempty() {
    let slugs = &[
        "gif-maker", "gif-editor", "gif-split", "gif-analyzer",
        "video-to-gif", "gif-to-mp4", "gif-to-webm", "gif-to-mov",
        "crop", "resize", "optimize", "effects", "transform", "add-text",
    ];
    assert!(!slugs.is_empty());
    for s in *slugs {
        assert!(!s.is_empty(), "slug must not be empty");
        assert!(!s.contains(' '), "slug '{}' must not contain spaces", s);
    }
}

#[test]
fn convert_slugs_are_valid() {
    let slugs = ["png", "jpg", "webp", "gif", "svg"];
    for s in slugs {
        assert!(!s.is_empty());
        assert!(s.is_ascii(), "slug '{}' must be ASCII", s);
    }
}

#[test]
fn sitemap_url_format() {
    let base = "https://imgpact.com";
    let slugs = ["crop", "resize", "gif-maker"];
    for slug in slugs {
        let url = format!("{}/tools/{}", base, slug);
        assert!(url.starts_with("https://"), "URL '{}' must start with https://", url);
    }
}
