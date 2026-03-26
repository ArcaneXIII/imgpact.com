use wasm_bindgen::prelude::*;
use image::{load_from_memory, imageops, DynamicImage, GenericImageView, Rgba};
use crate::convert::encode_with_quality;

#[wasm_bindgen]
pub fn apply_effect(image_bytes: &[u8], effect: &str, intensity: f32, format: &str) -> Vec<u8> {
    let img = load_from_memory(image_bytes).expect("Failed to decode image");
    let processed = match effect {
        "grayscale" => DynamicImage::ImageLuma8(imageops::grayscale(&img)),
        "blur" => img.blur(intensity * 10.0),
        "brighten" => img.brighten((intensity * 100.0) as i32),
        "contrast" => img.adjust_contrast(intensity * 100.0),
        "invert" => {
            let mut out = img.clone();
            out.invert();
            out
        }
        "sharpen" => img.unsharpen(intensity * 5.0, 1),
        "sepia" => apply_sepia(img),
        "pixelate" => apply_pixelate(img, intensity),
        _ => img,
    };
    encode_with_quality(processed, format, 85)
}

fn apply_sepia(img: DynamicImage) -> DynamicImage {
    let mut rgba = img.to_rgba8();
    for pixel in rgba.pixels_mut() {
        let Rgba([r, g, b, a]) = *pixel;
        let (rf, gf, bf) = (r as f32, g as f32, b as f32);
        let nr = (0.393 * rf + 0.769 * gf + 0.189 * bf).min(255.0) as u8;
        let ng = (0.349 * rf + 0.686 * gf + 0.168 * bf).min(255.0) as u8;
        let nb = (0.272 * rf + 0.534 * gf + 0.131 * bf).min(255.0) as u8;
        *pixel = Rgba([nr, ng, nb, a]);
    }
    DynamicImage::ImageRgba8(rgba)
}

fn apply_pixelate(img: DynamicImage, intensity: f32) -> DynamicImage {
    let (w, h) = img.dimensions();
    // intensity 0..1 → block size 1..min(w,h)/4
    let factor = (1.0 + intensity * 15.0).max(1.0) as u32;
    let small_w = (w / factor).max(1);
    let small_h = (h / factor).max(1);
    let small = img.resize_exact(small_w, small_h, imageops::FilterType::Nearest);
    small.resize_exact(w, h, imageops::FilterType::Nearest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::test_helpers::make_png;
    use image::{load_from_memory, GenericImageView};

    fn apply(src: &[u8], effect: &str, intensity: f32) -> DynamicImage {
        let img = load_from_memory(src).unwrap();
        match effect {
            "grayscale" => DynamicImage::ImageLuma8(imageops::grayscale(&img)),
            "sepia"     => apply_sepia(img),
            "pixelate"  => apply_pixelate(img, intensity),
            "invert"    => { let mut o = img.clone(); o.invert(); o }
            _           => img,
        }
    }

    #[test]
    fn sepia_preserves_dimensions() {
        let src = make_png(64, 64);
        let result = apply(&src, "sepia", 1.0);
        assert_eq!(result.dimensions(), (64, 64));
    }

    #[test]
    fn sepia_shifts_colors() {
        // A grey pixel [128,128,128] after sepia should have more red than blue
        let img = {
            let mut i = image::RgbaImage::new(4, 4);
            for p in i.pixels_mut() { *p = image::Rgba([128, 128, 128, 255]); }
            DynamicImage::ImageRgba8(i)
        };
        let sepia = apply_sepia(img);
        let px = sepia.to_rgba8().get_pixel(0, 0).0;
        assert!(px[0] > px[2], "sepia should have more red ({}) than blue ({})", px[0], px[2]);
    }

    #[test]
    fn pixelate_preserves_dimensions() {
        let src = make_png(64, 64);
        let img = load_from_memory(&src).unwrap();
        let result = apply_pixelate(img, 0.5);
        assert_eq!(result.dimensions(), (64, 64));
    }

    #[test]
    fn grayscale_produces_luma() {
        let src = make_png(32, 32);
        let result = apply(&src, "grayscale", 1.0);
        // Luma8 image: all three channels of any pixel are equal
        let rgba = result.to_rgba8();
        for p in rgba.pixels() {
            let [r, g, b, _] = p.0;
            assert_eq!(r, g, "R should equal G in greyscale");
            assert_eq!(g, b, "G should equal B in greyscale");
        }
    }

    #[test]
    fn invert_twice_is_identity() {
        let src = make_png(32, 32);
        let img = load_from_memory(&src).unwrap();
        let mut once = img.clone(); once.invert();
        let mut twice = once; twice.invert();
        assert_eq!(twice.to_rgba8(), img.to_rgba8());
    }

    #[test]
    fn apply_effect_fn_returns_encoded_bytes() {
        let src = make_png(32, 32);
        let result = apply_effect(&src, "grayscale", 1.0, "png");
        assert!(!result.is_empty());
        assert_eq!(&result[..4], &[0x89, 0x50, 0x4E, 0x47]);
    }
}
