use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

pub fn set_taskbar_identity() {
    let app_id: Vec<u16> = "com.local.memoapp\0".encode_utf16().collect();
    // Set before any windows are created so every memo shares the same group.
    let result = unsafe { SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr()) };
    if result < 0 {
        eprintln!("Unable to set taskbar identity: {result:#x}");
    }
}
