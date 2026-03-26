use wasm_bindgen::prelude::*;
use image::{load_from_memory, imageops::FilterType};
use serde::Serialize;
use crate::encode_image;

#[derive(Serialize)]
struct Dimensions {
    width: u32,
    height: u32,
}

fn parse_filter(filter: &str) -> FilterType {
    match filter {
        "nearest" => FilterType::Nearest,
        "bilinear" => FilterType::Triangle,
        "bicubic" => FilterType::CatmullRom,
        "lanczos3" => FilterType::Lanczos3,
        _ => FilterType::Lanczos3,
    }
}

#[wasm_bindgen]
pub fn resize_image(
    image_bytes: &[u8],
    width: u32,
    height: u32,
    maintain_aspect: bool,
    filter: &str,
    format: &str,
) -> Vec<u8> {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let filter_type = parse_filter(filter);

    // Guard against 0 dimensions: substitute the original dimension so
    // "resize to width only" or "resize to height only" works safely.
    let (src_w, src_h) = (img.width(), img.height());
    let eff_w = if width == 0 { src_w } else { width };
    let eff_h = if height == 0 { src_h } else { height };

    let resized = if maintain_aspect {
        img.resize(eff_w, eff_h, filter_type)
    } else {
        img.resize_exact(eff_w, eff_h, filter_type)
    };

    encode_image(resized, format)
}

#[wasm_bindgen]
pub fn get_dimensions(image_bytes: &[u8]) -> JsValue {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let dims = Dimensions {
        width: img.width(),
        height: img.height(),
    };
    serde_wasm_bindgen::to_value(&dims).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::test_helpers::make_png;

    #[test]
    fn parse_filter_all_variants() {
        assert!(matches!(parse_filter("nearest"),  FilterType::Nearest));
        assert!(matches!(parse_filter("bilinear"), FilterType::Triangle));
        assert!(matches!(parse_filter("bicubic"),  FilterType::CatmullRom));
        assert!(matches!(parse_filter("lanczos3"), FilterType::Lanczos3));
        assert!(matches!(parse_filter("unknown"),  FilterType::Lanczos3)); // default
    }

    #[test]
    fn resize_exact_gives_exact_dimensions() {
        let src = make_png(100, 80);
        let result = resize_image(&src, 50, 40, false, "lanczos3", "png");
        let decoded = image::load_from_memory(&result).unwrap();
        assert_eq!(decoded.width(), 50);
        assert_eq!(decoded.height(), 40);
    }

    #[test]
    fn resize_maintain_aspect_preserves_ratio() {
        // 200×100 image, fit into 50×50 → should give 50×25
        let src = make_png(200, 100);
        let result = resize_image(&src, 50, 50, true, "nearest", "png");
        let decoded = image::load_from_memory(&result).unwrap();
        assert_eq!(decoded.width(), 50);
        assert_eq!(decoded.height(), 25);
    }

    #[test]
    fn resize_zero_width_uses_source_width() {
        // width=0 should not panic — substitutes original width
        let src = make_png(80, 40);
        let result = resize_image(&src, 0, 20, false, "nearest", "png");
        let decoded = image::load_from_memory(&result).unwrap();
        // height becomes 20 as requested; width stays at original 80
        assert_eq!(decoded.height(), 20);
        assert!(!result.is_empty());
    }

    #[test]
    fn resize_zero_height_uses_source_height() {
        let src = make_png(80, 40);
        let result = resize_image(&src, 40, 0, false, "nearest", "png");
        let decoded = image::load_from_memory(&result).unwrap();
        assert_eq!(decoded.width(), 40);
        assert!(!result.is_empty());
    }

    #[test]
    fn resize_upscale_works() {
        let src = make_png(32, 32);
        let result = resize_image(&src, 128, 128, false, "bilinear", "png");
        let decoded = image::load_from_memory(&result).unwrap();
        assert_eq!(decoded.width(), 128);
        assert_eq!(decoded.height(), 128);
    }
}
