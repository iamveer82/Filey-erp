// Portable backup integrity and key recovery. Only called with a held storage
// gate; tests use random keys and disposable files, never the OS credential store.
use super::{atomic_write, decrypt_with_key, encrypt_with_key, ENC_MAGIC};
use base64::Engine as _;
use rand::RngCore as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::{Component, Path, PathBuf}};

const MANIFEST: &str = "filey-backup.json";
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[derive(Serialize, Deserialize)]
struct FileEntry { path: String, sha256: String }
#[derive(Serialize, Deserialize)]
struct Manifest { database_sha256: String, files: Vec<FileEntry>, file_key: [u8;32] }
#[derive(Serialize, Deserialize)]
struct Envelope { version: u8, sealed: String, local_recovery: String }

pub(super) fn sha256(path: &Path) -> Result<String,String> {
    let mut file = fs::File::open(path).map_err(|e|e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8;65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e|e.to_string())?;
        if n == 0 { break; }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}",hash.finalize()))
}

fn files(root: &Path, directory: &Path, out: &mut Vec<FileEntry>) -> Result<(),String> {
    if !directory.exists() { return Ok(()); }
    for entry in fs::read_dir(directory).map_err(|e|e.to_string())? {
        let entry = entry.map_err(|e|e.to_string())?;
        let kind = entry.file_type().map_err(|e|e.to_string())?;
        if kind.is_symlink() { return Err("Backup files must not contain symbolic links.".into()); }
        if kind.is_dir() { files(root,&entry.path(),out)?; }
        else if kind.is_file() {
            let path = entry.path();
            let rel = path.strip_prefix(root).map_err(|e|e.to_string())?.to_str().ok_or("A backup filename is invalid")?.replace('\\',"/");
            out.push(FileEntry { path: rel, sha256: sha256(&path)? });
        }
    }
    Ok(())
}

pub(super) fn contains_encrypted_files(root: &Path) -> Result<bool,String> {
    let mut entries = Vec::new();
    files(root,root,&mut entries)?;
    for entry in entries {
        let mut header = [0;5];
        let mut file = fs::File::open(root.join(entry.path)).map_err(|e|e.to_string())?;
        if file.read(&mut header).map_err(|e|e.to_string())? == header.len() && header == ENC_MAGIC { return Ok(true); }
    }
    Ok(false)
}

pub(super) fn seal(directory: &Path, file_key: &[u8;32]) -> Result<String,String> {
    let root = directory.join("files");
    let mut entries = Vec::new();
    files(&root,&root,&mut entries)?;
    // Authentication also catches a missing/wrong OS key before declaring success.
    for entry in &entries { decrypt_with_key(&fs::read(root.join(&entry.path)).map_err(|e|e.to_string())?,file_key)?; }
    let manifest = Manifest { database_sha256: sha256(&directory.join("filey-erp.db"))?, files: entries, file_key: *file_key };
    let mut recovery = [0u8;32];
    rand::rngs::OsRng.fill_bytes(&mut recovery);
    let envelope = Envelope {
        version: 1,
        sealed: B64.encode(encrypt_with_key(&serde_json::to_vec(&manifest).map_err(|e|e.to_string())?,&recovery)?),
        local_recovery: B64.encode(encrypt_with_key(&recovery,file_key)?),
    };
    atomic_write(&directory.join(MANIFEST),&serde_json::to_vec(&envelope).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let hex: String = recovery.iter().map(|v|format!("{v:02x}")).collect();
    Ok(hex.as_bytes().chunks(8).map(|chunk| std::str::from_utf8(chunk).unwrap()).collect::<Vec<_>>().join("-"))
}

fn recovery_key(code: &str) -> Result<[u8;32],String> {
    let compact: String = code.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    if compact.len()!=64 || !compact.is_ascii() { return Err("Enter the complete backup recovery code.".into()); }
    let mut key = [0u8;32];
    for (i, byte) in key.iter_mut().enumerate() { *byte = u8::from_str_radix(&compact[i*2..i*2+2],16).map_err(|_|"The backup recovery code is invalid.")?; }
    Ok(key)
}

fn decrypt_envelope(value: &str, key: &[u8;32]) -> Result<Vec<u8>,String> {
    let bytes = B64.decode(value).map_err(|_|"The backup manifest is damaged.")?;
    if !bytes.starts_with(ENC_MAGIC) { return Err("The backup manifest is not authenticated.".into()); }
    decrypt_with_key(&bytes,key).map_err(|_|"The recovery code does not unlock this backup, or the backup is damaged.".into())
}

fn checked_path(root: &Path, name: &str) -> Result<PathBuf,String> {
    let rel = Path::new(name);
    if name.is_empty() || rel.components().any(|component| !matches!(component,Component::Normal(_))) {
        return Err("The backup contains an unsafe file path.".into());
    }
    Ok(root.join(rel))
}

/// Write restored files under the current OS key, leaving the original backup
/// untouched. A recovery code makes the backup portable across OS accounts.
pub(super) fn restore(source: &Path, stage: &Path, current_key: &[u8;32], code: Option<&str>) -> Result<(),String> {
    let root = source.join("files");
    let mut source_entries = Vec::new();
    files(&root,&root,&mut source_entries)?;
    let (entries, backup_key, database_hash) = if source.join(MANIFEST).exists() {
        let envelope: Envelope = serde_json::from_slice(&fs::read(source.join(MANIFEST)).map_err(|e|e.to_string())?).map_err(|_|"The backup manifest is invalid.")?;
        if envelope.version != 1 { return Err("This backup requires a newer version of Filey.".into()); }
        let recovery = if let Some(code) = code.filter(|value| !value.trim().is_empty()) { recovery_key(code)? }
            else {
                let bytes = decrypt_envelope(&envelope.local_recovery,current_key).map_err(|_|"Enter this backup's recovery code to restore it on this device.")?;
                bytes.try_into().map_err(|_|"The backup recovery key is invalid.")?
            };
        let manifest: Manifest = serde_json::from_slice(&decrypt_envelope(&envelope.sealed,&recovery)?).map_err(|_|"The backup manifest is damaged.")?;
        if manifest.database_sha256 != sha256(&source.join("filey-erp.db"))? { return Err("The backup database checksum does not match. No active records were changed.".into()); }
        if manifest.files.len() != source_entries.len() { return Err("The backup file inventory is incomplete.".into()); }
        (manifest.files,manifest.file_key,manifest.database_sha256)
    } else {
        // Legacy backups can still be restored on the original OS account.
        // They have no portable key envelope; a code cannot manufacture the lost key.
        (source_entries,*current_key,sha256(&source.join("filey-erp.db"))?)
    };
    fs::create_dir_all(stage.join("files")).map_err(|e|e.to_string())?;
    let canonical_root = root.canonicalize().ok();
    for entry in entries {
        let src = checked_path(&root,&entry.path)?;
        let resolved = src.canonicalize().map_err(|_|"A backup file is missing.")?;
        if !canonical_root.as_ref().is_some_and(|root| resolved.starts_with(root)) { return Err("A backup file escapes its source folder.".into()); }
        let bytes = fs::read(src).map_err(|e|e.to_string())?;
        if format!("{:x}",Sha256::digest(&bytes)) != entry.sha256 { return Err("A backup file checksum does not match.".into()); }
        let plain = decrypt_with_key(&bytes,&backup_key)
            .map_err(|_|"A backup file cannot be decrypted. Older backups require the original OS encryption key.")?;
        let target = checked_path(&stage.join("files"),&entry.path)?;
        fs::create_dir_all(target.parent().ok_or("Invalid backup file path")?).map_err(|e|e.to_string())?;
        atomic_write(&target,&encrypt_with_key(&plain,current_key)?).map_err(|e|e.to_string())?;
    }
    fs::copy(source.join("filey-erp.db"),stage.join("filey-erp.db")).map_err(|e|e.to_string())?;
    if sha256(&stage.join("filey-erp.db"))? != database_hash { return Err("The backup database changed during the restore. No active records were changed.".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_backup_recovers_on_another_account_and_rejects_bad_codes_and_tampering() {
        let root = std::env::temp_dir().join(format!("filey-backup-test-{}",uuid::Uuid::new_v4()));
        let source = root.join("backup");
        fs::create_dir_all(source.join("files/user")).unwrap();
        fs::write(source.join("filey-erp.db"),b"fixture database").unwrap();
        fs::write(source.join("files/user/invoice.pdf"),encrypt_with_key(b"invoice PDF",&[7;32]).unwrap()).unwrap();
        let code = seal(&source,&[7;32]).unwrap();
        assert!(restore(&source,&root.join("missing-code"),&[8;32],None).is_err());
        assert!(restore(&source,&root.join("wrong-code"),&[8;32],Some(&"00".repeat(32))).is_err());
        let stage = root.join("restored");
        restore(&source,&stage,&[8;32],Some(&code)).unwrap();
        assert_eq!(decrypt_with_key(&fs::read(stage.join("files/user/invoice.pdf")).unwrap(),&[8;32]).unwrap(),b"invoice PDF");
        restore(&source,&root.join("same-account"),&[7;32],None).unwrap();
        fs::write(source.join("files/user/invoice.pdf"),b"tampered").unwrap();
        assert!(restore(&source,&root.join("tampered"),&[8;32],Some(&code)).is_err());
        assert!(checked_path(&root,"../outside").is_err());
        assert_eq!(root.parent(),Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(root).unwrap();
    }
}
