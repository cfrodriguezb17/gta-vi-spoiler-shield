#![no_std]
use core::panic::PanicInfo;
#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// Each JS worker owns one module instance and calls the encoder synchronously.
static mut VECTOR: [f32; 384] = [0.0; 384];
#[no_mangle]
pub extern "C" fn clear() {
    unsafe {
        VECTOR = [0.0; 384];
    }
}
#[no_mangle]
pub extern "C" fn accumulate(slot: usize, weight: f32) {
    if slot < 384 {
        unsafe {
            VECTOR[slot] += weight;
        }
    }
}
#[no_mangle]
pub extern "C" fn finish() -> *const f32 {
    unsafe {
        let ptr = core::ptr::addr_of_mut!(VECTOR).cast::<f32>();
        let mut sum = 0.0;
        for i in 0..384 {
            sum += (*ptr.add(i)) * (*ptr.add(i));
        }
        if sum > 0.0 {
            // Newton iteration for the L2 norm in a freestanding WASM target.
            let mut norm = sum;
            for _ in 0..24 {
                norm = (norm + sum / norm) * 0.5;
            }
            for i in 0..384 {
                *ptr.add(i) /= norm;
            }
        }
        ptr
    }
}
