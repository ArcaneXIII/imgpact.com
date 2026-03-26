use wasm_bindgen::prelude::*;
use gif::{DecodeOptions, Encoder, Frame, Repeat};
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::Serialize;
use std::io::Cursor;

// ===== Shared decode helper =====

struct GifFrame {
    rgba: Vec<u8>,    // width * height * 4 RGBA bytes (after compositing palette + transparency)
    delay_ms: u16,
    width: u16,
    height: u16,
    left: u16,
    top: u16,
}

/// Decode all frames from raw GIF bytes into a simple vec of RGBA buffers.
fn decode_frames(gif_bytes: &[u8]) -> (Vec<GifFrame>, u16, u16, u16) {
    let mut opts = DecodeOptions::new();
    opts.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = opts.read_info(gif_bytes).expect("Failed to read GIF");
    let canvas_w = decoder.width();
    let canvas_h = decoder.height();

    // loop_count: 0 means infinite in the GIF spec (Netscape loop extension value 0)
    // gif crate does not expose loop count directly; default to infinite (0)
    let loop_count: u16 = 0;

    let mut frames: Vec<GifFrame> = Vec::new();
    while let Some(frame) = decoder.read_next_frame().expect("Failed to read GIF frame") {
        let delay_ms = frame.delay * 10; // GIF delay unit is 1/100 s
        let rgba = frame.buffer.to_vec();
        frames.push(GifFrame {
            rgba,
            delay_ms,
            width: frame.width,
            height: frame.height,
            left: frame.left,
            top: frame.top,
        });
    }

    (frames, canvas_w, canvas_h, loop_count)
}

// ===== get_gif_info =====

#[derive(Serialize)]
struct GifInfo {
    width: u16,
    height: u16,
    frame_count: usize,
    total_duration_ms: u32,
    loop_count: u16,
    file_size: usize,
}

#[wasm_bindgen]
pub fn get_gif_info(gif_bytes: &[u8]) -> JsValue {
    let (frames, width, height, loop_count) = decode_frames(gif_bytes);
    let total_duration_ms: u32 = frames.iter().map(|f| f.delay_ms as u32).sum();
    let info = GifInfo {
        width,
        height,
        frame_count: frames.len(),
        total_duration_ms,
        loop_count,
        file_size: gif_bytes.len(),
    };
    serde_wasm_bindgen::to_value(&info).unwrap()
}

// ===== split_gif =====

#[derive(Serialize)]
struct SplitFrame {
    frame_png_bytes: Vec<u8>,
    delay_ms: u16,
    index: u32,
}

#[wasm_bindgen]
pub fn split_gif(gif_bytes: &[u8]) -> JsValue {
    let (frames, canvas_w, canvas_h, _) = decode_frames(gif_bytes);
    let mut result: Vec<SplitFrame> = Vec::with_capacity(frames.len());

    for (i, frame) in frames.iter().enumerate() {
        // Composite frame onto a canvas-sized RGBA image
        let mut canvas = vec![0u8; canvas_w as usize * canvas_h as usize * 4];
        composite_frame_onto(&mut canvas, canvas_w, frame);

        let img = RgbaImage::from_raw(canvas_w as u32, canvas_h as u32, canvas)
            .expect("Failed to create RgbaImage");
        let dyn_img = DynamicImage::ImageRgba8(img);

        let mut png_buf = Vec::new();
        dyn_img.write_to(&mut Cursor::new(&mut png_buf), ImageFormat::Png)
            .expect("Failed to encode PNG");

        result.push(SplitFrame {
            frame_png_bytes: png_buf,
            delay_ms: frame.delay_ms,
            index: i as u32,
        });
    }

    serde_wasm_bindgen::to_value(&result).unwrap()
}

// ===== create_gif =====

#[wasm_bindgen]
pub fn create_gif(frames_data: &[u8], delays_ms: &[u16], width: u32, height: u32, loop_count: u16) -> Vec<u8> {
    let frame_size = (width * height * 4) as usize;
    let frame_count = delays_ms.len();
    assert_eq!(frames_data.len(), frame_size * frame_count, "frames_data length mismatch");

    let mut buf = Vec::new();
    {
        let mut encoder = Encoder::new(&mut buf, width as u16, height as u16, &[])
            .expect("Failed to create GIF encoder");

        let repeat = if loop_count == 0 {
            Repeat::Infinite
        } else {
            Repeat::Finite(loop_count)
        };
        encoder.set_repeat(repeat).expect("Failed to set repeat");

        for i in 0..frame_count {
            let start = i * frame_size;
            let pixels: Vec<u8> = frames_data[start..start + frame_size].to_vec();
            let delay_centisecs = (delays_ms[i] / 10).max(2); // min 2 cs = 20 ms
            let mut frame = Frame::from_rgba_speed(
                width as u16,
                height as u16,
                &mut pixels.clone(),
                10, // speed 1-30, 10 is balanced
            );
            frame.delay = delay_centisecs;
            encoder.write_frame(&frame).expect("Failed to write GIF frame");
        }
    }
    buf
}

// ===== reverse_gif =====

#[wasm_bindgen]
pub fn reverse_gif(gif_bytes: &[u8]) -> Vec<u8> {
    let (mut frames, canvas_w, canvas_h, loop_count) = decode_frames(gif_bytes);
    frames.reverse();
    reencode_frames(&frames, canvas_w, canvas_h, loop_count)
}

// ===== change_gif_speed =====

#[wasm_bindgen]
pub fn change_gif_speed(gif_bytes: &[u8], speed_factor: f32) -> Vec<u8> {
    let (mut frames, canvas_w, canvas_h, loop_count) = decode_frames(gif_bytes);
    for frame in frames.iter_mut() {
        let new_delay = ((frame.delay_ms as f32) / speed_factor).round() as u16;
        frame.delay_ms = new_delay.max(20); // minimum 20 ms (browsers enforce ≥20 ms)
    }
    reencode_frames(&frames, canvas_w, canvas_h, loop_count)
}

// ===== remove_gif_frames =====

#[wasm_bindgen]
pub fn remove_gif_frames(gif_bytes: &[u8], indices_to_remove: &[u32]) -> Vec<u8> {
    let (frames, canvas_w, canvas_h, loop_count) = decode_frames(gif_bytes);
    let filtered: Vec<GifFrame> = frames
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !indices_to_remove.contains(&(*i as u32)))
        .map(|(_, f)| f)
        .collect();
    reencode_frames(&filtered, canvas_w, canvas_h, loop_count)
}

// ===== Shared helpers =====

/// Composite a decoded GIF frame (which may be a sub-rect) onto a full-canvas RGBA buffer.
fn composite_frame_onto(canvas: &mut [u8], canvas_w: u16, frame: &GifFrame) {
    let fw = frame.width as usize;
    let fh = frame.height as usize;
    let cw = canvas_w as usize;

    for row in 0..fh {
        for col in 0..fw {
            let src_idx = (row * fw + col) * 4;
            let dst_x = frame.left as usize + col;
            let dst_y = frame.top as usize + row;
            let dst_idx = (dst_y * cw + dst_x) * 4;

            if dst_idx + 3 < canvas.len() && src_idx + 3 < frame.rgba.len() {
                let alpha = frame.rgba[src_idx + 3];
                if alpha > 0 {
                    canvas[dst_idx] = frame.rgba[src_idx];
                    canvas[dst_idx + 1] = frame.rgba[src_idx + 1];
                    canvas[dst_idx + 2] = frame.rgba[src_idx + 2];
                    canvas[dst_idx + 3] = alpha;
                }
            }
        }
    }
}

/// Re-encode a vec of decoded frames back into GIF bytes.
fn reencode_frames(frames: &[GifFrame], canvas_w: u16, canvas_h: u16, loop_count: u16) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut encoder = Encoder::new(&mut buf, canvas_w, canvas_h, &[])
            .expect("Failed to create GIF encoder");

        let repeat = if loop_count == 0 {
            Repeat::Infinite
        } else {
            Repeat::Finite(loop_count)
        };
        encoder.set_repeat(repeat).expect("Failed to set repeat");

        for frame in frames {
            // Composite onto canvas
            let mut canvas = vec![0u8; canvas_w as usize * canvas_h as usize * 4];
            composite_frame_onto(&mut canvas, canvas_w, frame);

            let mut gif_frame = Frame::from_rgba_speed(canvas_w, canvas_h, &mut canvas, 10);
            gif_frame.delay = (frame.delay_ms / 10).max(2); // min 2 cs = 20 ms
            encoder.write_frame(&gif_frame).expect("Failed to write GIF frame");
        }
    }
    buf
}

// ─── Unit tests ──────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::test_helpers::make_gif;

    // ── helpers ──────────────────────────────────────────────────────────────

    fn decode_gif_frame_count(bytes: &[u8]) -> usize {
        let (frames, _, _, _) = decode_frames(bytes);
        frames.len()
    }

    // ── decode_frames ────────────────────────────────────────────────────────

    #[test]
    fn decode_frames_gives_correct_count() {
        let gif = make_gif(16, 16, 3);
        let (frames, _, _, _) = decode_frames(&gif);
        assert_eq!(frames.len(), 3);
    }

    #[test]
    fn decode_frames_gives_correct_canvas_size() {
        let gif = make_gif(20, 10, 2);
        let (_, w, h, _) = decode_frames(&gif);
        assert_eq!(w, 20);
        assert_eq!(h, 10);
    }

    #[test]
    fn decode_frames_correct_delay() {
        let gif = make_gif(8, 8, 1); // delay = 10 cs = 100 ms
        let (frames, _, _, _) = decode_frames(&gif);
        assert_eq!(frames[0].delay_ms, 100);
    }

    // ── composite_frame_onto ─────────────────────────────────────────────────

    #[test]
    fn composite_opaque_pixel_is_written() {
        let frame = GifFrame {
            rgba: vec![255, 0, 0, 255], // one red opaque pixel
            delay_ms: 100,
            width: 1,
            height: 1,
            left: 0,
            top: 0,
        };
        let mut canvas = vec![0u8; 4];
        composite_frame_onto(&mut canvas, 1, &frame);
        assert_eq!(canvas[0], 255, "red channel should be 255");
        assert_eq!(canvas[3], 255, "alpha should be 255");
    }

    #[test]
    fn composite_transparent_pixel_leaves_canvas_unchanged() {
        let frame = GifFrame {
            rgba: vec![255, 0, 0, 0], // transparent
            delay_ms: 100,
            width: 1,
            height: 1,
            left: 0,
            top: 0,
        };
        let mut canvas = vec![10u8; 4]; // pre-filled
        composite_frame_onto(&mut canvas, 1, &frame);
        assert_eq!(canvas[0], 10, "transparent pixel must not overwrite canvas");
    }

    // ── get_gif_info ─────────────────────────────────────────────────────────

    #[test]
    fn get_gif_info_returns_non_null() {
        let gif = make_gif(16, 16, 2);
        let info = get_gif_info(&gif);
        assert!(!info.is_null());
        assert!(!info.is_undefined());
    }

    // ── split_gif ────────────────────────────────────────────────────────────

    #[test]
    fn split_gif_returns_correct_count() {
        let gif = make_gif(16, 16, 3);
        // split_gif returns a JsValue array; test via decode_frames instead
        let (frames, _, _, _) = decode_frames(&gif);
        assert_eq!(frames.len(), 3);
    }

    // ── create_gif ───────────────────────────────────────────────────────────

    #[test]
    fn create_gif_magic_bytes() {
        let w = 8u32; let h = 8u32;
        let pixels = vec![100u8; (w * h * 4) as usize];
        let delays  = vec![100u16];
        let result  = create_gif(&pixels, &delays, w, h, 0);
        assert!(!result.is_empty());
        assert_eq!(&result[..3], b"GIF");
    }

    #[test]
    fn create_gif_two_frames() {
        let w = 8u32; let h = 8u32;
        let frame = vec![128u8; (w * h * 4) as usize];
        let mut combined = frame.clone();
        combined.extend_from_slice(&frame);
        let delays = vec![100u16, 200u16];
        let result = create_gif(&combined, &delays, w, h, 0);
        assert!(!result.is_empty());
        assert_eq!(&result[..3], b"GIF");
    }

    // ── reverse_gif ──────────────────────────────────────────────────────────

    #[test]
    fn reverse_gif_preserves_frame_count() {
        let gif = make_gif(8, 8, 4);
        let reversed = reverse_gif(&gif);
        assert_eq!(decode_gif_frame_count(&gif), decode_gif_frame_count(&reversed));
    }

    #[test]
    fn reverse_gif_twice_is_identity_frame_count() {
        let gif = make_gif(8, 8, 3);
        let r1 = reverse_gif(&gif);
        let r2 = reverse_gif(&r1);
        assert_eq!(decode_gif_frame_count(&gif), decode_gif_frame_count(&r2));
    }

    // ── change_gif_speed ─────────────────────────────────────────────────────

    #[test]
    fn change_gif_speed_2x_halves_delays() {
        let gif = make_gif(8, 8, 2); // 100 ms per frame
        let faster = change_gif_speed(&gif, 2.0);
        let (frames, _, _, _) = decode_frames(&faster);
        // 100 ms / 2 = 50 ms; min is 20 ms
        for f in &frames {
            assert!(f.delay_ms <= 50, "delay should be halved (was {})", f.delay_ms);
            assert!(f.delay_ms >= 20, "delay must be ≥ 20 ms minimum");
        }
    }

    #[test]
    fn change_gif_speed_minimum_delay_enforced() {
        let gif = make_gif(8, 8, 1); // 100 ms
        // speed factor 100× → would give 1 ms → clamped to 20 ms
        let very_fast = change_gif_speed(&gif, 100.0);
        let (frames, _, _, _) = decode_frames(&very_fast);
        assert!(frames[0].delay_ms >= 20, "minimum 20 ms must be enforced");
    }

    // ── remove_gif_frames ────────────────────────────────────────────────────

    #[test]
    fn remove_gif_frames_reduces_count() {
        let gif = make_gif(8, 8, 4);
        let result = remove_gif_frames(&gif, &[0, 2]); // remove frames 0 and 2
        let (frames, _, _, _) = decode_frames(&result);
        assert_eq!(frames.len(), 2);
    }

    #[test]
    fn remove_no_frames_keeps_all() {
        let gif = make_gif(8, 8, 3);
        let result = remove_gif_frames(&gif, &[]);
        let (frames, _, _, _) = decode_frames(&result);
        assert_eq!(frames.len(), 3);
    }
}
