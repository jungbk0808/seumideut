//! File-per-note storage.
//!
//! Every note is a Markdown file with a small front matter header so it can be
//! opened in any editor:
//!
//! ```text
//! ---
//! id: "..."
//! title: "..."
//! createdAt: "..."
//! updatedAt: "..."
//! isPinned: false
//! schemaVersion: 1
//! ---
//! note body
//! ```
//!
//! Front matter values are JSON scalars (valid YAML as well), which keeps
//! escaping of quotes and line breaks unambiguous. Deleted notes are kept as
//! tombstones in `.deleted/` so a stale window cannot bring them back.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

const LEGACY_STORE_FILE_NAME: &str = "notes.json";
const MIGRATED_STORE_FILE_NAME: &str = "notes.json.migrated";
const DELETED_DIR_NAME: &str = ".deleted";
const NOTE_FILE_EXTENSION: &str = "md";
const FRONT_MATTER_FENCE: &str = "---";
const UNTITLED_FILE_STEM: &str = "제목 없음";
const MAX_FILE_STEM_CHARS: usize = 80;
const RESERVED_FILE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn current_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub is_pinned: bool,
    #[serde(default = "current_schema_version")]
    pub schema_version: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteStore {
    #[serde(default = "current_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub notes: Vec<Note>,
    pub selected_note_id: Option<String>,
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

pub struct DiskNote {
    pub note: Note,
    pub path: PathBuf,
}

pub fn normalize_notes(notes: &mut [Note]) {
    for note in notes {
        note.schema_version = CURRENT_SCHEMA_VERSION;
    }
}

pub fn sort_newest_first(notes: &mut [Note]) {
    notes.sort_by(|first_note, second_note| second_note.updated_at.cmp(&first_note.updated_at));
}

/// Decides whether `incoming` should replace `existing`: a deletion is never
/// undone by a stale copy, and an older edit never overwrites a newer one.
pub fn incoming_wins(existing: &Note, incoming: &Note) -> bool {
    let restores_deleted_note = existing.deleted_at.is_some() && incoming.deleted_at.is_none();
    let is_older_edit =
        existing.deleted_at == incoming.deleted_at && existing.updated_at > incoming.updated_at;

    !(restores_deleted_note || is_older_edit)
}

pub fn serialize_note(note: &Note) -> Result<String, String> {
    let field = |value: &str| serde_json::to_string(value).map_err(|error| error.to_string());
    let mut raw_note = format!("{FRONT_MATTER_FENCE}\n");

    raw_note.push_str(&format!("id: {}\n", field(&note.id)?));
    raw_note.push_str(&format!("title: {}\n", field(&note.title)?));
    raw_note.push_str(&format!("createdAt: {}\n", field(&note.created_at)?));
    raw_note.push_str(&format!("updatedAt: {}\n", field(&note.updated_at)?));
    if let Some(deleted_at) = &note.deleted_at {
        raw_note.push_str(&format!("deletedAt: {}\n", field(deleted_at)?));
    }
    raw_note.push_str(&format!("isPinned: {}\n", note.is_pinned));
    raw_note.push_str(&format!("schemaVersion: {}\n", note.schema_version));
    raw_note.push_str(&format!("{FRONT_MATTER_FENCE}\n"));
    raw_note.push_str(&note.content);

    Ok(raw_note)
}

/// Returns `None` for files that are not notes written by this app, such as a
/// plain Markdown file someone dropped into the folder.
pub fn parse_note(raw_note: &str) -> Option<Note> {
    let raw_note = raw_note.strip_prefix('\u{feff}').unwrap_or(raw_note);
    let mut remaining = raw_note
        .strip_prefix("---\r\n")
        .or_else(|| raw_note.strip_prefix("---\n"))?;
    let mut fields: HashMap<&str, Value> = HashMap::new();

    loop {
        if remaining.is_empty() {
            return None;
        }

        let (line, tail) = remaining.split_once('\n').unwrap_or((remaining, ""));
        let line = line.trim_end_matches('\r');
        remaining = tail;

        if line == FRONT_MATTER_FENCE {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }

        // Unknown or hand-written keys are skipped instead of invalidating the note.
        if let Some((key, value)) = line.split_once(':') {
            if let Ok(value) = serde_json::from_str::<Value>(value.trim()) {
                fields.insert(key.trim(), value);
            }
        }
    }

    let text = |key: &str| fields.get(key).and_then(Value::as_str);
    let updated_at = text("updatedAt").unwrap_or("1970-01-01T00:00:00.000Z");

    Some(Note {
        id: text("id")?.to_string(),
        title: text("title").unwrap_or_default().to_string(),
        content: remaining.to_string(),
        created_at: text("createdAt").unwrap_or(updated_at).to_string(),
        updated_at: updated_at.to_string(),
        deleted_at: text("deletedAt").map(str::to_string),
        is_pinned: fields
            .get("isPinned")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        schema_version: CURRENT_SCHEMA_VERSION,
    })
}

/// Turns arbitrary text into a safe, readable Windows file name stem.
pub fn sanitize_file_stem(value: &str) -> String {
    let replaced: String = value
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let limited: String = replaced.trim().chars().take(MAX_FILE_STEM_CHARS).collect();
    let stem = limited.trim().trim_matches('.').trim().to_string();

    if stem.is_empty() {
        return UNTITLED_FILE_STEM.to_string();
    }

    let base_name = stem.split('.').next().unwrap_or("").to_uppercase();
    if RESERVED_FILE_NAMES.contains(&base_name.as_str()) {
        return format!("{stem}_");
    }

    stem
}

fn short_id(id: &str) -> String {
    sanitize_file_stem(&id.chars().take(8).collect::<String>())
}

fn deleted_dir(dir: &Path) -> PathBuf {
    dir.join(DELETED_DIR_NAME)
}

fn collect_note_files(dir: &Path, disk_notes: &mut Vec<DiskNote>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_note_file = path.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case(NOTE_FILE_EXTENSION));
        if !is_note_file {
            continue;
        }

        if let Some(note) = fs::read_to_string(&path)
            .ok()
            .and_then(|raw_note| parse_note(&raw_note))
        {
            disk_notes.push(DiskNote { note, path });
        }
    }
}

/// Every note file in `dir`, including deletion tombstones. The same note id
/// can appear more than once (for example a sync conflict copy).
pub fn read_disk_notes(dir: &Path) -> Vec<DiskNote> {
    let mut disk_notes = Vec::new();

    collect_note_files(dir, &mut disk_notes);
    collect_note_files(&deleted_dir(dir), &mut disk_notes);

    disk_notes
}

/// One note per id, picking the version that wins when copies disagree.
pub fn latest_notes(disk_notes: &[DiskNote]) -> Vec<Note> {
    let mut latest: HashMap<&str, &Note> = HashMap::new();

    for disk_note in disk_notes {
        let note = &disk_note.note;
        let replaces_current = latest
            .get(note.id.as_str())
            .is_none_or(|current| incoming_wins(current, note));

        if replaces_current {
            latest.insert(note.id.as_str(), note);
        }
    }

    let mut notes: Vec<Note> = latest.into_values().cloned().collect();
    sort_newest_first(&mut notes);
    notes
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Unable to resolve note directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let temp_path = path.with_extension("md.tmp");
    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })
}

/// Writes every incoming note that wins over what is already on disk. Notes
/// that are not part of `incoming` are left untouched.
pub fn apply_notes(dir: &Path, incoming: &[Note]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;

    let disk_notes = read_disk_notes(dir);
    let mut paths_by_id: HashMap<String, Vec<PathBuf>> = HashMap::new();
    // Lower-cased active file name -> owning note id, because Windows ignores case.
    let mut names_in_use: HashMap<String, String> = HashMap::new();
    let deleted_dir = deleted_dir(dir);

    for disk_note in &disk_notes {
        paths_by_id
            .entry(disk_note.note.id.clone())
            .or_default()
            .push(disk_note.path.clone());

        if disk_note.path.parent() == Some(dir) {
            if let Some(name) = disk_note.path.file_name().and_then(|name| name.to_str()) {
                names_in_use.insert(name.to_lowercase(), disk_note.note.id.clone());
            }
        }
    }

    for note in incoming {
        let existing = disk_notes
            .iter()
            .filter(|disk_note| disk_note.note.id == note.id)
            .map(|disk_note| &disk_note.note)
            .fold(None::<&Note>, |winner, candidate| match winner {
                Some(current) if !incoming_wins(current, candidate) => Some(current),
                _ => Some(candidate),
            });

        if existing.is_some_and(|existing| !incoming_wins(existing, note)) {
            continue;
        }

        let target = if note.deleted_at.is_some() {
            deleted_dir.join(format!(
                "{}.{NOTE_FILE_EXTENSION}",
                sanitize_file_stem(&note.id)
            ))
        } else {
            let stem = sanitize_file_stem(&note.title);
            let mut name = format!("{stem}.{NOTE_FILE_EXTENSION}");
            let is_taken_by_other = names_in_use
                .get(&name.to_lowercase())
                .is_some_and(|owner_id| owner_id != &note.id);

            if is_taken_by_other {
                name = format!("{stem} ({}).{NOTE_FILE_EXTENSION}", short_id(&note.id));
            }

            dir.join(name)
        };

        let serialized_note = serialize_note(note)?;
        let is_unchanged = fs::read_to_string(&target).is_ok_and(|current| current == serialized_note);
        if !is_unchanged {
            write_atomic(&target, &serialized_note)?;
        }

        // A renamed or deleted note must not leave its previous file behind.
        for old_path in paths_by_id.get(&note.id).into_iter().flatten() {
            if old_path != &target {
                let _ = fs::remove_file(old_path);
                if let Some(name) = old_path.file_name().and_then(|name| name.to_str()) {
                    names_in_use.remove(&name.to_lowercase());
                }
            }
        }

        if note.deleted_at.is_none() {
            if let Some(name) = target.file_name().and_then(|name| name.to_str()) {
                names_in_use.insert(name.to_lowercase(), note.id.clone());
            }
        }
        paths_by_id.insert(note.id.clone(), vec![target]);
    }

    Ok(())
}

/// Imports the former single-file `notes.json` once, then keeps it as a backup.
pub fn migrate_legacy_store(dir: &Path) -> Result<(), String> {
    let legacy_path = dir.join(LEGACY_STORE_FILE_NAME);
    if !legacy_path.is_file() {
        return Ok(());
    }

    let Ok(mut store) = fs::read_to_string(&legacy_path)
        .map_err(|error| error.to_string())
        .and_then(|raw_store| {
            serde_json::from_str::<NoteStore>(&raw_store).map_err(|error| error.to_string())
        })
    else {
        // An unreadable legacy file is left in place instead of being lost.
        return Ok(());
    };

    normalize_notes(&mut store.notes);
    apply_notes(dir, &store.notes)?;
    fs::rename(&legacy_path, dir.join(MIGRATED_STORE_FILE_NAME)).map_err(|error| error.to_string())
}

/// Moves every note file from `current_dir` into `target_dir`. The old files are
/// removed only after the new ones are written, so a failed move never drops data.
pub fn move_notes(current_dir: &Path, target_dir: &Path) -> Result<(), String> {
    migrate_legacy_store(current_dir)?;
    migrate_legacy_store(target_dir)?;

    let current_disk_notes = read_disk_notes(current_dir);
    let mut notes = latest_notes(&current_disk_notes);

    normalize_notes(&mut notes);
    apply_notes(target_dir, &notes)?;

    for disk_note in &current_disk_notes {
        let _ = fs::remove_file(&disk_note.path);
    }
    // Only succeeds when the tombstone folder is empty.
    let _ = fs::remove_dir(deleted_dir(current_dir));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_DIR_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn test_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "seumideut-test-{}-{}-{label}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn note(id: &str, title: &str, updated_at: &str, deleted_at: Option<&str>) -> Note {
        Note {
            id: id.to_string(),
            title: title.to_string(),
            content: "content".to_string(),
            created_at: "2026-09-27T00:00:00.000Z".to_string(),
            updated_at: updated_at.to_string(),
            deleted_at: deleted_at.map(str::to_string),
            is_pinned: false,
            schema_version: CURRENT_SCHEMA_VERSION,
        }
    }

    fn markdown_file_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.path().is_file())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn deleted_note_cannot_be_restored_by_a_stale_window() {
        let deleted_at = "2026-09-27T00:00:02.000Z";
        let existing = note("one", "memo", deleted_at, Some(deleted_at));
        let stale = note("one", "memo", "2026-09-27T00:00:03.000Z", None);

        assert!(!incoming_wins(&existing, &stale));
    }

    #[test]
    fn deletion_replaces_a_newer_unsaved_note() {
        let deleted_at = "2026-09-27T00:00:02.000Z";
        let existing = note("one", "memo", "2026-09-27T00:00:03.000Z", None);
        let deletion = note("one", "memo", deleted_at, Some(deleted_at));

        assert!(incoming_wins(&existing, &deletion));
    }

    #[test]
    fn older_edit_does_not_overwrite_a_newer_one() {
        let existing = note("one", "memo", "2026-09-27T00:00:03.000Z", None);
        let older = note("one", "memo", "2026-09-27T00:00:01.000Z", None);

        assert!(!incoming_wins(&existing, &older));
    }

    #[test]
    fn note_round_trips_through_markdown() {
        let mut original = note("id-1", "제목: \"따옴표\"\n줄바꿈", "2026-09-27T00:00:01.000Z", None);
        original.content = "# 제목\n\n---\n본문 --- 안의 구분선\n\n끝 줄바꿈\n".to_string();
        original.is_pinned = true;

        let parsed = parse_note(&serialize_note(&original).unwrap()).unwrap();

        assert_eq!(parsed.id, original.id);
        assert_eq!(parsed.title, original.title);
        assert_eq!(parsed.content, original.content);
        assert_eq!(parsed.updated_at, original.updated_at);
        assert!(parsed.is_pinned);
        assert_eq!(parsed.deleted_at, None);
    }

    #[test]
    fn parser_accepts_windows_line_endings_and_unknown_keys() {
        let raw = "---\r\nid: \"a\"\r\ntitle: \"t\"\r\ntags: [x, y]\r\nupdatedAt: \"2026-09-27T00:00:01.000Z\"\r\n---\r\nbody\r\n";

        let parsed = parse_note(raw).unwrap();

        assert_eq!(parsed.id, "a");
        assert_eq!(parsed.title, "t");
        assert_eq!(parsed.content, "body\r\n");
    }

    #[test]
    fn parser_ignores_files_without_a_note_header() {
        assert!(parse_note("# 그냥 마크다운\n").is_none());
        assert!(parse_note("---\nid: \"a\"\n").is_none());
        assert!(parse_note("---\ntitle: \"id 없음\"\n---\nbody").is_none());
    }

    #[test]
    fn file_stem_is_safe_for_windows() {
        assert_eq!(sanitize_file_stem("a/b:c*d?"), "a_b_c_d_");
        assert_eq!(sanitize_file_stem("   "), UNTITLED_FILE_STEM);
        assert_eq!(sanitize_file_stem("..."), UNTITLED_FILE_STEM);
        assert_eq!(sanitize_file_stem("con"), "con_");
        assert_eq!(sanitize_file_stem(&"가".repeat(200)).chars().count(), 80);
    }

    #[test]
    fn notes_are_written_as_named_markdown_files_and_read_back() {
        let dir = test_dir("write");
        let notes = vec![
            note("id-aaaaaaaa", "오늘 회의 메모", "2026-09-27T00:00:01.000Z", None),
            note("id-bbbbbbbb", "블로그 초안", "2026-09-27T00:00:02.000Z", None),
        ];

        apply_notes(&dir, &notes).unwrap();

        assert_eq!(
            markdown_file_names(&dir),
            vec!["블로그 초안.md", "오늘 회의 메모.md"]
        );
        let read_back = latest_notes(&read_disk_notes(&dir));
        assert_eq!(read_back.len(), 2);
        assert_eq!(read_back[0].id, "id-bbbbbbbb");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rapid_edits_restore_the_latest_saved_content() {
        let dir = test_dir("rapid-edits");
        let mut first = note("one", "메모", "2026-09-27T00:00:01.000Z", None);
        first.content = "첫 입력".to_string();
        let mut latest = first.clone();
        latest.content = "첫 입력 다음 입력 최종".to_string();
        latest.updated_at = "2026-09-27T00:00:02.000Z".to_string();

        apply_notes(&dir, &[first]).unwrap();
        apply_notes(&dir, &[latest.clone()]).unwrap();

        let restored = latest_notes(&read_disk_notes(&dir));
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].content, latest.content);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unwritable_store_path_reports_a_save_error() {
        let dir = test_dir("save-error");
        fs::write(&dir, "not a directory").unwrap();

        assert!(apply_notes(
            &dir,
            &[note("one", "메모", "2026-09-27T00:00:01.000Z", None)]
        )
        .is_err());
        assert_eq!(fs::read_to_string(&dir).unwrap(), "not a directory");
        let _ = fs::remove_file(&dir);
    }

    #[test]
    fn same_title_gets_a_distinct_file_name() {
        let dir = test_dir("collision");
        let notes = vec![
            note("11111111-a", "회의", "2026-09-27T00:00:01.000Z", None),
            note("22222222-b", "회의", "2026-09-27T00:00:02.000Z", None),
        ];

        apply_notes(&dir, &notes).unwrap();

        assert_eq!(markdown_file_names(&dir), vec!["회의 (22222222).md", "회의.md"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn changing_the_title_renames_the_file_without_leaving_a_copy() {
        let dir = test_dir("rename");
        apply_notes(&dir, &[note("one", "처음", "2026-09-27T00:00:01.000Z", None)]).unwrap();

        apply_notes(&dir, &[note("one", "바뀐 제목", "2026-09-27T00:00:02.000Z", None)]).unwrap();

        assert_eq!(markdown_file_names(&dir), vec!["바뀐 제목.md"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_a_note_moves_it_to_a_tombstone_that_blocks_restores() {
        let dir = test_dir("delete");
        let deleted_at = "2026-09-27T00:00:02.000Z";
        apply_notes(&dir, &[note("one", "메모", "2026-09-27T00:00:01.000Z", None)]).unwrap();

        apply_notes(&dir, &[note("one", "메모", deleted_at, Some(deleted_at))]).unwrap();
        apply_notes(&dir, &[note("one", "메모", "2026-09-27T00:00:03.000Z", None)]).unwrap();

        assert!(markdown_file_names(&dir).is_empty());
        let notes = latest_notes(&read_disk_notes(&dir));
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].deleted_at.as_deref(), Some(deleted_at));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn moving_notes_carries_files_and_tombstones_and_merges_with_the_target() {
        let current = test_dir("move-from");
        let target = test_dir("move-to");
        let deleted_at = "2026-09-27T00:00:02.000Z";
        apply_notes(
            &current,
            &[
                note("one", "옮길 메모", "2026-09-27T00:00:01.000Z", None),
                note("two", "삭제된 메모", deleted_at, Some(deleted_at)),
                note("shared", "공유", "2026-09-27T00:00:05.000Z", None),
            ],
        )
        .unwrap();
        apply_notes(
            &target,
            &[
                note("three", "원래 있던 메모", "2026-09-27T00:00:03.000Z", None),
                note("shared", "공유", "2026-09-27T00:00:09.000Z", None),
            ],
        )
        .unwrap();

        move_notes(&current, &target).unwrap();

        assert!(read_disk_notes(&current).is_empty());
        assert!(!current.join(DELETED_DIR_NAME).exists());
        assert_eq!(
            markdown_file_names(&target),
            vec!["공유.md", "옮길 메모.md", "원래 있던 메모.md"]
        );
        let notes = latest_notes(&read_disk_notes(&target));
        assert_eq!(notes.len(), 4);
        let shared = notes.iter().find(|note| note.id == "shared").unwrap();
        assert_eq!(shared.updated_at, "2026-09-27T00:00:09.000Z");
        assert!(notes
            .iter()
            .any(|note| note.id == "two" && note.deleted_at.is_some()));
        let _ = fs::remove_dir_all(&current);
        let _ = fs::remove_dir_all(&target);
    }

    #[test]
    fn legacy_notes_json_is_imported_once_and_kept_as_backup() {
        let dir = test_dir("legacy");
        fs::create_dir_all(&dir).unwrap();
        let store = NoteStore {
            schema_version: 1,
            notes: vec![note("one", "예전 메모", "2026-09-27T00:00:01.000Z", None)],
            selected_note_id: None,
        };
        fs::write(
            dir.join(LEGACY_STORE_FILE_NAME),
            serde_json::to_string(&store).unwrap(),
        )
        .unwrap();

        migrate_legacy_store(&dir).unwrap();
        migrate_legacy_store(&dir).unwrap();

        assert!(!dir.join(LEGACY_STORE_FILE_NAME).exists());
        assert!(dir.join(MIGRATED_STORE_FILE_NAME).exists());
        assert_eq!(latest_notes(&read_disk_notes(&dir)).len(), 1);
        assert!(dir.join("예전 메모.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
