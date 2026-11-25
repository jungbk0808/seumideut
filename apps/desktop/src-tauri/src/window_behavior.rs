use std::{cell::RefCell, collections::HashMap};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
    Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    },
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{
            DefSubclassProc, RemoveWindowSubclass, SetCurrentProcessExplicitAppUserModelID,
            SetWindowSubclass,
        },
        WindowsAndMessaging::{
            GetCursorPos, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_MOVING, WM_NCDESTROY,
        },
    },
};

const SUBCLASS_ID: usize = 0x534d;

struct DragAnchor {
    window_x: i32,
    window_y: i32,
    cursor_x: i32,
    cursor_y: i32,
}

impl DragAnchor {
    fn position(&self, cursor_x: i32, cursor_y: i32) -> (i32, i32) {
        (
            self.window_x + cursor_x - self.cursor_x,
            self.window_y + cursor_y - self.cursor_y,
        )
    }
}

thread_local! {
    static DRAG_ANCHORS: RefCell<HashMap<usize, DragAnchor>> = RefCell::new(HashMap::new());
}

pub fn set_taskbar_identity() {
    let app_id: Vec<u16> = "com.local.memoapp\0".encode_utf16().collect();
    // Set before any windows are created so every memo shares the same group.
    let result = unsafe { SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr()) };
    if result < 0 {
        eprintln!("Unable to set taskbar identity: {result:#x}");
    }
}

pub fn install(window: &tauri::Window) {
    if window.label() == "full" {
        return;
    }
    let window = window.clone();
    let dispatcher = window.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        if let Ok(hwnd) = window.hwnd() {
            // The callback and its subclass data have static lifetimes.
            if unsafe { SetWindowSubclass(hwnd.0, Some(widget_proc), SUBCLASS_ID, 0) } == 0 {
                eprintln!("Unable to install widget edge snapping");
            }
        }
    });
}

fn snap_axis(position: i32, size: i32, start: i32, end: i32, threshold: i32) -> i32 {
    let last = end - size;
    // Snap from either side of an edge, but never constrain movement. Once
    // the pointer pushes the proposed position past this band, it is free.
    if position.abs_diff(start) <= threshold as u32 {
        start
    } else if position.abs_diff(last) <= threshold as u32 {
        last
    } else {
        position
    }
}

unsafe extern "system" fn widget_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if matches!(message, WM_ENTERSIZEMOVE | WM_EXITSIZEMOVE | WM_NCDESTROY) {
        DRAG_ANCHORS.with(|anchors| anchors.borrow_mut().remove(&(hwnd as usize)));
    }
    if message == WM_MOVING && lparam != 0 {
        // Windows owns this RECT for the duration of WM_MOVING.
        let rect = &mut *(lparam as *mut RECT);
        // Follow the pointer across monitors while allowing off-screen movement.
        let mut cursor: POINT = std::mem::zeroed();
        let has_cursor = GetCursorPos(&mut cursor) != 0;
        let monitor = if has_cursor {
            MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST)
        } else {
            MonitorFromRect(rect, MONITOR_DEFAULTTONEAREST)
        };
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) != 0 {
            let scale = GetDpiForWindow(hwnd).max(96) as f64 / 96.0;
            // The visible memo starts 8 logical pixels inside the shadow gutter.
            let gutter = (8.0 * scale).round() as i32;
            let threshold = (4.0 * scale).round() as i32;
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if has_cursor {
                // WM_MOVING can rebase later proposals on our snapped RECT.
                // Keep the unsnapped position tied to cumulative cursor motion
                // so slow one-pixel steps can still leave the snap band.
                let (x, y) = DRAG_ANCHORS.with(|anchors| {
                    let mut anchors = anchors.borrow_mut();
                    let anchor = anchors.entry(hwnd as usize).or_insert(DragAnchor {
                        window_x: rect.left,
                        window_y: rect.top,
                        cursor_x: cursor.x,
                        cursor_y: cursor.y,
                    });
                    anchor.position(cursor.x, cursor.y)
                });
                rect.left = x;
                rect.top = y;
            }
            rect.left = snap_axis(
                rect.left,
                width,
                info.rcWork.left - gutter,
                info.rcWork.right + gutter,
                threshold,
            );
            rect.top = snap_axis(
                rect.top,
                height,
                info.rcWork.top - gutter,
                info.rcWork.bottom + gutter,
                threshold,
            );
            rect.right = rect.left + width;
            rect.bottom = rect.top + height;
            return 1;
        }
    } else if message == WM_NCDESTROY {
        RemoveWindowSubclass(hwnd, Some(widget_proc), SUBCLASS_ID);
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

#[cfg(test)]
mod tests {
    use super::{snap_axis, DragAnchor};

    #[test]
    fn slow_pointer_steps_accumulate_while_the_window_is_snapped() {
        let anchor = DragAnchor {
            window_x: -8,
            window_y: -8,
            cursor_x: 400,
            cursor_y: 200,
        };
        for step in 0..=12 {
            let (x, y) = anchor.position(400 - step, 200 - step);
            let expected = if step <= 4 { -8 } else { -8 - step };
            assert_eq!(snap_axis(x, 320, -8, 1928, 4), expected);
            assert_eq!(snap_axis(y, 368, -8, 1088, 4), expected);
        }
        // Moving back uses the same original anchor, without drift.
        assert_eq!(anchor.position(400, 200), (-8, -8));
    }

    #[test]
    fn slow_pointer_steps_also_release_the_right_edge() {
        let anchor = DragAnchor {
            window_x: 1608,
            window_y: 100,
            cursor_x: 1800,
            cursor_y: 200,
        };
        for step in 0..=12 {
            let (x, y) = anchor.position(1800 + step, 200);
            let expected = if step <= 4 { 1608 } else { 1608 + step };
            assert_eq!(snap_axis(x, 320, -8, 1928, 4), expected);
            assert_eq!(y, 100);
        }
    }

    #[test]
    fn snaps_only_within_four_pixels_on_either_side_of_each_edge() {
        for position in [-12, -8, -4] {
            assert_eq!(snap_axis(position, 320, -8, 1928, 4), -8);
        }
        for position in [1604, 1608, 1612] {
            assert_eq!(snap_axis(position, 320, -8, 1928, 4), 1608);
        }
    }

    #[test]
    fn pushing_past_the_snap_band_allows_unrestricted_off_screen_movement() {
        for position in [-5000, -100, -13, -3, 500, 1603, 1613, 2000, 5000] {
            assert_eq!(snap_axis(position, 320, -8, 1928, 4), position);
        }
    }

    #[test]
    fn supports_negative_monitors_scaled_thresholds_and_oversized_windows() {
        // A 4 logical-pixel band becomes 6 physical pixels at 150% DPI.
        assert_eq!(snap_axis(-1922, 480, -1928, 8, 6), -1928);
        assert_eq!(snap_axis(-1921, 480, -1928, 8, 6), -1921);
        assert_eq!(snap_axis(-2000, 480, -1928, 8, 6), -2000);
        assert_eq!(snap_axis(-500, 2000, 0, 1000, 4), -500);
        assert_eq!(snap_axis(-1003, 2000, 0, 1000, 4), -1000);
    }
}
