from pathlib import Path
import argparse
import json
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser(description='Package the Aside extension.')
parser.add_argument('--unpack', action='store_true',
                    help='Also refresh the fixed unpacked directory for this browser.')
browsers = parser.add_mutually_exclusive_group()
browsers.add_argument('--firefox', action='store_true', help='Package the Firefox build and its review sources.')
browsers.add_argument('--edge', action='store_true', help='Package the Microsoft Edge build.')
args = parser.parse_args()

root = Path(__file__).resolve().parent
browser = 'firefox' if args.firefox else 'edge' if args.edge else 'chrome'
source = root if browser == 'chrome' else root / 'dist' / browser
suffix = '' if browser == 'chrome' else f'-{browser}'
if not (source / 'background.js').is_file():
    raise SystemExit(f'Run npm run build{suffix.replace("-", ":")} before packaging.')
version = json.loads((source / 'manifest.json').read_text())['version']
name = json.loads((root / 'package.json').read_text())['name']
out = root / 'artifacts' / f'{name}-{version}{suffix}.zip'
out.parent.mkdir(exist_ok=True)
# Explicit runtime files only: never traverse source, tests, dependencies or artifacts.
files = [file for file in source.iterdir() if file.is_file() and
         (file.suffix in {'.js', '.css', '.html'} or file.name in {'manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'})]
for directory in ['icons', '_locales', 'licenses']:
    files.extend(file for file in (source / directory).rglob('*') if file.is_file())
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(source))
print(out)

if args.unpack:
    unpacked = out.parent / f'unpacked{suffix}'
    # Recreate the dedicated output directory so old hashed bundles do not accumulate.
    if unpacked.exists():
        shutil.rmtree(unpacked)
    with ZipFile(out) as archive:
        archive.extractall(unpacked)
    print(unpacked)

if args.firefox:
    # Reproducible AMO review sources. Do not include local artifacts or secrets.
    review = out.with_name(f'{name}-{version}-firefox-source.zip')
    sources = [root / filename for filename in [
        'package.json', 'package-lock.json', 'tsconfig.json', '.nvmrc',
        'manifest.json', 'build.py', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
        'docs/FIREFOX.md', 'website/languages.json',
    ]]
    sources.extend(file for file in root.iterdir() if file.suffix in {'.css', '.html'})
    for directory in ['src', 'scripts', 'manifests', 'icons', '_locales', 'licenses']:
        sources.extend(file for file in (root / directory).rglob('*') if file.is_file())
    with ZipFile(review, 'w', ZIP_DEFLATED) as archive:
        for file in sorted(sources):
            archive.write(file, file.relative_to(root))
    print(review)
