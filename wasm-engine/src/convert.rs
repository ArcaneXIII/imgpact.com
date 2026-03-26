use wasm_bindgen::prelude::*;
use image::{load_from_memory, guess_format, DynamicImage, ImageFormat};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{PngEncoder, CompressionType, FilterType};
use image::codecs::webp::WebPEncoder;
use image::codecs::tiff::TiffEncoder;
use image::codecs::avif::AvifEncoder;
use serde::Serialize;
use std::io::Cursor;

#[derive(Serialize)]
struct ImageInfo {
    width: u32,
    height: u32,
    format: String,
    file_size: usize,
}

#[wasm_bindgen]
pub fn convert_image(image_bytes: &[u8], to_format: &str, quality: u8) -> Vec<u8> {
    let img = match load_from_memory(image_bytes) {
        Ok(img) => img,
        Err(e) => {
            crate::console_warn!("Failed to decode image: {}", e);
            return Vec::new();
        }
    };
    encode_with_quality(img, to_format, quality)
}

/// Batch handling is done JS-side by calling convert_image per file.
#[wasm_bindgen]
pub fn convert_image_batch(image_bytes: &[u8], to_format: &str, quality: u8) -> Vec<u8> {
    convert_image(image_bytes, to_format, quality)
}

#[wasm_bindgen]
pub fn get_image_info(image_bytes: &[u8]) -> JsValue {
    let format_str = match guess_format(image_bytes) {
        Ok(f) => format!("{:?}", f).to_lowercase(),
        Err(_) => "unknown".to_string(),
    };
    let (width, height) = match load_from_memory(image_bytes) {
        Ok(img) => (img.width(), img.height()),
        Err(_) => (0, 0),
    };
    let info = ImageInfo {
        width,
        height,
        format: format_str,
        file_size: image_bytes.len(),
    };
    serde_wasm_bindgen::to_value(&info).unwrap_or(JsValue::NULL)
}

// ─── Test helpers (shared with sibling test modules via pub(crate)) ───────────
#[cfg(test)]
pub(crate) mod test_helpers {
    use image::{DynamicImage, RgbImage, Rgb, ImageFormat};
    use std::io::Cursor;

    pub fn make_png(width: u32, height: u32) -> Vec<u8> {
        let mut img = RgbImage::new(width, height);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = Rgb([(x * 255 / width) as u8, (y * 255 / height) as u8, 128]);
        }
        let mut buf = Vec::new();
        DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
            .unwrap();
        buf
    }

    pub fn make_gif(width: u16, height: u16, frame_count: usize) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut enc = gif::Encoder::new(&mut buf, width, height, &[]).unwrap();
            enc.set_repeat(gif::Repeat::Infinite).unwrap();
            for i in 0..frame_count {
                let r = if i % 2 == 0 { 200u8 } else { 50u8 };
                let mut pixels = vec![0u8; width as usize * height as usize * 4];
                for j in (0..pixels.len()).step_by(4) {
                    pixels[j]     = r;
                    pixels[j + 1] = 100;
                    pixels[j + 2] = 50;
                    pixels[j + 3] = 255;
                }
                let mut frame = gif::Frame::from_rgba_speed(width, height, &mut pixels, 10);
                frame.delay = 10; // 100 ms
                enc.write_frame(&frame).unwrap();
            }
        } // encoder dropped here → GIF trailer written, buf fully released
        buf
    }
}

pub(crate) fn encode_with_quality(img: DynamicImage, format: &str, quality: u8) -> Vec<u8> {
    let mut buf = Vec::new();
    let result = match format.to_lowercase().as_str() {
        "jpg" | "jpeg" => {
            let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
            img.write_with_encoder(encoder)
        }
        "webp" => {
            // image 0.25 WebPEncoder only exposes lossless; quality param unused for WebP
            let encoder = WebPEncoder::new_lossless(&mut buf);
            img.write_with_encoder(encoder)
        }
        "png" => {
            let compression = if quality < 34 {
                CompressionType::Fast
            } else if quality < 67 {
                CompressionType::Default
            } else {
                CompressionType::Best
            };
            let encoder = PngEncoder::new_with_quality(&mut buf, compression, FilterType::Adaptive);
            img.write_with_encoder(encoder)
        }
        "bmp" => img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Bmp),
        "ico" => img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Ico),
        "gif" => img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Gif),
        "tiff" | "tif" => {
            let mut cursor = Cursor::new(Vec::new());
            let encoder = TiffEncoder::new(&mut cursor);
            match img.write_with_encoder(encoder) {
                Ok(_) => return cursor.into_inner(),
                Err(e) => {
                    crate::console_warn!("Failed to encode as tiff: {}", e);
                    return Vec::new();
                }
            }
        }
        "avif" => {
            let encoder = AvifEncoder::new_with_speed_quality(&mut buf, 4, quality);
            img.write_with_encoder(encoder)
        }
        _ => {
            // Default to PNG
            let encoder = PngEncoder::new(&mut buf);
            img.write_with_encoder(encoder)
        }
    };
    match result {
        Ok(_) => buf,
        Err(e) => {
            crate::console_warn!("Failed to encode as {}: {}", format, e);
            Vec::new()
        }
    }
}

// ─── Unit tests ──────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use super::test_helpers::make_png;
    use image::load_from_memory;

    fn img64() -> DynamicImage {
        load_from_memory(&make_png(64, 64)).unwrap()
    }

    #[test]
    fn encode_png_magic_bytes() {
        let b = encode_with_quality(img64(), "png", 85);
        assert!(!b.is_empty(), "PNG output must not be empty");
        assert_eq!(&b[..4], &[0x89, 0x50, 0x4E, 0x47], "wrong PNG magic");
    }

    #[test]
    fn encode_jpeg_magic_bytes() {
        let b = encode_with_quality(img64(), "jpg", 85);
        assert!(!b.is_empty());
        assert_eq!(&b[..3], &[0xFF, 0xD8, 0xFF], "wrong JPEG magic");
    }

    #[test]
    fn encode_jpeg_quality_affects_size() {
        let high = encode_with_quality(img64(), "jpg", 95);
        let low  = encode_with_quality(img64(), "jpg", 5);
        assert!(high.len() > low.len(), "higher quality should produce larger JPEG");
    }

    #[test]
    fn encode_webp_magic_bytes() {
        let b = encode_with_quality(img64(), "webp", 85);
        assert!(!b.is_empty());
        // WebP: RIFF....WEBP
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(&b[8..12], b"WEBP");
    }

    #[test]
    fn encode_gif_magic_bytes() {
        let b = encode_with_quality(img64(), "gif", 85);
        assert!(!b.is_empty());
        assert_eq!(&b[..3], b"GIF");
    }

    #[test]
    fn encode_bmp_magic_bytes() {
        let b = encode_with_quality(img64(), "bmp", 85);
        assert!(!b.is_empty());
        assert_eq!(&b[..2], b"BM");
    }

    #[test]
    fn encode_tiff_magic_bytes() {
        let b = encode_with_quality(img64(), "tiff", 85);
        assert!(!b.is_empty());
        // TIFF: little-endian II or big-endian MM
        assert!(b[0..2] == *b"II" || b[0..2] == *b"MM", "wrong TIFF magic");
    }

    #[test]
    fn encode_unknown_defaults_to_png() {
        let b = encode_with_quality(img64(), "xyz_unknown", 85);
        assert!(!b.is_empty());
        assert_eq!(&b[..4], &[0x89, 0x50, 0x4E, 0x47]);
    }

    #[test]
    fn encode_png_roundtrip_preserves_dimensions() {
        let b = encode_with_quality(img64(), "png", 85);
        let decoded = load_from_memory(&b).unwrap();
        assert_eq!(decoded.width(), 64);
        assert_eq!(decoded.height(), 64);
    }

    #[test]
    fn convert_image_jpeg_returns_bytes() {
        let png = make_png(32, 32);
        let result = convert_image(&png, "jpg", 85);
        assert!(!result.is_empty());
        assert_eq!(&result[..3], &[0xFF, 0xD8, 0xFF]);
    }

    #[test]
    fn convert_image_bad_input_returns_empty() {
        let garbage = b"this is not an image";
        let result = convert_image(garbage, "png", 85);
        assert!(result.is_empty(), "bad input should return empty Vec");
    }
}
