from __future__ import annotations

import stat
import zipfile
from pathlib import Path


class UnsafeArchiveError(ValueError):
    pass


def safe_extract_zip(
    archive_path: Path,
    target_dir: Path,
    *,
    max_files: int = 20_000,
    max_uncompressed_bytes: int = 500 * 1024 * 1024,
    max_compression_ratio: int = 200,
) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    target_root = target_dir.resolve()
    total_size = 0
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        if len(members) > max_files:
            raise UnsafeArchiveError(f"archive contains more than {max_files} entries")
        for member in members:
            normalized = Path(member.filename.replace("\\", "/"))
            if normalized.is_absolute() or ".." in normalized.parts:
                raise UnsafeArchiveError(f"unsafe archive path: {member.filename}")
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise UnsafeArchiveError(f"symlinks are not allowed: {member.filename}")
            total_size += member.file_size
            if total_size > max_uncompressed_bytes:
                raise UnsafeArchiveError("archive exceeds uncompressed size limit")
            if member.compress_size > 0 and member.file_size / member.compress_size > max_compression_ratio:
                raise UnsafeArchiveError(f"suspicious compression ratio: {member.filename}")
            destination = (target_root / normalized).resolve()
            if destination != target_root and target_root not in destination.parents:
                raise UnsafeArchiveError(f"archive escapes target directory: {member.filename}")
        for member in members:
            normalized = Path(member.filename.replace("\\", "/"))
            destination = target_root / normalized
            if member.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, destination.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
