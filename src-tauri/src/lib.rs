//! Thin SQLite bridge. Schema and migrations live in TypeScript (src/persistence)
//! so they are testable; this side only opens the DB and runs parameterised SQL.
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Value as Json};
use std::sync::Mutex;
use tauri::Manager;

struct Db(Mutex<Connection>);

#[derive(Deserialize)]
struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<Json>,
    /// Roll the whole batch back if this statement changes no rows (optimistic-lock check).
    #[serde(default)]
    expect_changes: bool,
}

fn to_sql(v: &Json) -> Result<SqlValue, String> {
    Ok(match v {
        Json::Null => SqlValue::Null,
        Json::Bool(b) => SqlValue::Integer(*b as i64),
        Json::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().ok_or("unsupported number")?),
        },
        Json::String(s) => SqlValue::Text(s.clone()),
        _ => return Err("unsupported parameter type".into()),
    })
}

fn to_params(p: &[Json]) -> Result<Vec<SqlValue>, String> {
    p.iter().map(to_sql).collect()
}

fn run_select(conn: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(to_params(params)?)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut m = Map::new();
        for (i, name) in names.iter().enumerate() {
            let v = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => Json::Null,
                ValueRef::Integer(n) => Json::from(n),
                ValueRef::Real(f) => Json::from(f),
                ValueRef::Text(t) => Json::from(String::from_utf8_lossy(t).to_string()),
                ValueRef::Blob(_) => return Err("blob columns are not supported".into()),
            };
            m.insert(name.clone(), v);
        }
        out.push(m);
    }
    Ok(out)
}

/// Runs all statements in one transaction; returns rows changed per statement.
fn run_batch(conn: &mut Connection, statements: &[Stmt]) -> Result<Vec<usize>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut changes = Vec::with_capacity(statements.len());
    for s in statements {
        let n = tx
            .execute(&s.sql, params_from_iter(to_params(&s.params)?))
            .map_err(|e| e.to_string())?;
        if s.expect_changes && n == 0 {
            return Err("CONFLICT: record changed since it was loaded".into());
        }
        changes.push(n);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changes)
}

#[tauri::command]
fn db_select(db: tauri::State<Db>, sql: String, params: Vec<Json>) -> Result<Vec<Map<String, Json>>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    run_select(&conn, &sql, &params)
}

#[tauri::command]
fn db_batch(db: tauri::State<Db>, statements: Vec<Stmt>) -> Result<Vec<usize>, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    run_batch(&mut conn, &statements)
}

/// Consistent copy of the live database into <app data>/backups, before a destructive migration.
#[tauri::command]
fn db_backup(app: tauri::AppHandle, db: tauri::State<Db>, label: String) -> Result<String, String> {
    let safe: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let path = dir.join(format!("pre-migration-{safe}-{ts}.sqlite3"));
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().to_string()]).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = Connection::open(dir.join("dispatch-desk.sqlite3"))?;
            conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_select, db_batch, db_backup])
        .run(tauri::generate_context!())
        .expect("error while running Dispatch Desk");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stmt(sql: &str, params: Vec<Json>, expect_changes: bool) -> Stmt {
        Stmt { sql: sql.into(), params, expect_changes }
    }

    #[test]
    fn batch_is_atomic_and_conflict_rolls_everything_back() {
        let mut c = Connection::open_in_memory().unwrap();
        run_batch(&mut c, &[stmt("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)", vec![], false), stmt("INSERT INTO t VALUES (1, 'a')", vec![], false)]).unwrap();
        let err = run_batch(
            &mut c,
            &[
                stmt("INSERT INTO t VALUES (2, 'b')", vec![], false),
                stmt("UPDATE t SET v = ? WHERE id = ?", vec![json!("x"), json!(99)], true),
            ],
        )
        .unwrap_err();
        assert!(err.starts_with("CONFLICT"));
        let rows = run_select(&c, "SELECT id, v FROM t ORDER BY id", &[]).unwrap();
        assert_eq!(rows.len(), 1, "insert before the conflict must be rolled back");
    }

    #[test]
    fn select_maps_types_and_binds_params() {
        let mut c = Connection::open_in_memory().unwrap();
        run_batch(&mut c, &[stmt("CREATE TABLE t (a INTEGER, b TEXT, c REAL, d TEXT)", vec![], false), stmt("INSERT INTO t VALUES (?, ?, ?, ?)", vec![json!(7), json!("x"), json!(1.5), Json::Null], false)]).unwrap();
        let rows = run_select(&c, "SELECT * FROM t WHERE a = ?", &[json!(7)]).unwrap();
        assert_eq!(Json::Object(rows[0].clone()), json!({"a": 7, "b": "x", "c": 1.5, "d": null}));
    }

    #[test]
    fn unsupported_param_types_are_rejected() {
        let c = Connection::open_in_memory().unwrap();
        assert!(run_select(&c, "SELECT ?", &[json!([1])]).is_err());
    }
}
