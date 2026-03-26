use wasm_bindgen::prelude::*;
use image::load_from_memory;
use crate::encode_image;

#[wasm_bindgen]
pub fn rotate_image(image_bytes: &[u8], degrees: i32, format: &str) -> Vec<u8> {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let rotated = match ((degrees % 360) + 360) % 360 {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };
    encode_image(rotated, format)
}

#[wasm_bindgen]
pub fn flip_horizontal(image_bytes: &[u8], format: &str) -> Vec<u8> {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let flipped = img.fliph();
    encode_image(flipped, format)
}

#[wasm_bindgen]
pub fn flip_vertical(image_bytes: &[u8], format: &str) -> Vec<u8> {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let flipped = img.flipv();
    encode_image(flipped, format)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::test_helpers::make_png;

    fn dims(bytes: &[u8]) -> (u32, u32) {
        use image::GenericImageView;
        let img = image::load_from_memory(bytes).unwrap();
        img.dimensions()
    }

    #[test]
    fn rotate90_swaps_dimensions() {
        let src = make_png(80, 40); // landscape
        let result = rotate_image(&src, 90, "png");
        let (w, h) = dims(&result);
        assert_eq!(w, 40);
        assert_eq!(h, 80);
    }

    #[test]
    fn rotate180_preserves_dimensions() {
        let src = make_png(80, 40);
        let result = rotate_image(&src, 180, "png");
        let (w, h) = dims(&result);
        assert_eq!(w, 80);
        assert_eq!(h, 40);
    }

    #[test]
    fn rotate270_swaps_dimensions() {
        let src = make_png(80, 40);
        let result = rotate_image(&src, 270, "png");
        let (w, h) = dims(&result);
        assert_eq!(w, 40);
        assert_eq!(h, 80);
    }

    #[test]
    fn rotate0_is_noop() {
        let src = make_png(80, 40);
        let result = rotate_image(&src, 0, "png");
        let (w, h) = dims(&result);
        assert_eq!(w, 80);
        assert_eq!(h, 40);
    }

    #[test]
    fn rotate360_is_noop() {
        let src = make_png(60, 30);
        let result = rotate_image(&src, 360, "png");
        let (w, h) = dims(&result);
        assert_eq!(w, 60);
        assert_eq!(h, 30);
    }

    #[test]
    fn flip_horizontal_preserves_dimensions() {
        let src = make_png(80, 40);
        let result = flip_horizontal(&src, "png");
        let (w, h) = dims(&result);
        assert_eq!(w, 80);
        assert_eq!(h, 40);
    }

    #[test]
    fn flip_vertical_preserves_dimensions() {
        let src = make_png(80, 40);
        let result = flip_vertical(&src, "png");
        let (w, h) = dims(&result);
        assert_eq!(w, 80);
        assert_eq!(h, 40);
    }

    #[test]
    fn flip_horizontal_twice_is_identity() {
        let src = make_png(64, 64);
        let once  = flip_horizontal(&src, "png");
        let twice = flip_horizontal(&once, "png");
        let decoded = image::load_from_memory(&twice).unwrap();
        let original = image::load_from_memory(&src).unwrap();
        // Compare every pixel
        assert_eq!(decoded.to_rgba8(), original.to_rgba8());
    }
}
