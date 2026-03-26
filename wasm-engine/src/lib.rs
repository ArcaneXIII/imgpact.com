use wasm_bindgen::prelude::*;

/// Cross-platform warning log: browser console on WASM, stderr on native (tests).
macro_rules! console_warn {
    ($($arg:tt)*) => {{
        #[cfg(target_arch = "wasm32")]
        { web_sys::console::warn_1(&::std::format!($($arg)*).into()); }
        #[cfg(not(target_arch = "wasm32"))]
        { ::std::eprintln!("[imgpact warn] {}", ::std::format!($($arg)*)); }
    }}
}
pub(crate) use console_warn;

pub mod crop;
pub mod resize;
pub mod transform;
pub mod convert;
pub mod optimize;
pub mod effects;
pub mod gif_engine;
pub mod text;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Encode a DynamicImage to bytes in the given format at default quality.
/// Delegates to convert::encode_with_quality with quality=85.
pub(crate) fn encode_image(img: image::DynamicImage, format: &str) -> Vec<u8> {
    convert::encode_with_quality(img, format, 85)
}
