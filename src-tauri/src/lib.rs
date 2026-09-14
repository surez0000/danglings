use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
#[cfg(target_os = "windows")]
use windows::Win32::System::SystemInformation::GetTickCount;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

const HIT_RADIUS_ENTER: f64 = 42.0;
const HIT_RADIUS_EXIT: f64 = 58.0;

const CURSOR_DEADBAND_PX: f64 = 2.0;
const CURSOR_EMIT_MIN_INTERVAL: Duration = Duration::from_millis(33);
const CURSOR_SETTLE_INTERVAL: Duration = Duration::from_millis(150);

struct HitState {
    points: Vec<(f64, f64)>,
    /* Second, independently-owned point set: the reminder/update bubble. Kept
       apart from `points` because charm mode and companion mode each replace
       `points` wholesale every other frame. */
    extra_points: Vec<(f64, f64)>,
    force_interactive: bool,
    cursor_stream: bool,
}

type SharedHitState = Arc<Mutex<HitState>>;

#[tauri::command]
fn update_hit_points(state: tauri::State<SharedHitState>, points: Vec<(f64, f64)>) {
    let mut s = state.lock().unwrap();
    s.points = points;
}

#[tauri::command]
fn update_extra_hit_points(state: tauri::State<SharedHitState>, points: Vec<(f64, f64)>) {
    let mut s = state.lock().unwrap();
    s.extra_points = points;
}

// Seconds since the user last touched keyboard or mouse anywhere on the
// system — the reminders' notion of "at the desk". Permission-free on both
// platforms; polled by the frontend every few seconds, not per frame.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
}

#[cfg(target_os = "macos")]
fn idle_seconds() -> f64 {
    // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = !0
    unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) }
}

#[cfg(target_os = "windows")]
fn idle_seconds() -> f64 {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe {
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount();
            return now.wrapping_sub(info.dwTime) as f64 / 1000.0;
        }
    }
    0.0
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn idle_seconds() -> f64 {
    0.0
}

#[tauri::command]
fn get_idle_seconds() -> f64 {
    idle_seconds()
}

#[tauri::command]
fn set_force_interactive(state: tauri::State<SharedHitState>, active: bool) {
    let mut s = state.lock().unwrap();
    s.force_interactive = active;
}

#[tauri::command]
fn set_cursor_stream(state: tauri::State<SharedHitState>, active: bool) {
    let mut s = state.lock().unwrap();
    s.cursor_stream = active;
}

// The overlay is a borderless accessory panel and never becomes the key window
// on its own — without this, typing into the custom-emoji field lands in
// whatever app is behind the overlay.
#[tauri::command]
fn focus_window(window: WebviewWindow) {
    let _ = window.set_focus();
}

#[tauri::command]
fn get_stage_size(window: WebviewWindow) -> (f64, f64) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        return (size.width as f64 / scale, size.height as f64 / scale);
    }
    (1280.0, 800.0)
}

// Global cursor position converted to the window's logical coordinate space.
// Windows reports physical pixels; macOS CGEvent reports logical points — both
// are normalized here so the hit-test loop is platform-agnostic.
#[cfg(target_os = "windows")]
fn cursor_local(window_pos: (f64, f64), scale: f64) -> Option<(f64, f64)> {
    unsafe {
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_ok() {
            Some((
                (point.x as f64 - window_pos.0) / scale,
                (point.y as f64 - window_pos.1) / scale,
            ))
        } else {
            None
        }
    }
}

// Assumes the window sits on the primary monitor, whose CoreGraphics origin is
// (0, 0); multi-monitor is out of scope for v1.
#[cfg(target_os = "macos")]
fn cursor_local(window_pos: (f64, f64), scale: f64) -> Option<(f64, f64)> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    let event = CGEvent::new(source).ok()?;
    let point = event.location();
    Some((point.x - window_pos.0 / scale, point.y - window_pos.1 / scale))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn cursor_local(_window_pos: (f64, f64), _scale: f64) -> Option<(f64, f64)> {
    None
}

fn cover_primary_monitor(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let _ = window.set_position(tauri::Position::Physical(*monitor.position()));
        let _ = window.set_size(tauri::Size::Physical(*monitor.size()));
    }
}

// The visibleOnAllWorkspaces config key sets CanJoinAllSpaces at window creation,
// but tao's runtime set_visible_on_all_workspaces rewrites the whole
// collectionBehavior bitmask — so the full overlay mask is asserted here via raw
// AppKit instead, and set_visible_on_all_workspaces must never be called.
// FullScreenAuxiliary (public API since 10.7, no notarization risk) keeps the
// overlay on fullscreen Spaces; Stationary keeps Exposé from sweeping it;
// IgnoresCycle keeps it out of Cmd+`. If QA ever finds the overlay hidden behind
// a fullscreen app's content, the documented escalation is
// setLevel(NSPopUpMenuWindowLevel) via this same objc2 path — do not ship it by
// default (higher levels sit above the fullscreen menu-bar reveal).
#[cfg(target_os = "macos")]
fn apply_macos_overlay_behavior(window: &WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    let win = window.clone();
    // AppKit is main-thread-only.
    let _ = window.run_on_main_thread(move || {
        let Ok(ns) = win.ns_window() else { return };
        let ns = ns as *mut NSWindow;
        unsafe {
            (&*ns).setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_overlay_behavior(_window: &WebviewWindow) {}

fn toggle_charm(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        let _ = window.emit("overlay-visibility", false);
    } else {
        cover_primary_monitor(window);
        let _ = window.show();
        apply_macos_overlay_behavior(window);
        let _ = window.emit("overlay-visibility", true);
    }
}

fn start_hit_test_loop(app: tauri::AppHandle, state: SharedHitState) {
    thread::spawn(move || {
        let mut currently_interactive = false;
        let mut last_sent: Option<(f64, f64)> = None;
        let mut last_emit = Instant::now();
        let mut pending = false;
        loop {
            thread::sleep(Duration::from_millis(16));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }

            let scale = window.scale_factor().unwrap_or(1.0);
            let window_pos = window
                .outer_position()
                .map(|p| (p.x as f64, p.y as f64))
                .unwrap_or((0.0, 0.0));

            let (force, cursor_stream, points, extra_points) = {
                let s = state.lock().unwrap();
                (
                    s.force_interactive,
                    s.cursor_stream,
                    s.points.clone(),
                    s.extra_points.clone(),
                )
            };

            let cursor = cursor_local(window_pos, scale);

            let near_charm = if let Some((local_x, local_y)) = cursor {
                let radius = if currently_interactive { HIT_RADIUS_EXIT } else { HIT_RADIUS_ENTER };
                points.iter().chain(extra_points.iter()).any(|(px, py)| {
                    let dx = local_x - px;
                    let dy = local_y - py;
                    (dx * dx + dy * dy).sqrt() < radius
                })
            } else {
                false
            };

            let should_be_interactive = force || near_charm;
            if should_be_interactive != currently_interactive {
                let _ = window.set_ignore_cursor_events(!should_be_interactive);
                currently_interactive = should_be_interactive;
            }

            if cursor_stream {
                if let Some((x, y)) = cursor {
                    let moved = match last_sent {
                        Some((sx, sy)) => {
                            let dx = x - sx;
                            let dy = y - sy;
                            (dx * dx + dy * dy).sqrt()
                        }
                        None => f64::INFINITY,
                    };
                    if moved > CURSOR_DEADBAND_PX
                        && last_emit.elapsed() >= CURSOR_EMIT_MIN_INTERVAL
                    {
                        let _ = window.emit("cursor-moved", (x, y));
                        last_sent = Some((x, y));
                        last_emit = Instant::now();
                        pending = false;
                    } else if moved > 0.5 {
                        pending = true;
                    }
                    // Trailing settle: movement swallowed by the rate cap or the
                    // dead-band gets one final emit, so listeners never rest one
                    // frame short of the cursor's true position.
                    if pending && last_emit.elapsed() >= CURSOR_SETTLE_INTERVAL {
                        let _ = window.emit("cursor-moved", (x, y));
                        last_sent = Some((x, y));
                        last_emit = Instant::now();
                        pending = false;
                    }
                }
            } else {
                // Stream off: forget the last position so re-enabling emits
                // immediately.
                last_sent = None;
                pending = false;
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hit_state: SharedHitState = Arc::new(Mutex::new(HitState {
        points: Vec::new(),
        extra_points: Vec::new(),
        force_interactive: false,
        cursor_stream: false,
    }));

    tauri::Builder::default()
        .manage(hit_state.clone())
        .plugin(tauri_plugin_opener::init())
        // Launch at login: LaunchAgent on macOS, HKCU Run key on Windows. The
        // frontend toggles it; `--autostart` lets us tell a login launch apart.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // One-click updates: signed latest.json on GitHub Releases (see
        // tauri.conf.json plugins.updater); process plugin relaunches after install.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            toggle_charm(&window);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            update_hit_points,
            update_extra_hit_points,
            set_force_interactive,
            set_cursor_stream,
            focus_window,
            get_stage_size,
            get_idle_seconds
        ])
        .setup(move |app| {
            // Overlay app: no Dock icon, never steals focus on launch.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app.get_webview_window("main").expect("main window must exist");
            cover_primary_monitor(&window);
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.show();
            apply_macos_overlay_behavior(&window);

            start_hit_test_loop(app.handle().clone(), hit_state.clone());

            let shortcut = Shortcut::new(Some(Modifiers::SHIFT | Modifiers::ALT), Code::KeyK);
            app.global_shortcut().register(shortcut)?;

            let show_hide = MenuItem::with_id(app, "toggle", "Show/Hide Charm", true, None::<&str>)?;
            let recenter = MenuItem::with_id(app, "recenter", "Move to Top Center", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_hide, &recenter, &separator, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Danglings — Shift+Alt+K to show/hide")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(window) = app.get_webview_window("main") {
                            toggle_charm(&window);
                        }
                    }
                    "recenter" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("recenter", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
