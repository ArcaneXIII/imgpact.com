use wasm_bindgen::prelude::*;
use image::load_from_memory;
use serde::Serialize;
use crate::convert::encode_with_quality;

#[derive(Serialize)]
struct OptimizeStats {
    original_size: usize,
    optimized_size: usize,
    ratio: f32,
}

#[wasm_bindgen]
pub fn optimize_image(image_bytes: &[u8], format: &str, quality: u8, _strip_metadata: bool) -> Vec<u8> {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    // Re-encoding strips metadata automatically; strip_metadata param is informational
    encode_with_quality(img, format, quality)
}

#[wasm_bindgen]
pub fn optimize_image_stats(image_bytes: &[u8], format: &str, quality: u8) -> JsValue {
    let original_size = image_bytes.len();
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let optimized = encode_with_quality(img, format, quality);
    let optimized_size = optimized.len();
    let ratio = optimized_size as f32 / original_size as f32;
    let stats = OptimizeStats { original_size, optimized_size, ratio };
    serde_wasm_bindgen::to_value(&stats).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::test_helpers::make_png;
    use image::load_from_memory;

    #[test]
    fn optimize_png_roundtrip_preserves_dimensions() {
        let src = make_png(64, 64);
        let result = optimize_image(&src, "png", 85, true);
        assert!(!result.is_empty());
        let decoded = load_from_memory(&result).unwrap();
        assert_eq!(decoded.width(), 64);
        assert_eq!(decoded.height(), 64);
    }

    #[test]
    fn optimize_jpeg_lower_quality_reduces_size() {
        let src = make_png(128, 128);
        let high = optimize_image(&src, "jpg", 95, false);
        let low  = optimize_image(&src, "jpg", 10, false);
        assert!(high.len() > low.len(), "higher quality JPEG should be larger");
    }

    #[test]
    fn optimize_returns_valid_image() {
        let src = make_png(32, 32);
        let result = optimize_image(&src, "jpg", 80, true);
        assert!(load_from_memory(&result).is_ok(), "optimized bytes must be a valid image");
    }

    #[test]
    fn optimize_strip_metadata_still_produces_image() {
        // strip_metadata=true vs false: re-encoding always strips; both should succeed
        let src = make_png(32, 32);
        let a = optimize_image(&src, "png", 85, true);
        let b = optimize_image(&src, "png", 85, false);
        // Both must be valid PNGs
        assert!(load_from_memory(&a).is_ok());
        assert!(load_from_memory(&b).is_ok());
    }
}
