from pathlib import Path
import argparse
import json
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser(description='Package the Aside extension.')
parser.add_argument('--unpack', action='store_true',
                    help='Also refresh artifacts/unpacked for local debugging.')
args = parser.parse_args()

root = Path(__file__).resolve().parent
if not (root / 'background.js').is_file():
    raise SystemExit('Run npm run build before packaging.')
version = json.loads((root / 'manifest.json').read_text())['version']
name = json.loads((root / 'package.json').read_text())['name']
out = root / 'artifacts' / f'{name}-{version}.zip'
out.parent.mkdir(exist_ok=True)
# Explicit runtime files only: never traverse source, tests, dependencies or artifacts.
files = [file for file in root.iterdir() if file.is_file() and
         (file.suffix in {'.js', '.css', '.html'} or file.name in {'manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'})]
for directory in ['icons', '_locales', 'licenses']:
    files.extend(file for file in (root / directory).rglob('*') if file.is_file())
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(root))
print(out)

if args.unpack:
    unpacked = out.parent / 'unpacked'
    # Recreate the dedicated output directory so old hashed bundles do not accumulate.
    if unpacked.exists():
        shutil.rmtree(unpacked)
    with ZipFile(out) as archive:
        archive.extractall(unpacked)
    print(unpacked)
