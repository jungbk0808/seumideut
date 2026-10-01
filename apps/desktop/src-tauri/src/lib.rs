mod note_files;

use note_files::{
    apply_notes, latest_notes, migrate_legacy_store, move_notes, normalize_notes, read_disk_notes,
    NoteStore, CURRENT_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default)]
    storage_dir: Option<String>,
    // Which note a window opens with. It is per device, so it stays out of the
    // note folder that may be shared through a sync service.
    #[serde(default)]
    selected_note_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageSettings {
    storage_dir: Option<String>,
    effective_dir: String,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SETTINGS_FILE_NAME))
}

fn read_settings(app: &AppHandle) -> AppSettings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw_settings| serde_json::from_str(&raw_settings).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let settings_dir = path
        .parent()
        .ok_or_else(|| "Unable to resolve settings directory.".to_string())?;

    fs::create_dir_all(settings_dir).map_err(|error| error.to_string())?;
    fs::write(
        path,
        serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match read_settings(app)
        .storage_dir
        .filter(|storage_dir| !storage_dir.trim().is_empty())
    {
        Some(storage_dir) => Ok(PathBuf::from(storage_dir)),
        None => app_data_dir(app),
    }
}

fn storage_settings(app: &AppHandle) -> Result<StorageSettings, String> {
    Ok(StorageSettings {
        storage_dir: read_settings(app).storage_dir,
        effective_dir: store_dir(app)?.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn load_note_store(app: AppHandle, store_lock: State<'_, Mutex<()>>) -> Result<NoteStore, String> {
    let _guard = store_lock.lock().map_err(|error| error.to_string())?;
    let dir = store_dir(&app)?;

    migrate_legacy_store(&dir)?;

    let notes = latest_notes(&read_disk_notes(&dir));
    let selected_note_id = read_settings(&app).selected_note_id.filter(|selected_id| {
        notes
            .iter()
            .any(|note| &note.id == selected_id && note.deleted_at.is_none())
    });

    Ok(NoteStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        notes,
        selected_note_id,
    })
}

#[tauri::command]
fn save_note_store(
    app: AppHandle,
    store: NoteStore,
    store_lock: State<'_, Mutex<()>>,
) -> Result<(), String> {
    let _guard = store_lock.lock().map_err(|error| error.to_string())?;
    let dir = store_dir(&app)?;
    let mut notes = store.notes;

    migrate_legacy_store(&dir)?;
    normalize_notes(&mut notes);
    apply_notes(&dir, &notes)?;

    if let Some(selected_note_id) = store.selected_note_id {
        let mut settings = read_settings(&app);

        if settings.selected_note_id.as_ref() != Some(&selected_note_id) {
            settings.selected_note_id = Some(selected_note_id);
            write_settings(&app, &settings)?;
        }
    }

    Ok(())
}

#[tauri::command]
fn get_storage_settings(app: AppHandle) -> Result<StorageSettings, String> {
    storage_settings(&app)
}

#[tauri::command]
fn set_storage_dir(
    app: AppHandle,
    dir: String,
    store_lock: State<'_, Mutex<()>>,
) -> Result<StorageSettings, String> {
    let _guard = store_lock.lock().map_err(|error| error.to_string())?;
    let target_dir = PathBuf::from(dir.trim());

    if !target_dir.is_absolute() {
        return Err("Storage folder must be an absolute path.".to_string());
    }

    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;

    let current_dir = store_dir(&app)?;
    let is_same_folder = matches!(
        (fs::canonicalize(&current_dir), fs::canonicalize(&target_dir)),
        (Ok(current), Ok(target)) if current == target
    );

    if !is_same_folder {
        move_notes(&current_dir, &target_dir)?;
    }

    let mut settings = read_settings(&app);
    settings.storage_dir = Some(target_dir.to_string_lossy().into_owned());
    write_settings(&app, &settings)?;

    storage_settings(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_note_store,
            save_note_store,
            get_storage_settings,
            set_storage_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
