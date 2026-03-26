use wasm_bindgen::prelude::*;

// Text rendering is handled on the JS side via Canvas API as fallback.
// This stub exists so the module is registered and the JS bridge has a consistent interface.
// The wasm-bridge.js addText() function uses Canvas 2D API for actual text rendering,
// which gives full font/style support without embedding a TTF binary in the WASM bundle.

#[wasm_bindgen]
pub fn add_text_stub(image_bytes: &[u8]) -> Vec<u8> {
    image_bytes.to_vec()
}
