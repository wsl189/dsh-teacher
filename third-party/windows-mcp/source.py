"""Pin, validate, and install the reviewed Windows-MCP source independently of PyPI metadata."""

import ast
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[2]
INPUTS = ROOT / "third-party/windows-mcp"


def digest(data: bytes) -> str:
    """Return the SHA-256 of one exact build input."""
    return hashlib.sha256(data).hexdigest()


def tool_signatures(files: dict[str, bytes]) -> dict:
    """Read decorated tool signatures without importing Windows-only modules."""
    tools = {}
    for path, data in sorted(files.items()):
        if not path.startswith("windows_mcp/tools/") or not path.endswith(".py"):
            continue
        for node in ast.walk(ast.parse(data, filename=path)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call):
                    continue
                if not isinstance(decorator.func, ast.Attribute) or decorator.func.attr != "tool":
                    continue
                name = next((ast.literal_eval(kw.value) for kw in decorator.keywords if kw.arg == "name"), None)
                if name is None:
                    raise ValueError(f"Tool in {path} has no explicit name")
                if name in tools:
                    raise ValueError(f"Duplicate tool name: {name}")
                args = node.args.posonlyargs + node.args.args
                defaults = [None] * (len(args) - len(node.args.defaults)) + node.args.defaults
                tools[name] = [
                    {
                        "name": arg.arg,
                        "annotation": ast.unparse(arg.annotation) if arg.annotation is not None else None,
                        "default": ast.unparse(default) if default is not None else None,
                    }
                    for arg, default in zip(args + node.args.kwonlyargs, defaults + node.args.kw_defaults)
                    if arg.arg != "ctx"
                ]
    if not tools:
        raise ValueError("Windows-MCP source contains no named tools")
    return dict(sorted(tools.items()))


def snapshot(source_root: Path) -> None:
    """Generate deterministic source and signature inputs from a reviewed checkout."""
    package = source_root / "src/windows_mcp"
    files = {
        "windows_mcp/" + path.relative_to(package).as_posix(): path.read_bytes()
        for path in sorted(package.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    }
    signatures = tool_signatures(files)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for path, data in files.items():
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, data)
    archive_path = INPUTS / "windows-mcp-source.zip"
    signatures_path = INPUTS / "tool-signatures.json"
    archive_path.write_bytes(archive.getvalue())
    signatures_path.write_text(json.dumps(signatures, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    metadata_path = INPUTS / "runtime.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["source"] = {
        "description": "Reviewed Windows-MCP-main source snapshot",
        "archive": archive_path.relative_to(ROOT).as_posix(),
        "sha256": digest(archive.getvalue()),
        "fileCount": len(files),
        "toolSignatures": signatures_path.relative_to(ROOT).as_posix(),
        "toolSignaturesSha256": digest(signatures_path.read_bytes()),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Pinned {len(files)} source files and {len(signatures)} tool signatures")


def checked_input(root: Path, path: str, expected_hash: str) -> bytes:
    """Read a repository-owned artifact only after its digest matches the manifest."""
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"Build input escapes the repository: {path}")
    data = resolved.read_bytes()
    if digest(data) != expected_hash:
        raise ValueError(f"Windows-MCP SHA-256 mismatch: {path}")
    return data


def prepared_source(root: Path, metadata: dict) -> dict[str, bytes]:
    """Validate every source input and patch before returning the complete runtime tree."""
    source = metadata["source"]
    archive = checked_input(root, source["archive"], source["sha256"])
    signatures = json.loads(checked_input(root, source["toolSignatures"], source["toolSignaturesSha256"]))
    files = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for member in bundle.infolist():
            path = PurePosixPath(member.filename)
            if (
                path.is_absolute() or ".." in path.parts or "\\" in member.filename
                or len(path.parts) < 2 or path.parts[0] != "windows_mcp"
                or path.as_posix() != member.filename or member.is_dir()
                or member.external_attr >> 16 & 0o170000 == 0o120000
            ):
                raise ValueError(f"Invalid Windows-MCP archive member: {member.filename}")
            if member.filename in files:
                raise ValueError(f"Duplicate Windows-MCP archive member: {member.filename}")
            files[member.filename] = bundle.read(member)
    if len(files) != source["fileCount"] or "windows_mcp/__main__.py" not in files:
        raise ValueError("Windows-MCP source inventory does not match its manifest")
    if tool_signatures(files) != signatures:
        raise ValueError("Windows-MCP source tool signatures do not match the reviewed catalog")
    for patch in metadata["patches"]:
        checked_input(root, patch["path"], patch["sha256"])
        target = patch["target"]
        text = files[target].decode("utf-8")
        if text.count(patch["before"]) != 1:
            raise ValueError(f"Windows-MCP patch target must contain exactly one match: {target}")
        files[target] = text.replace(patch["before"], patch["after"]).encode("utf-8")
    if tool_signatures(files) != signatures:
        raise ValueError("Windows-MCP local patches changed the reviewed tool signatures")
    return files


def install_source(target: Path, files: dict[str, bytes]) -> None:
    """Replace the generated runtime's Python package, retaining wheel metadata and dependencies."""
    package = target / "windows_mcp"
    if package.is_symlink():
        raise ValueError("Windows-MCP runtime package must not be a symbolic link")
    if package.exists():
        shutil.rmtree(package)
    for path, data in files.items():
        destination = target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)


def main() -> None:
    """Build-only entry; the installed application starts through the DSH profile."""
    match sys.argv[1:]:
        case ["snapshot", source]:
            snapshot(Path(source))
        case ["verify"] | ["install"]:
            metadata = json.loads((INPUTS / "runtime.json").read_text(encoding="utf-8"))
            files = prepared_source(ROOT, metadata)
            if sys.argv[1] == "install":
                install_source(ROOT / "apps/desktop/runtime/windows-mcp/Lib/site-packages", files)
            print(f"Verified {len(files)} Windows-MCP source files and local patches")
        case _:
            raise SystemExit("Usage: source.py snapshot SOURCE_ROOT | verify | install")


if __name__ == "__main__":
    main()
