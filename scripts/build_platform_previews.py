#!/usr/bin/env python3
"""Build small, silent hover previews; source windows and credits are recorded beside this script.

python3 scripts/build_platform_previews.py --source-root /path/to/MABEL
Public source assets can be fetched when not cached. Author submission assets
come from the source checkout. All videos retain their complete frame.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
import argparse, json, subprocess, tempfile

SITE = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=SITE.parent)
    parser.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir()) / 'mabel-peer-sources')
    args = parser.parse_args()
    args.cache.mkdir(exist_ok=True)
    out = SITE / 'assets/platforms'
    out.mkdir(exist_ok=True)
    rows = json.loads((SITE / 'scripts/platform_preview_sources.json').read_text())
    def one(row):
        dest = out / (row['key'] + '.mp4')
        if not dest.exists():
            if row.get('source_file'):
                src = args.source_root / row['source_file']
            else:
                src = args.cache / row['cache_name']
                if not src.exists():
                    if 'youtube.com/' in row['source_media'] or 'youtu.be/' in row['source_media']:
                        command=['yt-dlp','--js-runtimes','node','--remote-components','ejs:github','-f','bv[height<=720][ext=mp4]','-o',str(src)]
                        if row.get('source_window'):
                            command+=['--download-sections','*%s-%s'%tuple(row['source_window']),'--force-keyframes-at-cuts']
                        subprocess.run(command+[row['source_media']],check=True)
                    elif '.m3u8' in row['source_media']:
                        # Use one fixed rendition: the adaptive master yielded partial black previews.
                        manifest = urlopen(row['source_media']).read().decode().splitlines()
                        rendition = next((manifest[i+1] for i,line in enumerate(manifest) if 'RESOLUTION=640x360,' in line), row['source_media'])
                        src = rendition
                    else:
                        req = Request(row['source_media'], headers={'User-Agent': 'Mozilla/5.0', 'Referer': row['source_url']})
                        with urlopen(req, timeout=60) as response:
                            src.write_bytes(response.read())
            temp_dest=dest.with_name('.'+dest.stem+'.tmp.mp4')
            subprocess.run(['ffmpeg','-v','error','-y','-ss',str(row['start']),'-i',str(src),'-t',str(row['duration']),'-an','-vf','fps=24,scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1','-c:v','libx264','-crf','25','-preset','fast','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(temp_dest)],check=True)
            temp_dest.replace(dest)
        poster = out / (row['key'] + '.jpg')
        if not poster.exists() or not poster.stat().st_size:
            duration = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(dest)]).decode().strip())
            seek = str(min(0.5, duration / 4))
            subprocess.run(['ffmpeg','-v','error','-y','-ss',seek,'-i',str(dest),'-frames:v','1','-vf','format=yuvj420p','-threads','1','-q:v','4',str(poster)],check=True)
        assert poster.exists() and poster.stat().st_size, f'Poster missing: {poster}'
        print(row['name'], 'ready', flush=True)
        return row['name'], dict(video=str(dest.relative_to(SITE)),poster=str(poster.relative_to(SITE)),credit=row['credit'],source_url=row['source_url'],label=row['label'])
    with ThreadPoolExecutor(max_workers=2) as pool:
        previews = dict(pool.map(one, rows))
    (SITE / 'assets/data/platform-previews.json').write_text(json.dumps(previews,indent=2)+'\n')
    print(f'{len(previews)} previews built')

if __name__ == '__main__':
    main()
