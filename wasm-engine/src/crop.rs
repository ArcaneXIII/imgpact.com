use wasm_bindgen::prelude::*;
use image::load_from_memory;
use crate::encode_image;

#[wasm_bindgen]
pub fn crop_image(image_bytes: &[u8], x: u32, y: u32, width: u32, height: u32, format: &str) -> Vec<u8> {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let cropped = img.crop_imm(x, y, width, height);
    encode_image(cropped, format)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::test_helpers::make_png;

    #[test]
    fn crop_gives_correct_dimensions() {
        let src = make_png(100, 80);
        let img = load_from_memory(&src).unwrap();
        let cropped = img.crop_imm(10, 5, 40, 30);
        assert_eq!(cropped.width(), 40);
        assert_eq!(cropped.height(), 30);
    }

    #[test]
    fn crop_at_origin() {
        let src = make_png(50, 50);
        let img = load_from_memory(&src).unwrap();
        let cropped = img.crop_imm(0, 0, 25, 25);
        assert_eq!(cropped.width(), 25);
        assert_eq!(cropped.height(), 25);
    }

    #[test]
    fn crop_clamps_to_image_boundary() {
        // Requesting more than available clamps to remaining pixels
        let src = make_png(100, 100);
        let img = load_from_memory(&src).unwrap();
        let cropped = img.crop_imm(80, 80, 50, 50); // only 20×20 available
        assert!(cropped.width() <= 20);
        assert!(cropped.height() <= 20);
    }

    #[test]
    fn crop_image_fn_returns_encoded_png() {
        let src = make_png(100, 100);
        let result = crop_image(&src, 0, 0, 50, 50, "png");
        assert!(!result.is_empty());
        assert_eq!(&result[..4], &[0x89, 0x50, 0x4E, 0x47]);
        let decoded = image::load_from_memory(&result).unwrap();
        assert_eq!(decoded.width(), 50);
        assert_eq!(decoded.height(), 50);
    }

    #[test]
    fn crop_image_fn_returns_jpeg() {
        let src = make_png(100, 100);
        let result = crop_image(&src, 10, 10, 40, 40, "jpg");
        assert!(!result.is_empty());
        assert_eq!(&result[..3], &[0xFF, 0xD8, 0xFF]);
    }
}
