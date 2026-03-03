#![allow(non_upper_case_globals)]

use std::ffi::c_void;
use std::ptr;

type CFTypeRef = *const c_void;
type CFStringRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFIndex = isize;
type AXUIElementRef = CFTypeRef;
type AXError = i32;

const kAXErrorSuccess: AXError = 0;
const kCFStringEncodingUTF8: u32 = 0x0800_0100;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrustedWithOptions(
        options: CFDictionaryRef,
    ) -> u8;
    fn AXUIElementCreateApplication(
        pid: i32,
    ) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementPerformAction(
        element: AXUIElementRef,
        action: CFStringRef,
    ) -> AXError;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFArrayGetCount(arr: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(
        arr: CFArrayRef,
        idx: CFIndex,
    ) -> CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFStringCreateWithBytes(
        alloc: CFTypeRef,
        bytes: *const u8,
        len: CFIndex,
        encoding: u32,
        external: u8,
    ) -> CFStringRef;
    fn CFStringGetCString(
        s: CFStringRef,
        buffer: *mut u8,
        size: CFIndex,
        encoding: u32,
    ) -> u8;
    fn CFStringGetLength(s: CFStringRef) -> CFIndex;
    fn CFDictionaryCreate(
        alloc: CFTypeRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        count: CFIndex,
        key_cbs: *const c_void,
        val_cbs: *const c_void,
    ) -> CFDictionaryRef;
    static kCFBooleanTrue: CFTypeRef;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}

fn cfstr(s: &str) -> CFStringRef {
    unsafe {
        CFStringCreateWithBytes(
            ptr::null(),
            s.as_ptr(),
            s.len() as CFIndex,
            kCFStringEncodingUTF8,
            0,
        )
    }
}

fn cfstring_to_string(s: CFStringRef) -> Option<String> {
    if s.is_null() {
        return None;
    }
    unsafe {
        let len = CFStringGetLength(s);
        let buf_size = (len * 4 + 1) as usize;
        let mut buf = vec![0u8; buf_size];
        if CFStringGetCString(
            s,
            buf.as_mut_ptr(),
            buf_size as CFIndex,
            kCFStringEncodingUTF8,
        ) != 0
        {
            let end = buf
                .iter()
                .position(|&b| b == 0)
                .unwrap_or(buf.len());
            Some(
                String::from_utf8_lossy(&buf[..end])
                    .to_string(),
            )
        } else {
            None
        }
    }
}

/// Prompt macOS for Accessibility permission if not
/// granted. Returns true if already trusted.
pub fn ensure_trusted() -> bool {
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let dict = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks
                as *const c_void,
            &kCFTypeDictionaryValueCallBacks
                as *const c_void,
        );
        let trusted =
            AXIsProcessTrustedWithOptions(dict) != 0;
        CFRelease(dict);
        trusted
    }
}

/// Find the window of `pid` whose title contains
/// `needle`, AXRaise it, and return true.
pub fn raise_window(pid: i32, needle: &str) -> bool {
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return false;
        }

        let ax_windows = cfstr("AXWindows");
        let ax_title = cfstr("AXTitle");
        let ax_raise = cfstr("AXRaise");

        let mut windows: CFTypeRef = ptr::null();
        let err = AXUIElementCopyAttributeValue(
            app, ax_windows, &mut windows,
        );

        let found = if err == kAXErrorSuccess
            && !windows.is_null()
        {
            find_and_raise(
                windows, ax_title, ax_raise, needle,
            )
        } else {
            false
        };

        if !windows.is_null() {
            CFRelease(windows);
        }
        CFRelease(ax_windows);
        CFRelease(ax_title);
        CFRelease(ax_raise);
        CFRelease(app);
        found
    }
}

/// # Safety
///
/// All pointers must be valid CF/AX refs from
/// `raise_window`.
unsafe fn find_and_raise(
    windows: CFTypeRef,
    ax_title: CFStringRef,
    ax_raise: CFStringRef,
    needle: &str,
) -> bool {
    unsafe {
        let count = CFArrayGetCount(windows);
        for i in 0..count {
            let win =
                CFArrayGetValueAtIndex(windows, i);
            let mut title_ref: CFTypeRef = ptr::null();
            let err = AXUIElementCopyAttributeValue(
                win, ax_title, &mut title_ref,
            );
            if err != kAXErrorSuccess
                || title_ref.is_null()
            {
                continue;
            }
            let matched = cfstring_to_string(title_ref)
                .is_some_and(|t| title_matches(&t, needle));
            CFRelease(title_ref);
            if matched {
                AXUIElementPerformAction(win, ax_raise);
                return true;
            }
        }
        false
    }
}

fn title_matches(title: &str, needle: &str) -> bool {
    let clean =
        title.strip_prefix('\u{2026}').unwrap_or(title);
    needle.contains(clean)
        || clean.contains(needle)
        || needle.ends_with(clean)
}

/// Find PID of a running app by name (e.g. "ghostty").
pub fn find_pid(app_name: &str) -> Option<i32> {
    let output = std::process::Command::new("pgrep")
        .arg("-ix")
        .arg(app_name)
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next()?.trim().parse().ok()
}
