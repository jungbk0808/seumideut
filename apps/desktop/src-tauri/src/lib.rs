use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const STORE_FILE_NAME: &str = "notes.json";
const SETTINGS_FILE_NAME: &str = "settings.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;

fn current_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    title: String,
    content: String,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
    #[serde(default)]
    is_pinned: bool,
    #[serde(default = "current_schema_version")]
    schema_version: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteStore {
    #[serde(default = "current_schema_version")]
    schema_version: u32,
    #[serde(default)]
    notes: Vec<Note>,
    selected_note_id: Option<String>,
}

impl Default for NoteStore {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            notes: Vec::new(),
            selected_note_id: None,
        }
    }
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default)]
    storage_dir: Option<String>,
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

fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match read_settings(app)
        .storage_dir
        .filter(|storage_dir| !storage_dir.trim().is_empty())
    {
        Some(storage_dir) => Ok(PathBuf::from(storage_dir)),
        None => app_data_dir(app),
    }
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(store_dir(app)?.join(STORE_FILE_NAME))
}

fn storage_settings(app: &AppHandle) -> Result<StorageSettings, String> {
    Ok(StorageSettings {
        storage_dir: read_settings(app).storage_dir,
        effective_dir: store_dir(app)?.to_string_lossy().into_owned(),
    })
}

fn write_store_to_path(path: &PathBuf, store: &NoteStore) -> Result<(), String> {
    let store_dir = path
        .parent()
        .ok_or_else(|| "Unable to resolve note store directory.".to_string())?;

    fs::create_dir_all(store_dir).map_err(|error| error.to_string())?;

    let serialized_store =
        serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;

    fs::write(path, serialized_store).map_err(|error| error.to_string())
}

fn read_store_from_path(path: &PathBuf) -> Result<NoteStore, String> {
    let raw_store = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw_store)
        .map(normalize_note_store)
        .map_err(|error| error.to_string())
}

fn normalize_note_store(mut store: NoteStore) -> NoteStore {
    store.schema_version = CURRENT_SCHEMA_VERSION;

    for note in &mut store.notes {
        note.schema_version = CURRENT_SCHEMA_VERSION;
    }

    store
        .notes
        .sort_by(|first_note, second_note| second_note.updated_at.cmp(&first_note.updated_at));

    if store
        .selected_note_id
        .as_ref()
        .is_some_and(|selected_note_id| {
            !store
                .notes
                .iter()
                .any(|note| &note.id == selected_note_id && note.deleted_at.is_none())
        })
    {
        store.selected_note_id = None;
    }

    store
}

fn merge_note_store(existing_store: NoteStore, incoming_store: NoteStore) -> NoteStore {
    let mut merged_notes = existing_store.notes;

    for incoming_note in incoming_store.notes {
        match merged_notes
            .iter()
            .position(|note| note.id == incoming_note.id)
        {
            Some(index)
                if (merged_notes[index].deleted_at.is_some()
                    && incoming_note.deleted_at.is_none())
                    || (merged_notes[index].deleted_at == incoming_note.deleted_at
                        && merged_notes[index].updated_at > incoming_note.updated_at) => {}
            Some(index) => merged_notes[index] = incoming_note,
            None => merged_notes.push(incoming_note),
        }
    }

    merged_notes
        .sort_by(|first_note, second_note| second_note.updated_at.cmp(&first_note.updated_at));

    normalize_note_store(NoteStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        notes: merged_notes,
        selected_note_id: incoming_store
            .selected_note_id
            .or(existing_store.selected_note_id),
    })
}

#[tauri::command]
fn load_note_store(app: AppHandle, store_lock: State<'_, Mutex<()>>) -> Result<NoteStore, String> {
    let _guard = store_lock.lock().map_err(|error| error.to_string())?;
    let path = store_path(&app)?;

    if !path.exists() {
        return Ok(NoteStore::default());
    }

    read_store_from_path(&path)
}

#[tauri::command]
fn save_note_store(
    app: AppHandle,
    store: NoteStore,
    store_lock: State<'_, Mutex<()>>,
) -> Result<(), String> {
    let _guard = store_lock.lock().map_err(|error| error.to_string())?;
    let path = store_path(&app)?;

    let incoming_store = normalize_note_store(store);
    let store_to_write = match read_store_from_path(&path) {
        Ok(existing_store) => merge_note_store(existing_store, incoming_store),
        Err(_) => incoming_store,
    };

    write_store_to_path(&path, &store_to_write)
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

    let current_path = store_path(&app)?;
    let target_path = target_dir.join(STORE_FILE_NAME);

    // Move existing notes into the new folder. The old file is removed only after
    // the new one is written, so a failed move never drops data.
    if current_path != target_path {
        if let Ok(current_store) = read_store_from_path(&current_path) {
            let next_store = match read_store_from_path(&target_path) {
                Ok(existing_store) => merge_note_store(existing_store, current_store),
                Err(_) => normalize_note_store(current_store),
            };

            write_store_to_path(&target_path, &next_store)?;
            let _ = fs::remove_file(&current_path);
        }
    }

    let settings = AppSettings {
        storage_dir: Some(target_dir.to_string_lossy().into_owned()),
    };
    let settings_file = settings_path(&app)?;
    let settings_dir = settings_file
        .parent()
        .ok_or_else(|| "Unable to resolve settings directory.".to_string())?;

    fs::create_dir_all(settings_dir).map_err(|error| error.to_string())?;
    fs::write(
        &settings_file,
        serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, updated_at: &str, deleted_at: Option<&str>) -> Note {
        Note {
            id: id.to_string(),
            title: "memo".to_string(),
            content: "content".to_string(),
            created_at: "2026-09-27T00:00:00.000Z".to_string(),
            updated_at: updated_at.to_string(),
            deleted_at: deleted_at.map(str::to_string),
            is_pinned: false,
            schema_version: CURRENT_SCHEMA_VERSION,
        }
    }

    #[test]
    fn deleted_note_cannot_be_restored_by_a_stale_window() {
        let deleted_at = "2026-09-27T00:00:02.000Z";
        let existing_store = NoteStore {
            schema_version: CURRENT_SCHEMA_VERSION,
            notes: vec![note("one", deleted_at, Some(deleted_at))],
            selected_note_id: None,
        };
        let stale_store = NoteStore {
            schema_version: CURRENT_SCHEMA_VERSION,
            notes: vec![note("one", "2026-09-27T00:00:03.000Z", None)],
            selected_note_id: Some("one".to_string()),
        };

        let merged_store = merge_note_store(existing_store, stale_store);

        assert_eq!(
            merged_store.notes[0].deleted_at.as_deref(),
            Some(deleted_at)
        );
        assert_eq!(merged_store.selected_note_id, None);
    }

    #[test]
    fn deletion_replaces_a_newer_unsaved_note() {
        let deleted_at = "2026-09-27T00:00:02.000Z";
        let existing_store = NoteStore {
            schema_version: CURRENT_SCHEMA_VERSION,
            notes: vec![note("one", "2026-09-27T00:00:03.000Z", None)],
            selected_note_id: Some("one".to_string()),
        };
        let incoming_store = NoteStore {
            schema_version: CURRENT_SCHEMA_VERSION,
            notes: vec![note("one", deleted_at, Some(deleted_at))],
            selected_note_id: None,
        };

        let merged_store = merge_note_store(existing_store, incoming_store);

        assert_eq!(
            merged_store.notes[0].deleted_at.as_deref(),
            Some(deleted_at)
        );
        assert_eq!(merged_store.selected_note_id, None);
    }
}
