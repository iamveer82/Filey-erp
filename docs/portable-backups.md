# Backups, recovery and storage moves

Settings → Data → Backup & restore creates a verified database snapshot and a
copy of saved files. It then shows a recovery code. Save that code separately,
for example in your password manager. Filey does not upload or retain the code
in application settings.

The recovery code is a random 256-bit key, not a password requiring a password
derivation step. It authenticates and decrypts the backup manifest, which
contains the file encryption key and checksums for the database and file
inventory. Files keep their AES-GCM encryption. The database in the backup is
readable business data; keep the entire backup folder private.

On the original OS account, the secure store can unlock the recovery envelope
automatically. On another OS account or after reinstalling the OS, enter the
saved recovery code. Restored files are encrypted with the destination account's
file key. An unavailable secure store is an error; it never causes replacement
of an existing key.

Legacy backups have no portable key envelope. They can still be restored using
the original OS encryption key. A new recovery code cannot recover an old key
that has already been lost. Create a new portable backup while the old files
are still readable.

Restores are built in a new workspace folder and checked before activation.
The active pointer changes on restart; the original database, files and backup
remain intact. If activation fails, Filey opens the existing workspace and
shows the error in Data settings. Cancelling a pending change removes its
activation request, not its copied files.

Moving the data folder requires a separate empty destination. Filey copies a
consistent SQLite snapshot and its saved files together, validates them, then
queues activation. New native writes are blocked until restart so they cannot
land in the old folder after the snapshot. Desktop multi-collection document
writes and their sync journal are committed in one SQLite transaction.

Native checks: initialize the MSVC environment with
`VsDevCmd.bat -arch=x64 -host_arch=x86` on this workstation, then run
`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`.
Fixtures use temporary databases, files and test encryption keys; they do not
read the user's secure store or change business records.
