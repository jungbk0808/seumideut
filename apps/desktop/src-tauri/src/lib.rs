use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const STORE_FILE_NAME: &str = "notes.json";
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

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    Ok(app_data_dir.join(STORE_FILE_NAME))
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
            !store.notes.iter().any(|note| &note.id == selected_note_id)
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
            Some(index) if merged_notes[index].updated_at > incoming_note.updated_at => {}
            Some(index) => merged_notes[index] = incoming_note,
            None => merged_notes.push(incoming_note),
        }
    }

    merged_notes
        .sort_by(|first_note, second_note| second_note.updated_at.cmp(&first_note.updated_at));

    NoteStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        notes: merged_notes,
        selected_note_id: incoming_store
            .selected_note_id
            .or(existing_store.selected_note_id),
    }
}

#[tauri::command]
fn load_note_store(app: AppHandle) -> Result<NoteStore, String> {
    let path = store_path(&app)?;

    if !path.exists() {
        return Ok(NoteStore::default());
    }

    read_store_from_path(&path)
}

#[tauri::command]
fn save_note_store(app: AppHandle, store: NoteStore) -> Result<(), String> {
    let path = store_path(&app)?;
    let store_dir = path
        .parent()
        .ok_or_else(|| "Unable to resolve note store directory.".to_string())?;

    fs::create_dir_all(store_dir).map_err(|error| error.to_string())?;

    let incoming_store = normalize_note_store(store);
    let store_to_write = match read_store_from_path(&path) {
        Ok(existing_store) => merge_note_store(existing_store, incoming_store),
        Err(_) => incoming_store,
    };
    let serialized_store =
        serde_json::to_string_pretty(&store_to_write).map_err(|error| error.to_string())?;

    fs::write(path, serialized_store).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![load_note_store, save_note_store])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
